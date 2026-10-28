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

/** Running state of one item while its events are folded together. */
interface ItemAccumulator {
  target: EventTarget;
  type: ItemType;
  statusPath: string[];
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
}

/** The inventory of a project: every item of the requested kinds, by id. */
interface Inventory {
  byType: Map<ItemType, Map<number, RawItem>>;
  /** Kinds whose full list came back, so a retroactive closure can be spotted in them. */
  complete: Set<ItemType>;
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
      ...(input.groupBy === "event" ? { events } : { items }),
      sprints,
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
    try {
      const collected = await this.fetchTimeline(catalog.id, window, input.maxPages);
      raw = collected.events;
      outcome.scanned = collected.scanned;
      outcome.truncated = collected.truncated;
      if (collected.truncated && !collected.reachedWindow) outcome.windowReached = false;
      if (collected.failure) {
        outcome.degraded =
          `The timeline walk stopped early, so the window is only partly covered — ` +
          collected.failure;
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

    const accumulators = new Map<string, ItemAccumulator>();
    for (const entry of parsed) {
      // A sprint is not a card: its changes are reported through `sprints`.
      if (entry.target.type === "milestone") {
        sprints.push(...this.sprintRows(catalog, entry));
        continue;
      }
      this.fold(accumulators, entry, input);
    }

    const inventory = await this.loadInventory(catalog, itemTypes, accumulators, outcome);
    const assembled = this.assemble(catalog, window, input, itemTypes, accumulators, inventory);

    if (input.groupBy === "event") {
      // Whatever a filter removed from the cards is removed from the chronology too.
      const filtered = Boolean(input.tags?.length) || !input.includePlanning;
      const known = new Set(assembled.map((row) => `${String(row["type"])}:${String(row["id"])}`));
      events.push(...this.eventRows(catalog, parsed, input, filtered ? known : null));
    }

    const rows = input.foldTasks ? this.foldTasks(assembled) : assembled;
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
    scanned: number;
    truncated: boolean;
    reachedWindow: boolean;
    failure: string | null;
  }> {
    const budget = Math.max(1, Math.min(maxPages, MAX_PAGES_CEILING));
    const events: TimelineEvent[] = [];
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
        if (at >= window.untilMs) continue;
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
    return { events, scanned, truncated: !reachedStart, reachedWindow, failure };
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
        statusPath: [],
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
      };
      accumulators.set(key, acc);
    }

    // Later events can name what earlier ones left out (a subject, a #ref, a parent story).
    if (target.ref !== undefined) acc.target.ref = target.ref;
    if (target.subject !== undefined) acc.target.subject = target.subject;
    if (target.parent !== undefined) acc.target.parent = target.parent;

    acc.events += 1;
    acc.lastAt = entry.at;
    acc.attachmentsAdded += entry.attachmentsAdded;
    acc.attachmentsRemoved += entry.attachmentsRemoved;

    for (const change of entry.changes) {
      if (isWork(change)) acc.hasWork = true;
      if (isClosing(change)) acc.closedByEvent = true;
      if (change.kind === "status") {
        if (acc.statusPath.length === 0) pushStatus(acc.statusPath, change.from);
        pushStatus(acc.statusPath, change.to);
      }
      if (change.kind === "description") acc.descriptionChanged = true;
      if (change.kind === "sprint") {
        acc.sprintChanged = true;
        acc.sprint = change.to ?? null;
      }
      if (change.kind === "assignee") {
        acc.reassigned.push([change.from ?? null, change.to ?? null]);
      }
    }

    if (entry.comment !== null) {
      acc.hasComment = true;
      if (input.includeComments) {
        const { text, truncated } = truncateText(entry.comment, input.commentChars);
        acc.comments.push({
          at: entry.at,
          author: entry.author,
          text,
          ...(truncated ? { truncated: true } : {}),
        });
      }
    }
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
    accumulators: Map<string, ItemAccumulator>,
    inventory: Inventory,
  ): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    const covered = new Set<string>();

    for (const [key, acc] of accumulators) {
      covered.add(key);
      const raw = inventory.byType.get(acc.type)?.get(acc.target.id) ?? null;
      const row = this.itemRow(catalog, window, input, acc, raw);
      if (row) rows.push(row);
    }

    // Rule: a card whose finish date falls inside the window and which is closed now was
    // worked on in the window, even when its only event — the status move — came later.
    for (const type of itemTypes) {
      if (!inventory.complete.has(type)) continue;
      for (const raw of inventory.byType.get(type)?.values() ?? []) {
        const key = `${type}:${raw.id}`;
        if (covered.has(key)) continue;
        if (!this.finishedInWindow(type, raw, catalog, window)) continue;
        // Nobody authored this row, so a filter on authors cannot vouch for it.
        if (input.users?.length) continue;
        const row = this.itemRow(catalog, window, input, null, raw, type);
        if (row) rows.push(row);
      }
    }

    // Planning is more than half of a busy week, and a report that lists it has to read
    // past it. Dropping it here keeps the per-project counters honest about what is in
    // the answer.
    return input.includePlanning ? rows : rows.filter((row) => row["planning_only"] !== true);
  }

  /**
   * Nest a task under its parent story.
   *
   * A weekly report is written one line per story, with the tasks as the evidence under
   * it. A task whose story saw no activity in the window — or was dropped by a filter —
   * has nothing to nest under and stays where it is.
   */
  private foldTasks(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
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
      // Both are implied by where the task now sits.
      delete nested["project"];
      delete nested["parent"];
      const list = (story["tasks"] as Array<Record<string, unknown>> | undefined) ?? [];
      list.push(nested);
      story["tasks"] = list;
    }

    for (const story of stories.values()) {
      const list = story["tasks"] as Array<Record<string, unknown>> | undefined;
      if (!list) continue;
      const at = (row: Record<string, unknown>): string => String(row["last_event_at"]);
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
    fallbackType?: ItemType,
  ): Record<string, unknown> | null {
    const type = acc?.type ?? fallbackType;
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
    const closedByEvent = acc?.closedByEvent === true;
    const closedInPeriod = closedByEvent || closedByFinishDate;

    const source = acc
      ? closedByFinishDate
        ? "both"
        : "timeline"
      : "finish_date";

    const row: Record<string, unknown> = {
      project: catalog.slug,
      type,
      id,
      ref: ref ?? null,
      subject: acc?.target.subject ?? raw?.subject ?? null,
      url: itemUrl(this.session.webUrl, catalog.slug, type, ref) ?? null,
      ...(acc?.target.parent ? { parent: acc.target.parent } : {}),
      status_now: projection?.["status"] ?? null,
      tags,
      sprint: projection?.["sprint"] ?? null,
      assignees: this.assigneesOf(raw, catalog),
      status_path: acc?.statusPath ?? [],
      closed_in_period: closedInPeriod,
      finish_date: finishDate,
      source,
      planning_only: acc ? !(acc.hasWork || acc.hasComment || closedInPeriod) : false,
      first_event_at: acc?.firstAt ?? null,
      last_event_at: acc?.lastAt ?? null,
      events_count: acc?.events ?? 0,
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
