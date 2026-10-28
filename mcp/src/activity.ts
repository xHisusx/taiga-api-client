import { TaigaAuthError } from "taiga-api-client";
import { ResolutionError, type CatalogService, type ProjectRef } from "./catalog.js";
import { describeError } from "./errors.js";
import { formatItem, itemUrl, normalizeTags } from "./format.js";
import type { TaigaSession } from "./session.js";
import {
  isClosing,
  isWork,
  parseEvent,
  type EventTarget,
  type ParsedEvent,
  type TargetType,
  type TimelineEvent,
} from "./timeline.js";
import {
  ITEM_KINDS,
  ITEM_TYPES,
  type ItemType,
  type ProjectCatalog,
  type RawItem,
} from "./types.js";
import {
  formatWindow,
  parseInstant,
  resolveWindow,
  type ActivityPeriod,
  type ActivityWindow,
} from "./window.js";

/** Everything `taiga_activity` was asked for, with the defaults already applied. */
export interface ActivityInput {
  projects: ProjectRef[];
  period?: ActivityPeriod | undefined;
  since?: string | undefined;
  until?: string | undefined;
  tz?: string | undefined;
  /** Which kinds to report on. `"milestone"` controls the `sprints` block. */
  types: TargetType[];
  groupBy: "item" | "event";
  includeComments: boolean;
  tags?: string[] | undefined;
  users?: string[] | undefined;
  maxPages: number;
  commentChars: number;
  /** When false, cards that were only planned are left out of the answer. */
  includePlanning: boolean;
  /** When true, a task is nested under its parent story instead of standing alone. */
  foldTasks: boolean;
  /** `"all"` reports a story's whole task composition, not only the tasks the window touched. */
  tasksScope: "period" | "all";
  /** Whether a card may enter the answer on its finish date alone, with no event at all. */
  includeByFinishDate: boolean;
  /** `"compact"` drops every empty value, the web URLs and the derived status path. */
  verbosity: "compact" | "full";
  /** Board positions are dropped unless this is explicitly false (events only). */
  dropNoise: boolean;
}

/** Taiga serves the timeline in pages of at most 100. */
const PAGE_SIZE = 100;

/** A ceiling on `max_pages`, so a bad window cannot walk a project's whole history. */
const MAX_PAGES_CEILING = 100;

/** The period used when a call names neither a period nor a `since`. */
const DEFAULT_PERIOD: ActivityPeriod = "last_week";

/** What one project contributed to the answer. */
interface ProjectOutcome {
  project: string;
  projectId: number | null;
  scanned: number;
  inWindow: number;
  truncated: boolean;
  items: number;
  /** Set when the page budget ran out before the window was reached at all. */
  windowReached?: boolean;
  error?: string;
  degraded?: string;
}

/** One status move, with the time it happened. */
interface StatusEvent {
  at: string;
  from: string | null;
  to: string | null;
}

/** A status name as the timeline spells it, against what the project's schema says of it. */
interface StatusStep {
  name: string;
  is_closed: boolean | null;
}

/** Running state of one item while its events are folded together. */
interface ItemAccumulator {
  target: EventTarget;
  type: ItemType;
  /** Every status move in order: the path, the dates and the closure all come from these. */
  statusEvents: StatusEvent[];
  closedByEvent: boolean;
  firstAt: string;
  lastAt: string;
  events: number;
  descriptionChanged: boolean;
  attachmentsAdded: number;
  attachmentsRemoved: number;
  sprintChanged: boolean;
  sprint: string | null;
  reassigned: Array<[string | null, string | null]>;
  comments: Array<Record<string, unknown>>;
  hasWork: boolean;
  hasComment: boolean;
  /** Attachment and description changes: the part of `work_events_count` counted as it folds. */
  workChanges: number;
  /** Which kinds of change the window saw. Feeds `event_kinds` and `closure_only`. */
  kinds: Set<string>;
  /** One entry per distinct comment, so an edit does not read as a second comment. */
  commentKeys: Map<string, Record<string, unknown> | null>;
}

/** The inventory of a project: every item of the requested kinds, by id. */
interface Inventory {
  byType: Map<ItemType, Map<number, RawItem>>;
  /** Kinds whose full list came back, so a retroactive closure can be spotted in them. */
  complete: Set<ItemType>;
}

/** Everything one project's walk collected, before it is shaped into rows. */
interface Collected {
  accumulators: Map<string, ItemAccumulator>;
  /**
   * Per item, the status it sat in when the window ended: the `from` of its first move
   * after `until`, for the items that moved at all.
   *
   * `status_now` is about today and a report is about the window. A card moved to Done on
   * the Wednesday after the week reads as that week's finished work unless the answer also
   * says where the week left it.
   */
  statusAfter: Map<string, string | null>;
  inventory: Inventory;
}

/** Who may have authored an event, resolved per project. */
interface AuthorFilter {
  ids: Set<number>;
  names: Set<string>;
}

/** Narrow the caller's kind list down to the four work-item kinds. */
function itemTypesOf(types: TargetType[]): ItemType[] {
  return types.filter((type): type is ItemType =>
    (ITEM_TYPES as readonly string[]).includes(type),
  );
}

/** Taiga writes an empty date field as the literal string `"None"`. */
function dateOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && value !== "None" ? value : null;
}

function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
}

/** Append a status to the path, keeping it a path rather than a list of repeats. */
function pushStatus(path: string[], value: string | null | undefined): void {
  if (!value) return;
  if (path[path.length - 1] === value) return;
  path.push(value);
}

/**
 * The identity of a comment, for telling an edit from a second comment.
 *
 * Taiga has no "edited" event: editing a comment emits another event carrying the whole
 * text again. Counted as written, one comment edited twice reads as three, and the event
 * count is what a report weighs a card by.
 */
function commentKey(author: string | null, text: string): string {
  return `${author ?? ""}\u0000${text.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/** Whether an event carries a status move at all, without parsing the rest of it. */
function hasStatusChange(event: TimelineEvent): boolean {
  const values = event.data?.values_diff;
  if (!values || typeof values !== "object" || Array.isArray(values)) return false;
  return "status" in values;
}

/** The kinds of change that are closing a card rather than working on it. */
const CLOSURE_KINDS = new Set(["status", "close_flag", "finish_date"]);

/** Fields a compact answer leaves out even when they are filled in. */
const COMPACT_DROPPED = new Set(["url", "status_path", "first_event_at"]);

/**
 * Flags a compact answer keeps even when they say no.
 *
 * An absent key reads as `false` for most of them, but not for all: with
 * `tasks_scope: "all"`, `in_period` is the one thing that tells a task the window touched
 * from one it did not, and a missing key is a poor way to say "this task did not move".
 * The counters are here for the same reason — a story with no tasks at all is a fact.
 */
const COMPACT_KEPT = new Set([
  "in_period",
  "closed_in_period",
  "reopened_in_period",
  "status_is_closed",
  "status_at_until_is_closed",
  "tasks_total",
  "tasks_done",
  "tasks_done_at_until",
  "all_tasks_done",
  "all_tasks_done_at_until",
  "tasks_touched_in_period",
  "work_events_count",
]);

/** Whether a value says anything at all. A compact answer omits the ones that do not. */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) return true;
  if (value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * Strip a row down for a compact answer: no empty values, no web URLs, no derived path.
 *
 * Three projects of a week come to some 115 KB pretty-printed, which does not fit in a
 * tool's output and goes to a file instead. Most of that is `false`, `null` and `[]` —
 * an absent key says the same thing in a tenth of the space, and `status_events` carries
 * everything `status_path` was derived from.
 */
function compactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (COMPACT_DROPPED.has(key)) continue;
    if (isEmptyValue(value) && !COMPACT_KEPT.has(key)) continue;
    out[key] = Array.isArray(value) ? value.map(compactValue) : compactValue(value);
  }
  return out;
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactValue);
  if (value !== null && typeof value === "object") {
    return compactRow(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Answers "what happened in these projects between these two dates" in one call.
 *
 * The shape of the answer is the point of the tool. Taiga can only be asked for a project's
 * raw event stream, and that stream is both too much (board positions, HTML, tokenized
 * attachment URLs) and too little (no status, no tags, no sprint, and nothing at all about
 * work closed after the fact). This service applies the rules that would otherwise be left
 * to whoever reads the output — and be applied differently every time.
 */
export class ActivityService {
  constructor(
    private readonly session: TaigaSession,
    private readonly catalogs: CatalogService,
  ) {}

  /** Resolve the window, walk every project's timeline, and assemble one report. */
  async activity(input: ActivityInput): Promise<Record<string, unknown>> {
    const window = resolveWindow(input, {
      tz: this.session.settings.tz,
      period: DEFAULT_PERIOD,
    });
    if (input.projects.length === 0) {
      throw new ResolutionError(
        'This tool needs at least one project — pass "projects" (slug, name or id, or a list ' +
          "of them), or start the server with TAIGA_PROJECT.",
      );
    }

    const outcomes: ProjectOutcome[] = [];
    const items: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    const sprints: Array<Record<string, unknown>> = [];
    const seenProjects = new Set<number>();
    let truncated = false;

    for (const ref of input.projects) {
      let catalog: ProjectCatalog;
      try {
        catalog = await this.catalogs.catalog(ref);
      } catch (error) {
        if (error instanceof TaigaAuthError && error.status === 403) {
          outcomes.push({
            project: String(ref),
            projectId: null,
            scanned: 0,
            inWindow: 0,
            truncated: false,
            items: 0,
            error: `This account has no access to project "${String(ref)}" (403).`,
          });
          continue;
        }
        throw error;
      }

      // The same project can be named twice — by slug in one entry and by id in another.
      if (seenProjects.has(catalog.id)) continue;
      seenProjects.add(catalog.id);

      const outcome = await this.collectProject(catalog, window, input, items, events, sprints);
      outcomes.push(outcome);
      if (outcome.truncated) truncated = true;
    }

    // Most recently touched first, which is the order a report reads them in.
    const lastAt = (row: Record<string, unknown>): string => String(row["last_event_at"] ?? "");
    items.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
    events.sort((a, b) => String(a["at"] ?? "").localeCompare(String(b["at"] ?? "")));

    // Echo an active filter back, so an empty answer can be told from a filter that matched
    // nobody — a misspelled name is otherwise indistinguishable from a quiet week.
    const filters =
      input.tags?.length || input.users?.length
        ? {
            ...(input.tags?.length ? { tags: input.tags } : {}),
            ...(input.users?.length ? { users: input.users } : {}),
          }
        : null;

    const shape = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      input.verbosity === "compact" ? rows.map(compactRow) : rows;

    return {
      window: formatWindow(window),
      projects: outcomes.map((outcome) => ({
        project: outcome.project,
        project_id: outcome.projectId,
        events_scanned: outcome.scanned,
        events_in_window: outcome.inWindow,
        items: outcome.items,
        ...(outcome.truncated ? { truncated: true } : {}),
        ...(outcome.windowReached === false ? { window_reached: false } : {}),
        ...(outcome.degraded ? { degraded: outcome.degraded } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      })),
      truncated,
      ...(filters ? { filters } : {}),
      ...(input.groupBy === "event" ? { events: shape(events) } : { items: shape(items) }),
      sprints: shape(sprints),
    };
  }

  /** Walk one project and push its items, events and sprint changes onto the answer. */
  private async collectProject(
    catalog: ProjectCatalog,
    window: ActivityWindow,
    input: ActivityInput,
    items: Array<Record<string, unknown>>,
    events: Array<Record<string, unknown>>,
    sprints: Array<Record<string, unknown>>,
  ): Promise<ProjectOutcome> {
    const outcome: ProjectOutcome = {
      project: catalog.slug,
      projectId: catalog.id,
      scanned: 0,
      inWindow: 0,
      truncated: false,
      items: 0,
    };

    let raw: TimelineEvent[];
    let later: TimelineEvent[];
    try {
      const walk = await this.fetchTimeline(catalog.id, window, input.maxPages);
      raw = walk.events;
      later = walk.later;
      outcome.scanned = walk.scanned;
      outcome.truncated = walk.truncated;
      if (walk.truncated && !walk.reachedWindow) outcome.windowReached = false;
      if (walk.failure) {
        outcome.degraded =
          `The timeline walk stopped early, so the window is only partly covered — ` +
          walk.failure;
      }
    } catch (error) {
      if (error instanceof TaigaAuthError && error.status === 403) {
        outcome.error = `This account may not read the activity of project "${catalog.slug}" (403).`;
        return outcome;
      }
      throw error;
    }
    outcome.inWindow = raw.length;

    const authors = input.users?.length ? await this.authorFilter(catalog, input.users) : null;
    const wanted = new Set<TargetType>(input.types);
    const itemTypes = itemTypesOf(input.types);
    const parsed: ParsedEvent[] = [];

    for (const event of raw) {
      const entry = parseEvent(event, {
        keepOrderFields: !input.dropNoise && input.groupBy === "event",
      });
      if (!entry) continue;
      if (!wanted.has(entry.target.type)) continue;
      if (authors && !this.matchesAuthor(entry, authors)) continue;
      parsed.push(entry);
    }

    // Where the window left each card, read off the moves that came after it. Newest
    // first, so the last one written wins: the first move after `until`.
    const statusAfter = new Map<string, string | null>();
    for (const event of later) {
      const entry = parseEvent(event, { keepOrderFields: false });
      if (!entry || entry.target.type === "milestone") continue;
      for (const change of entry.changes) {
        if (change.kind !== "status") continue;
        statusAfter.set(`${entry.target.type}:${entry.target.id}`, change.from ?? null);
      }
    }

    const accumulators = new Map<string, ItemAccumulator>();
    for (const entry of parsed) {
      // A sprint is not a card: its changes are reported through `sprints`.
      if (entry.target.type === "milestone") {
        sprints.push(...this.sprintRows(catalog, entry));
        continue;
      }
      this.fold(accumulators, entry, input);
    }

    // "Are all its tasks done" is the question a report answers about a story, so the task
    // list is loaded even when tasks themselves were not asked for.
    const inventoryTypes =
      itemTypes.includes("userstory") && !itemTypes.includes("task")
        ? [...itemTypes, "task" as ItemType]
        : itemTypes;
    const inventory = await this.loadInventory(catalog, inventoryTypes, accumulators, outcome);
    const collected: Collected = { accumulators, statusAfter, inventory };
    const assembled = this.assemble(catalog, window, input, itemTypes, collected);

    if (input.groupBy === "event") {
      // Whatever a filter removed from the cards is removed from the chronology too.
      const filtered = Boolean(input.tags?.length) || !input.includePlanning;
      const known = new Set(assembled.map((row) => `${String(row["type"])}:${String(row["id"])}`));
      events.push(...this.eventRows(catalog, parsed, input, filtered ? known : null));
    }

    const rows = input.foldTasks ? this.foldTasks(assembled, input) : assembled;
    outcome.items = rows.length;
    items.push(...rows);

    return outcome;
  }

  /**
   * Page through `GET /timeline/project/{id}` until the stream reaches back past `since`.
   *
   * The stream is strictly newest-first, so the first event older than `since` ends the
   * walk — the page count is a safety stop, never the real one. When that safety stop is
   * what ended the walk, the result is marked truncated: "nothing happened" and "the data
   * did not all arrive" are different statements to put in front of a manager.
   *
   * `maxPages` counts only the pages that actually reach into the window. Everything newer
   * than `until` has to be paged past first, and on a busy project that seek is pages long
   * on its own — a week-old window on a project with 60 events a day sits behind one and a
   * half pages of newer events. Charging the seek to the budget spent it before the window
   * was reached and answered with nothing at all, while the retroactive closures still came
   * back from the item lists, so the counters contradicted each other.
   */
  private async fetchTimeline(
    projectId: number,
    window: ActivityWindow,
    maxPages: number,
  ): Promise<{
    events: TimelineEvent[];
    /** The status moves newer than `until`, newest first. */
    later: TimelineEvent[];
    scanned: number;
    truncated: boolean;
    reachedWindow: boolean;
    failure: string | null;
  }> {
    const budget = Math.max(1, Math.min(maxPages, MAX_PAGES_CEILING));
    const events: TimelineEvent[] = [];
    const later: TimelineEvent[] = [];
    let scanned = 0;
    let windowPages = 0;
    let reachedWindow = false;
    let reachedStart = false;
    let failure: string | null = null;

    let page = 0;
    while (page < MAX_PAGES_CEILING && !reachedStart && windowPages < budget) {
      page += 1;
      let batch: TimelineEvent[];
      try {
        const response = await this.session.run((client) =>
          client.http.get<TimelineEvent[]>(`/timeline/project/${projectId}`, {
            query: { page_size: PAGE_SIZE, page },
          }),
        );
        batch = Array.isArray(response.data) ? response.data : [];
      } catch (error) {
        // Nothing collected yet: let the caller map the failure (a 403 becomes "no access
        // to this project"). Mid-walk, what the earlier pages gave is worth more than a
        // failed call, so it is returned and marked truncated.
        if (events.length === 0) throw error;
        failure = describeError(error);
        break;
      }
      scanned += batch.length;

      for (const event of batch) {
        const at = parseInstant(event.created);
        if (at === null) continue;
        if (at >= window.untilMs) {
          // These have to be paged past to reach the window at all, and a status move
          // among them is the only thing that can say where the window left a card.
          if (hasStatusChange(event)) later.push(event);
          continue;
        }
        reachedWindow = true;
        if (at < window.sinceMs) {
          reachedStart = true;
          break;
        }
        events.push(event);
      }

      if (reachedWindow) windowPages += 1;
      // A short page is the last page: the project has no older events to reach.
      if (batch.length < PAGE_SIZE) reachedStart = true;
    }

    // Oldest first from here on: a status path, a first event and a sprint move all read
    // forwards, and the timeline arrives backwards.
    events.reverse();
    // `later` stays newest first: read in that order, the last move seen for a card is the
    // first one after the window, and the status it moved out of is where `until` left it.
    return { events, later, scanned, truncated: !reachedStart, reachedWindow, failure };
  }

  /** Fold one event into the running state of its item. */
  private fold(
    accumulators: Map<string, ItemAccumulator>,
    entry: ParsedEvent,
    input: ActivityInput,
  ): void {
    const target = entry.target;
    const type = target.type as ItemType;
    const key = `${type}:${target.id}`;

    let acc = accumulators.get(key);
    if (!acc) {
      acc = {
        target: { ...target },
        type,
        statusEvents: [],
        closedByEvent: false,
        firstAt: entry.at,
        lastAt: entry.at,
        events: 0,
        descriptionChanged: false,
        attachmentsAdded: 0,
        attachmentsRemoved: 0,
        sprintChanged: false,
        sprint: null,
        reassigned: [],
        comments: [],
        hasWork: false,
        hasComment: false,
        workChanges: 0,
        kinds: new Set(),
        commentKeys: new Map(),
      };
      accumulators.set(key, acc);
    }

    // Later events can name what earlier ones left out (a subject, a #ref, a parent story).
    if (target.ref !== undefined) acc.target.ref = target.ref;
    if (target.subject !== undefined) acc.target.subject = target.subject;
    if (target.parent !== undefined) acc.target.parent = target.parent;

    acc.lastAt = entry.at;
    acc.attachmentsAdded += entry.attachmentsAdded;
    acc.attachmentsRemoved += entry.attachmentsRemoved;

    for (const change of entry.changes) {
      if (isWork(change)) acc.hasWork = true;
      if (isClosing(change)) acc.closedByEvent = true;
      // The flag and the status disagree in both directions, so they are kept apart from
      // here on: "closed" is the flag, a closed status is what the schema says it is.
      acc.kinds.add(change.kind === "closed" ? "close_flag" : change.kind);
      if (change.kind === "status") {
        acc.statusEvents.push({ at: entry.at, from: change.from ?? null, to: change.to ?? null });
      }
      if (change.kind === "description") acc.descriptionChanged = true;
      // Towards `work_events_count`: something was put on the card, not merely recorded
      // about it.
      if (change.kind === "description" || change.kind === "attachment") acc.workChanges += 1;
      if (change.kind === "sprint") {
        acc.sprintChanged = true;
        acc.sprint = change.to ?? null;
      }
      if (change.kind === "assignee") {
        acc.reassigned.push([change.from ?? null, change.to ?? null]);
      }
    }

    let editedComment = false;
    if (entry.comment !== null) {
      acc.hasComment = true;
      acc.kinds.add("comment");
      const key = commentKey(entry.author, entry.comment);
      if (acc.commentKeys.has(key)) {
        // Editing a comment emits the whole text again: one comment, written and then
        // edited, rather than two things said.
        const first = acc.commentKeys.get(key);
        if (first) {
          first["at"] = entry.at;
          first["edited"] = true;
        }
        editedComment = true;
      } else if (input.includeComments) {
        const { text, truncated } = truncateText(entry.comment, input.commentChars);
        const row: Record<string, unknown> = {
          at: entry.at,
          author: entry.author,
          text,
          ...(truncated ? { truncated: true } : {}),
        };
        acc.comments.push(row);
        acc.commentKeys.set(key, row);
      } else {
        acc.commentKeys.set(key, null);
      }
    }

    // An edit is not a second event: the count is what a report weighs a card by.
    if (!editedComment || entry.changes.length > 0) acc.events += 1;
  }

  /**
   * Read every item of the requested kinds in one request per kind.
   *
   * The timeline carries no status, no tags and no sprint, and a report needs all three —
   * tags are what tell one line of work from another. The full list is also what reveals a
   * closure entered after the fact, which has no event inside the window at all.
   *
   * A kind whose list does not come back falls back to one GET per touched item, so a
   * missing enrichment costs detail rather than the whole answer.
   */
  private async loadInventory(
    catalog: ProjectCatalog,
    types: ItemType[],
    accumulators: Map<string, ItemAccumulator>,
    outcome: ProjectOutcome,
  ): Promise<Inventory> {
    const byType = new Map<ItemType, Map<number, RawItem>>();
    const complete = new Set<ItemType>();
    const degraded: string[] = [];

    for (const type of types) {
      const store = new Map<number, RawItem>();
      byType.set(type, store);
      try {
        const response = await this.session.run((client) =>
          client.http.get<RawItem[]>(ITEM_KINDS[type].listPath, {
            query: { project: catalog.id },
            disablePagination: true,
          }),
        );
        for (const item of Array.isArray(response.data) ? response.data : []) {
          if (typeof item?.id === "number") store.set(item.id, item);
        }

        // An instance that ignores `x-disable-pagination` answers with one page and says so
        // in the headers. Treating that page as the whole project would quietly drop every
        // retroactive closure beyond it, which is the one thing nobody could spot in the
        // output — so it counts as a failed list, not a short one.
        const total = response.pagination?.count;
        if (total !== undefined && total > store.size) {
          degraded.push(
            `${ITEM_KINDS[type].labelPlural}: Taiga paginated the list anyway ` +
              `(${store.size} of ${total})`,
          );
        } else {
          complete.add(type);
        }
      } catch (error) {
        degraded.push(`${ITEM_KINDS[type].labelPlural}: ${describeError(error)}`);
      }
    }

    // Whatever the lists missed, fetch one by one — but only for items the window touched.
    const budget = this.session.settings.maxResults;
    let fetched = 0;
    for (const acc of accumulators.values()) {
      const store = byType.get(acc.type);
      if (!store || store.has(acc.target.id)) continue;
      if (fetched >= budget) break;
      fetched += 1;
      try {
        const item = await this.session.run((client) =>
          client.http.get<RawItem>(`${ITEM_KINDS[acc.type].listPath}/${acc.target.id}`),
        );
        if (typeof item.data?.id === "number") store.set(item.data.id, item.data);
      } catch {
        // The item may have been deleted since the event. The timeline still knows what
        // happened to it, so it stays in the answer without the enriched fields.
      }
    }

    if (degraded.length) {
      outcome.degraded =
        `Could not list every item of this project, so status, tags and retroactive ` +
        `closures may be missing — ${degraded.join("; ")}`;
    }
    return { byType, complete };
  }

  /**
   * Build the item rows: one per card the window touched, plus the cards whose closure was
   * entered after the fact.
   */
  private assemble(
    catalog: ProjectCatalog,
    window: ActivityWindow,
    input: ActivityInput,
    itemTypes: ItemType[],
    collected: Collected,
  ): Array<Record<string, unknown>> {
    const { accumulators, inventory, statusAfter } = collected;
    const rows: Array<Record<string, unknown>> = [];
    const covered = new Set<string>();

    // A story whose tasks moved was worked on, however little happened to the story
    // itself. `closure_only` has to know the difference, and a report telling a week's
    // work from a board being tidied wants the number itself.
    const tasksTouched = new Map<number, number>();
    for (const acc of accumulators.values()) {
      if (acc.type !== "task") continue;
      const raw = inventory.byType.get("task")?.get(acc.target.id);
      const parent = acc.target.parent?.id ?? raw?.user_story ?? null;
      if (typeof parent !== "number") continue;
      tasksTouched.set(parent, (tasksTouched.get(parent) ?? 0) + 1);
    }
    const options = { tasksTouched, statusAfter };

    for (const [key, acc] of accumulators) {
      covered.add(key);
      const raw = inventory.byType.get(acc.type)?.get(acc.target.id) ?? null;
      const row = this.itemRow(catalog, window, input, acc, raw, options);
      if (row) rows.push(row);
    }

    // Rule: a card whose finish date falls inside the window and which is closed now was
    // worked on in the window, even when its only event — the status move — came later.
    // Nothing in Taiga obliges anyone to fill that date in, though, so a card with no
    // event in the window at all enters the answer only when the caller asks for it.
    if (input.includeByFinishDate) {
      for (const type of itemTypes) {
        if (!inventory.complete.has(type)) continue;
        for (const raw of inventory.byType.get(type)?.values() ?? []) {
          const key = `${type}:${raw.id}`;
          if (covered.has(key)) continue;
          if (!this.finishedInWindow(type, raw, catalog, window)) continue;
          // Nobody authored this row, so a filter on authors cannot vouch for it.
          if (input.users?.length) continue;
          const row = this.itemRow(catalog, window, input, null, raw, {
            ...options,
            fallbackType: type,
          });
          if (row) rows.push(row);
        }
      }
    }

    // Planning is more than half of a busy week, and a report that lists it has to read
    // past it. Dropping it here keeps the per-project counters honest about what is in
    // the answer.
    const kept = input.includePlanning
      ? rows
      : rows.filter((row) => row["planning_only"] !== true);
    // With planning gone the flag is false on every row that is left.
    if (!input.includePlanning) {
      for (const row of kept) delete row["planning_only"];
    }

    this.rollUpTasks(catalog, input, kept, collected);
    return kept;
  }

  /**
   * Answer "are all its tasks done" on every story in the report.
   *
   * That is the criterion a weekly report actually applies to a story: the dates are not
   * filled in reliably and the closed flag disagrees with the status in both directions,
   * but the task list is a fact. The counters cover the story's whole composition, not
   * only the tasks the window touched, so they cannot come from the timeline — they come
   * from the one task list already read for this project.
   */
  private rollUpTasks(
    catalog: ProjectCatalog,
    input: ActivityInput,
    rows: Array<Record<string, unknown>>,
    collected: Collected,
  ): void {
    const { accumulators, inventory } = collected;
    const tasks = inventory.byType.get("task");
    // A partial list would report "3 of 4 done" about a story that has nine tasks.
    if (!tasks || !inventory.complete.has("task")) return;

    const byStory = new Map<number, RawItem[]>();
    for (const raw of tasks.values()) {
      const storyId =
        typeof raw.user_story === "number" ? raw.user_story : raw.user_story_extra_info?.id;
      if (typeof storyId !== "number") continue;
      const list = byStory.get(storyId) ?? [];
      list.push(raw);
      byStory.set(storyId, list);
    }

    for (const row of rows) {
      if (row["type"] !== "userstory") continue;
      const list = byStory.get(row["id"] as number) ?? [];
      const done = list.filter((raw) => this.isClosedNow("task", raw, catalog));
      // And the same counters as of the end of the window, which is what the report is
      // about: a task moved to Done on the Wednesday after was not done on the Friday.
      const doneThen = list.filter(
        (raw) => this.taskAtUntil(catalog, raw, collected).isClosed === true,
      );
      row["tasks_total"] = list.length;
      row["tasks_done"] = done.length;
      row["tasks_done_at_until"] = doneThen.length;
      row["all_tasks_done"] = list.length > 0 && done.length === list.length;
      row["all_tasks_done_at_until"] = list.length > 0 && doneThen.length === list.length;
      if (input.tasksScope !== "all") continue;

      // The tasks the window did not touch, named rather than only counted. A task that
      // is about to be nested under this story is left out: its own row says more.
      const brief: Array<Record<string, unknown>> = [];
      for (const raw of list) {
        const inPeriod = accumulators.has(`task:${raw.id}`);
        if (inPeriod && input.foldTasks) continue;
        const statusNow = this.statusNameOf(catalog, "task", raw);
        const then = this.taskAtUntil(catalog, raw, collected);
        brief.push({
          project: catalog.slug,
          type: "task",
          id: raw.id,
          ref: raw.ref ?? null,
          subject: raw.subject ?? null,
          status_now: statusNow,
          status_is_closed: this.isClosedNow("task", raw, catalog),
          // Only where they differ: this task moved after the window, not inside it.
          ...(then.status !== statusNow
            ? { status_at_until: then.status, status_at_until_is_closed: then.isClosed }
            : {}),
          in_period: inPeriod,
        });
      }
      if (brief.length === 0) continue;
      const nested = (row["tasks"] as Array<Record<string, unknown>> | undefined) ?? [];
      row["tasks"] = [...nested, ...brief];
    }
  }

  /** What the project's schema says about a status name. `null` when it has no such status. */
  private statusIsClosed(
    catalog: ProjectCatalog,
    type: ItemType,
    name: string | null | undefined,
  ): boolean | null {
    if (!name) return null;
    const needle = name.trim().toLowerCase();
    const status = catalog.statuses[type].find(
      (candidate) => candidate.name.trim().toLowerCase() === needle,
    );
    return status?.is_closed ?? null;
  }

  /** The status an item sits in now, by name. */
  private statusNameOf(catalog: ProjectCatalog, type: ItemType, raw: RawItem): string | null {
    const direct = raw.status_extra_info?.name;
    if (typeof direct === "string" && direct.trim() !== "") return direct;
    return catalog.statuses[type].find((candidate) => candidate.id === raw.status)?.name ?? null;
  }

  /** The path the card took, each step read against the project's schema. */
  private statusPathOf(
    catalog: ProjectCatalog,
    type: ItemType,
    acc: ItemAccumulator,
  ): StatusStep[] {
    const names: string[] = [];
    for (const step of acc.statusEvents) {
      if (names.length === 0) pushStatus(names, step.from);
      pushStatus(names, step.to);
    }
    return names.map((name) => ({
      name,
      is_closed: this.statusIsClosed(catalog, type, name),
    }));
  }

  /**
   * The status an item sat in when the window ended.
   *
   * `status_now` answers for today, and a report answers for the window. The first move
   * **after** `until` says where the window left the card — the status it moved out of —
   * and failing that the last move inside the window does, or the status it sits in now.
   */
  private statusAtUntil(
    catalog: ProjectCatalog,
    type: ItemType,
    raw: RawItem | null,
    acc: ItemAccumulator | null,
    after: string | null | undefined,
  ): string | null {
    if (after !== undefined && after !== null) return after;
    const last = acc?.statusEvents[acc.statusEvents.length - 1];
    if (last?.to) return last.to;
    return raw ? this.statusNameOf(catalog, type, raw) : null;
  }

  /** Whether the project calls that status closed. */
  private statusClosedAtUntil(
    catalog: ProjectCatalog,
    type: ItemType,
    raw: RawItem | null,
    name: string | null,
  ): boolean | null {
    const schema = this.statusIsClosed(catalog, type, name);
    if (schema !== null) return schema;
    // A status the schema has no name for: what the card says of itself is the best there is.
    return raw ? this.isClosedNow(type, raw, catalog) : null;
  }

  /** The same, for one task of a story — which has no row of its own to carry it. */
  private taskAtUntil(
    catalog: ProjectCatalog,
    raw: RawItem,
    collected: Collected,
  ): { status: string | null; isClosed: boolean | null } {
    const key = `task:${raw.id}`;
    const status = this.statusAtUntil(
      catalog,
      "task",
      raw,
      collected.accumulators.get(key) ?? null,
      collected.statusAfter.get(key),
    );
    return { status, isClosed: this.statusClosedAtUntil(catalog, "task", raw, status) };
  }

  /**
   * Nest a task under its parent story.
   *
   * A weekly report is written one line per story, with the tasks as the evidence under
   * it. A task whose story saw no activity in the window — or was dropped by a filter —
   * has nothing to nest under and stays where it is.
   */
  private foldTasks(
    rows: Array<Record<string, unknown>>,
    input: ActivityInput,
  ): Array<Record<string, unknown>> {
    const stories = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      if (row["type"] === "userstory") stories.set(row["id"] as number, row);
    }

    const kept: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const parent = row["parent"] as { id?: number } | undefined;
      const story = row["type"] === "task" && parent?.id !== undefined
        ? stories.get(parent.id)
        : undefined;
      if (!story) {
        kept.push(row);
        continue;
      }
      const nested = { ...row };
      // The parent story is implied by where the task now sits. The project is not:
      // without it, whoever sorts the answer by project loses every nested task.
      delete nested["parent"];
      // Only worth saying where the list also holds tasks the window never touched.
      if (input.tasksScope === "all") nested["in_period"] = true;
      const list = (story["tasks"] as Array<Record<string, unknown>> | undefined) ?? [];
      list.push(nested);
      story["tasks"] = list;
    }

    for (const story of stories.values()) {
      const list = story["tasks"] as Array<Record<string, unknown>> | undefined;
      if (!list) continue;
      // A task named only by `tasks_scope: "all"` has no events, so it sorts last.
      const at = (row: Record<string, unknown>): string => String(row["last_event_at"] ?? "");
      list.sort((a, b) => at(b).localeCompare(at(a)));
    }
    return kept;
  }

  /** Whether `raw` carries a finish date inside the window and is closed right now. */
  private finishedInWindow(
    type: ItemType,
    raw: RawItem,
    catalog: ProjectCatalog,
    window: ActivityWindow,
  ): boolean {
    const finishedAt = parseInstant(raw.finish_date ?? raw.finished_date);
    if (finishedAt === null) return false;
    if (finishedAt < window.sinceMs || finishedAt >= window.untilMs) return false;
    return this.isClosedNow(type, raw, catalog);
  }

  private isClosedNow(type: ItemType, raw: RawItem, catalog: ProjectCatalog): boolean {
    if (typeof raw.status_extra_info?.is_closed === "boolean") {
      return raw.status_extra_info.is_closed;
    }
    const status = catalog.statuses[type].find((candidate) => candidate.id === raw.status);
    return status?.is_closed ?? raw.is_closed === true;
  }

  /** One `ActivityItem`. `acc` is absent for a card that only surfaced through its finish date. */
  private itemRow(
    catalog: ProjectCatalog,
    window: ActivityWindow,
    input: ActivityInput,
    acc: ItemAccumulator | null,
    raw: RawItem | null,
    options: {
      tasksTouched: Map<number, number>;
      statusAfter: Map<string, string | null>;
      fallbackType?: ItemType;
    },
  ): Record<string, unknown> | null {
    const type = acc?.type ?? options.fallbackType;
    const id = acc?.target.id ?? raw?.id;
    if (type === undefined || id === undefined) return null;

    const projection = raw
      ? formatItem(type, raw, { webUrl: this.session.webUrl, catalog })
      : null;
    const tags = raw ? normalizeTags(raw.tags) : [];
    const ref = acc?.target.ref ?? raw?.ref;

    if (input.tags?.length) {
      // Without an enriched item its tags are unknown, and an unknown tag set cannot
      // satisfy a tag filter.
      const wanted = input.tags.map((tag) => tag.toLowerCase());
      const held = new Set(tags.map((tag) => tag.toLowerCase()));
      if (!wanted.every((tag) => held.has(tag))) return null;
    }

    const finishDate = dateOrNull(raw?.finish_date) ?? dateOrNull(raw?.finished_date);
    const closedByFinishDate = raw ? this.finishedInWindow(type, raw, catalog, window) : false;

    // A card is closed when it reaches a status the project calls closed. The `is_closed`
    // flag is reported beside that, never instead of it: a card can reach Done without the
    // flag moving, and the flag can arrive on a card still sitting in New. Where the two
    // disagree, both are in the answer and the reader can see it.
    const statusPath = acc ? this.statusPathOf(catalog, type, acc) : [];
    const closedByStatus =
      acc?.statusEvents.some(
        (step) =>
          this.statusIsClosed(catalog, type, step.to) === true &&
          this.statusIsClosed(catalog, type, step.from) !== true,
      ) === true;
    const closedFlagInPeriod = acc?.closedByEvent === true;
    const closedInPeriod = closedByStatus || closedByFinishDate;

    // Four defects were moved to Closed at 15:06 one Thursday and back out at 15:14. The
    // closure did happen, and four closed defects is still the wrong thing to report.
    const reopenedInPeriod =
      acc?.statusEvents.some(
        (step) =>
          this.statusIsClosed(catalog, type, step.from) === true &&
          this.statusIsClosed(catalog, type, step.to) === false,
      ) === true;

    // Where the window left the card, as against where it stands today.
    const statusThen = this.statusAtUntil(
      catalog,
      type,
      raw,
      acc,
      options.statusAfter.get(`${type}:${id}`),
    );

    // What was done to the card, as against what was recorded about it: the closing move,
    // the flag, the date, an assignee and a sprint are bookkeeping, not work.
    const workEvents =
      (acc?.workChanges ?? 0) +
      (acc?.commentKeys.size ?? 0) +
      (acc?.statusEvents.filter((step) => this.statusIsClosed(catalog, type, step.to) !== true)
        .length ?? 0);

    const source = acc
      ? closedByFinishDate
        ? "both"
        : "timeline"
      : "finish_date";

    // Eight cards closed between 09:56 and 12:34 on a Monday are a board being tidied, not
    // a day's work: the report has to be able to tell them from the rest.
    const eventKinds = acc ? [...acc.kinds].sort() : [];
    const closureOnly =
      acc !== null &&
      (closedInPeriod || closedFlagInPeriod) &&
      !acc.hasComment &&
      eventKinds.every((kind) => CLOSURE_KINDS.has(kind)) &&
      !(type === "userstory" && options.tasksTouched.has(id));

    const row: Record<string, unknown> = {
      project: catalog.slug,
      type,
      id,
      ref: ref ?? null,
      subject: acc?.target.subject ?? raw?.subject ?? null,
      url: itemUrl(this.session.webUrl, catalog.slug, type, ref) ?? null,
      ...(acc?.target.parent ? { parent: acc.target.parent } : {}),
      status_now: projection?.["status"] ?? null,
      status_is_closed: raw ? this.isClosedNow(type, raw, catalog) : null,
      status_at_until: statusThen,
      status_at_until_is_closed: this.statusClosedAtUntil(catalog, type, raw, statusThen),
      tags,
      sprint: projection?.["sprint"] ?? null,
      assignees: this.assigneesOf(raw, catalog),
      status_path: statusPath,
      status_events:
        acc?.statusEvents.map((step) => ({
          at: step.at,
          from: step.from,
          to: step.to,
          to_is_closed: this.statusIsClosed(catalog, type, step.to),
        })) ?? [],
      event_kinds: eventKinds,
      closed_in_period: closedInPeriod,
      closed_flag_in_period: closedFlagInPeriod,
      reopened_in_period: reopenedInPeriod,
      closure_only: closureOnly,
      finish_date: finishDate,
      source,
      planning_only: acc ? !(acc.hasWork || acc.hasComment || closedInPeriod) : false,
      first_event_at: acc?.firstAt ?? null,
      last_event_at: acc?.lastAt ?? null,
      events_count: acc?.events ?? 0,
      work_events_count: workEvents,
      ...(type === "userstory"
        ? { tasks_touched_in_period: options.tasksTouched.get(id) ?? 0 }
        : {}),
      description_changed: acc?.descriptionChanged ?? false,
      attachments_added: acc?.attachmentsAdded ?? 0,
      attachments_removed: acc?.attachmentsRemoved ?? 0,
      ...(acc?.sprintChanged ? { moved_to_sprint: acc.sprint } : {}),
      ...(acc?.reassigned.length ? { reassigned: acc.reassigned } : {}),
      comments: acc?.comments ?? [],
    };

    return row;
  }

  /** Everyone the item is assigned to now: the assignee plus Taiga's multi-assignee list. */
  private assigneesOf(raw: RawItem | null, catalog: ProjectCatalog): string[] {
    if (!raw) return [];
    const names = new Set<string>();
    const label = (id: number | null | undefined): string | null => {
      if (id === null || id === undefined) return null;
      const member = catalog.members.find((candidate) => candidate.id === id);
      return member?.username ?? String(id);
    };

    const primary =
      raw.assigned_to_extra_info?.username ??
      raw.assigned_to_extra_info?.full_name_display ??
      label(raw.assigned_to);
    if (primary) names.add(primary);
    for (const id of raw.assigned_users ?? []) {
      const name = label(id);
      if (name) names.add(name);
    }
    return [...names];
  }

  /** One `ActivityEvent` per change, so a chronology reads as a list of facts. */
  private eventRows(
    catalog: ProjectCatalog,
    parsed: ParsedEvent[],
    input: ActivityInput,
    known: Set<string> | null,
  ): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];

    for (const entry of parsed) {
      const target = entry.target;
      const isItem = target.type !== "milestone";
      // A filter that removed the card removes its events with it.
      if (isItem && known && !known.has(`${target.type}:${target.id}`)) continue;

      const base = {
        at: entry.at,
        author: entry.author,
        project: catalog.slug,
        type: target.type,
        id: target.id,
        ref: target.ref ?? null,
        subject: target.subject ?? target.name ?? null,
        url: isItem
          ? (itemUrl(this.session.webUrl, catalog.slug, target.type as ItemType, target.ref) ?? null)
          : null,
      };

      for (const change of entry.changes) {
        rows.push({
          ...base,
          kind: change.kind,
          // Without the field name an "other" event says only that something changed.
          field: change.field,
          ...(change.from !== undefined ? { from: change.from } : {}),
          ...(change.to !== undefined ? { to: change.to } : {}),
        });
      }
      if (entry.comment !== null && input.includeComments) {
        const { text, truncated } = truncateText(entry.comment, input.commentChars);
        rows.push({ ...base, kind: "comment", text, ...(truncated ? { truncated: true } : {}) });
      }
    }

    return rows;
  }

  /** Sprint changes, which a report quotes as the frame around the work. */
  private sprintRows(catalog: ProjectCatalog, entry: ParsedEvent): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    const name = entry.target.name ?? null;
    const add = (change: string, label: string | null): void => {
      rows.push({ project: catalog.slug, name: label, change, at: entry.at, by: entry.author });
    };

    let datesChanged = false;
    for (const change of entry.changes) {
      if (change.kind === "created") add("opened", name);
      else if (change.field === "closed") add(change.to === "true" ? "closed" : "opened", name);
      else if (change.field === "name") add("renamed", change.to ?? name);
      else if (change.field === "estimated_start" || change.field === "estimated_finish") {
        datesChanged = true;
      }
    }
    if (datesChanged) add("dates_changed", name);

    return rows;
  }

  /**
   * Resolve the `users` filter against one project.
   *
   * The timeline identifies an author by numeric id and display name only, so a username
   * has to be looked up in the project's members first. A name this project does not know
   * is kept as plain text rather than refused: in a multi-project call it may well belong
   * to another one.
   */
  private async authorFilter(catalog: ProjectCatalog, users: string[]): Promise<AuthorFilter> {
    const filter: AuthorFilter = { ids: new Set(), names: new Set() };

    for (const entry of users) {
      const raw = entry.trim();
      const needle = raw.toLowerCase();

      if (needle === "me" || needle === "self") {
        const me = await this.session.currentUser();
        filter.ids.add(me.id);
        for (const name of [me.username, me.full_name, me.full_name_display]) {
          if (name) filter.names.add(name.toLowerCase());
        }
        continue;
      }
      if (/^\d+$/.test(raw)) {
        filter.ids.add(Number(raw));
        continue;
      }

      filter.names.add(needle);
      try {
        const id = await this.catalogs.resolveMember(catalog, raw);
        if (id === null) continue;
        filter.ids.add(id);
        const member = catalog.members.find((candidate) => candidate.id === id);
        for (const name of [member?.username, member?.full_name]) {
          if (name) filter.names.add(name.toLowerCase());
        }
      } catch {
        // Not a member here — the plain name stays in the filter.
      }
    }

    return filter;
  }

  private matchesAuthor(entry: ParsedEvent, filter: AuthorFilter): boolean {
    if (entry.authorId !== null && filter.ids.has(entry.authorId)) return true;
    return entry.author !== null && filter.names.has(entry.author.toLowerCase());
  }
}
