import type { TaigaClient } from "taiga-api-client";
import { CatalogService, ResolutionError, type ProjectRef } from "./catalog.js";
import { describeError } from "./errors.js";
import {
  formatHistoryEntry,
  formatItem,
  formatItemDetail,
  normalizeTags,
  type HistoryEntry,
} from "./format.js";
import type { TaigaSession } from "./session.js";
import type { ItemResource, ItemType, ProjectCatalog, RawItem } from "./types.js";
import { ITEM_KINDS } from "./types.js";

/** How a tool call points at one work item: by global id, or by per-project ref. */
export interface ItemLocator {
  type: ItemType;
  id?: number | undefined;
  ref?: number | undefined;
  project?: ProjectRef | undefined;
}

/** An item together with the catalog of its project, so names can be resolved both ways. */
export interface LoadedItem {
  type: ItemType;
  raw: RawItem;
  catalog: ProjectCatalog;
}

/** Filters accepted by `taiga_list_items`. */
export interface ListInput {
  type: ItemType;
  project?: ProjectRef | undefined;
  status?: string | number | undefined;
  assignedTo?: string | number | undefined;
  sprint?: string | number | undefined;
  tags?: string[] | undefined;
  epic?: number | undefined;
  userStory?: number | undefined;
  issueType?: string | number | undefined;
  severity?: string | number | undefined;
  priority?: string | number | undefined;
  includeClosed?: boolean | undefined;
  orderBy?: string | undefined;
  limit: number;
  page: number;
}

/** Fields accepted by `taiga_create_item`. */
export interface CreateInput {
  type: ItemType;
  project: ProjectRef;
  subject: string;
  description?: string | undefined;
  status?: string | number | undefined;
  assignedTo?: string | number | undefined;
  sprint?: string | number | undefined;
  tags?: string[] | undefined;
  dueDate?: string | undefined;
  isBlocked?: boolean | undefined;
  blockedNote?: string | undefined;
  points?: Record<string, string | number> | undefined;
  color?: string | undefined;
  issueType?: string | number | undefined;
  severity?: string | number | undefined;
  priority?: string | number | undefined;
  userStory?: number | undefined;
  epic?: number | undefined;
}

/** Fields accepted by `taiga_update_item`. Everything is optional except the locator. */
export interface UpdateInput extends ItemLocator {
  subject?: string | undefined;
  description?: string | undefined;
  status?: string | number | undefined;
  assignedTo?: string | number | undefined;
  sprint?: string | number | undefined;
  tags?: string[] | undefined;
  addTags?: string[] | undefined;
  removeTags?: string[] | undefined;
  dueDate?: string | null | undefined;
  isBlocked?: boolean | undefined;
  blockedNote?: string | undefined;
  points?: Record<string, string | number> | undefined;
  color?: string | undefined;
  issueType?: string | number | undefined;
  severity?: string | number | undefined;
  priority?: string | number | undefined;
  userStory?: number | null | undefined;
  comment?: string | undefined;
}

interface ResolverResponse {
  project?: number;
  [key: string]: number | undefined;
}

/** Pick the typed resource of `taiga-api-client` that serves one item kind. */
export function resourceFor(client: TaigaClient, type: ItemType): ItemResource {
  switch (type) {
    case "userstory":
      return client.userStories as unknown as ItemResource;
    case "task":
      return client.tasks as unknown as ItemResource;
    case "issue":
      return client.issues as unknown as ItemResource;
    case "epic":
      return client.epics as unknown as ItemResource;
  }
}

function sortKey(item: Record<string, unknown>): string {
  // Items with a due date come first, oldest due date first; then by subject.
  const due = typeof item["due_date"] === "string" ? item["due_date"] : "9999-12-31";
  return `${due}#${String(item["subject"] ?? "")}`;
}

/**
 * All the work-item behaviour behind the MCP tools: lookup by id or ref, filtered lists,
 * creation, partial updates with optimistic concurrency, comments, history and search.
 *
 * Every human-readable value (status, assignee, sprint, severity, ...) is resolved through
 * {@link CatalogService} before it reaches the Taiga API.
 */
export class ItemService {
  constructor(
    private readonly session: TaigaSession,
    private readonly catalogs: CatalogService,
  ) {}

  private get formatContext() {
    return { webUrl: this.session.webUrl };
  }

  /** Resolve a locator to a numeric item id, fetching as little as possible. */
  async resolveId(locator: ItemLocator): Promise<number> {
    if (locator.id !== undefined) return locator.id;
    if (locator.ref === undefined) {
      throw new ResolutionError(
        `Pass either "id" (global) or "ref" together with "project" (the #number shown in the UI).`,
      );
    }
    if (locator.project === undefined) {
      throw new ResolutionError(
        `"ref" is only unique inside a project — pass "project" as well, or use "id".`,
      );
    }

    const catalog = await this.catalogs.catalog(locator.project);
    const kind = ITEM_KINDS[locator.type];
    const resolved = await this.session.run(
      async (client) =>
        (
          await client.http.get<ResolverResponse>("/resolver", {
            query: { project: catalog.slug, [kind.resolverKey]: locator.ref as number },
          })
        ).data,
    );

    const id = resolved[kind.resolverKey];
    if (typeof id !== "number") {
      throw new ResolutionError(
        `No ${kind.label} #${locator.ref} in project "${catalog.slug}".`,
      );
    }
    return id;
  }

  /** Fetch one item plus the catalog of its project. */
  async load(locator: ItemLocator): Promise<LoadedItem> {
    const id = await this.resolveId(locator);
    const raw = await this.session.run((client) => resourceFor(client, locator.type).get(id));
    const catalog = await this.catalogs.catalog(raw.project);
    return { type: locator.type, raw, catalog };
  }

  /** Detailed projection of one item, optionally with its children. */
  async detail(
    locator: ItemLocator,
    options: { includeTasks?: boolean; includeUserStories?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const loaded = await this.load(locator);
    const context = { ...this.formatContext, catalog: loaded.catalog };
    const payload = formatItemDetail(loaded.type, loaded.raw, context);
    const pageSize = this.session.settings.maxResults;

    if (options.includeTasks && loaded.type === "userstory") {
      const page = await this.session.run((client) =>
        client.tasks.listPage(
          { project: loaded.catalog.id, user_story: loaded.raw.id, page_size: pageSize },
          1,
        ),
      );
      payload["tasks"] = (page.data as unknown as RawItem[]).map((task) =>
        formatItem("task", task, context),
      );
      this.noteTruncation(payload, "tasks", page);
    }

    if (options.includeUserStories && loaded.type === "epic") {
      // One filtered list, rather than the links endpoint plus a GET per story.
      const page = await this.session.run((client) =>
        client.userStories.listPage(
          { project: loaded.catalog.id, epic: loaded.raw.id, page_size: pageSize },
          1,
        ),
      );
      payload["user_stories"] = (page.data as unknown as RawItem[]).map((story) =>
        formatItem("userstory", story, context),
      );
      this.noteTruncation(payload, "user_stories", page);
    }

    return payload;
  }

  /** Filtered, paginated list of one item kind. */
  async list(input: ListInput): Promise<Record<string, unknown>> {
    const catalog = input.project !== undefined ? await this.catalogs.catalog(input.project) : null;
    const query = await this.buildListQuery(input, catalog);

    const result = await this.session.run((client) =>
      resourceFor(client, input.type).listPage(query, input.page),
    );
    const context = { ...this.formatContext, catalog };

    return {
      items: result.data.map((raw) => formatItem(input.type, raw, context)),
      page: input.page,
      returned: result.data.length,
      ...(result.pagination
        ? { total: result.pagination.count, has_more: result.pagination.next !== null }
        : {}),
    };
  }

  /** Everything currently assigned to the authenticated user, grouped by item kind. */
  async myWork(input: {
    project?: ProjectRef | undefined;
    types: ItemType[];
    includeClosed: boolean;
    limit: number;
  }): Promise<Record<string, unknown>> {
    const meId = await this.session.currentUserId();
    const catalog = input.project !== undefined ? await this.catalogs.catalog(input.project) : null;
    const context = { ...this.formatContext, catalog };

    const groups: Record<string, Array<Record<string, unknown>>> = {};
    let total = 0;

    for (const type of input.types) {
      const query: Record<string, unknown> = {
        assigned_to: meId,
        page_size: input.limit,
        ...(catalog ? { project: catalog.id } : {}),
        ...(input.includeClosed ? {} : { status__is_closed: false }),
      };

      const result = await this.session.run((client) =>
        resourceFor(client, type).listPage(query, 1),
      );
      const items = result.data
        .filter((raw) => input.includeClosed || raw.is_closed !== true)
        .map((raw) => formatItem(type, raw, context))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

      if (items.length) {
        groups[ITEM_KINDS[type].labelPlural.replace(/\s+/g, "_")] = items;
        total += items.length;
      }
    }

    const user = await this.session.currentUser();
    return {
      user: user.username,
      scope: catalog ? catalog.slug : "all projects",
      include_closed: input.includeClosed,
      total,
      ...groups,
    };
  }

  /** Create one item. Human-readable references in the input are resolved first. */
  async create(input: CreateInput): Promise<Record<string, unknown>> {
    const catalog = await this.catalogs.catalog(input.project);
    const kind = ITEM_KINDS[input.type];
    const capabilities = kind.capabilities;

    if (input.epic !== undefined && input.type !== "userstory") {
      // Checked before the POST: refusing afterwards would leave a created item behind.
      throw new ResolutionError(`Only user stories can be linked to an epic.`);
    }

    const payload: Record<string, unknown> = {
      project: catalog.id,
      subject: input.subject,
    };
    if (input.description !== undefined) payload["description"] = input.description;
    if (input.status !== undefined) {
      payload["status"] = this.catalogs.resolveStatus(catalog, input.type, input.status);
    }
    if (input.assignedTo !== undefined) {
      payload["assigned_to"] = await this.catalogs.resolveMember(catalog, input.assignedTo);
    }
    if (input.tags !== undefined) payload["tags"] = input.tags;
    if (input.isBlocked !== undefined) payload["is_blocked"] = input.isBlocked;
    if (input.blockedNote !== undefined) payload["blocked_note"] = input.blockedNote;

    if (input.sprint !== undefined) {
      this.requireCapability(capabilities.milestone, kind.labelPlural, "a sprint");
      this.requireSprintIsSettable(input.type, input.userStory !== undefined);
      payload["milestone"] = this.catalogs.resolveSprint(catalog, input.sprint);
    }
    if (input.dueDate !== undefined) {
      this.requireCapability(capabilities.dueDate, kind.labelPlural, "a due date");
      payload["due_date"] = input.dueDate;
    }
    if (input.points !== undefined) {
      this.requireCapability(capabilities.points, kind.labelPlural, "story points");
      payload["points"] = this.catalogs.resolvePoints(catalog, input.points);
    }
    if (input.color !== undefined) {
      this.requireCapability(capabilities.color, kind.labelPlural, "a color");
      payload["color"] = input.color;
    }
    if (input.userStory !== undefined) {
      this.requireCapability(capabilities.parentUserStory, kind.labelPlural, "a parent user story");
      payload["user_story"] = input.userStory;
    }
    if (input.issueType !== undefined || input.severity !== undefined || input.priority !== undefined) {
      this.requireCapability(
        capabilities.issueFields,
        kind.labelPlural,
        "type / severity / priority",
      );
    }
    if (input.issueType !== undefined) {
      payload["type"] = this.catalogs.resolveNamed(
        catalog.issueTypes,
        input.issueType,
        "issue type",
        catalog.slug,
      );
    }
    if (input.severity !== undefined) {
      payload["severity"] = this.catalogs.resolveNamed(
        catalog.severities,
        input.severity,
        "severity",
        catalog.slug,
      );
    }
    if (input.priority !== undefined) {
      payload["priority"] = this.catalogs.resolveNamed(
        catalog.priorities,
        input.priority,
        "priority",
        catalog.slug,
      );
    }

    const created = await this.session.run((client) =>
      resourceFor(client, input.type).create(payload),
    );

    const context = { ...this.formatContext, catalog };
    const result = formatItemDetail(input.type, created, context);

    if (input.epic !== undefined) {
      // The item exists by now, so a failed link must not read as a failed create — the
      // caller would retry and end up with a duplicate.
      try {
        await this.session.run((client) =>
          client.epics.addRelatedUserStory(input.epic as number, { user_story: created.id }),
        );
        result["linked_epic"] = input.epic;
      } catch (error) {
        result["linked_epic_error"] = describeError(error);
      }
    }

    return result;
  }

  /** Partially update one item, carrying its `version` so Taiga can detect conflicts. */
  async update(input: UpdateInput): Promise<Record<string, unknown>> {
    const loaded = await this.load(input);
    const { catalog, raw } = loaded;
    const kind = ITEM_KINDS[input.type];
    const capabilities = kind.capabilities;
    const payload: Record<string, unknown> = {};

    if (input.subject !== undefined) payload["subject"] = input.subject;
    if (input.description !== undefined) payload["description"] = input.description;
    if (input.status !== undefined) {
      payload["status"] = this.catalogs.resolveStatus(catalog, input.type, input.status);
    }
    if (input.assignedTo !== undefined) {
      payload["assigned_to"] = await this.catalogs.resolveMember(catalog, input.assignedTo);
    }
    if (input.isBlocked !== undefined) payload["is_blocked"] = input.isBlocked;
    if (input.blockedNote !== undefined) payload["blocked_note"] = input.blockedNote;
    if (input.comment !== undefined) payload["comment"] = input.comment;

    if (input.sprint !== undefined) {
      this.requireCapability(capabilities.milestone, kind.labelPlural, "a sprint");
      this.requireSprintIsSettable(
        input.type,
        input.userStory !== undefined && input.userStory !== null
          ? true
          : raw.user_story !== null && raw.user_story !== undefined,
      );
      payload["milestone"] = this.catalogs.resolveSprint(catalog, input.sprint);
    }
    if (input.dueDate !== undefined) {
      this.requireCapability(capabilities.dueDate, kind.labelPlural, "a due date");
      payload["due_date"] = input.dueDate;
    }
    if (input.points !== undefined) {
      this.requireCapability(capabilities.points, kind.labelPlural, "story points");
      payload["points"] = this.catalogs.resolvePoints(catalog, input.points);
    }
    if (input.color !== undefined) {
      this.requireCapability(capabilities.color, kind.labelPlural, "a color");
      payload["color"] = input.color;
    }
    if (input.userStory !== undefined) {
      this.requireCapability(capabilities.parentUserStory, kind.labelPlural, "a parent user story");
      payload["user_story"] = input.userStory;
    }
    if (input.issueType !== undefined || input.severity !== undefined || input.priority !== undefined) {
      this.requireCapability(
        capabilities.issueFields,
        kind.labelPlural,
        "type / severity / priority",
      );
    }
    if (input.issueType !== undefined) {
      payload["type"] = this.catalogs.resolveNamed(
        catalog.issueTypes,
        input.issueType,
        "issue type",
        catalog.slug,
      );
    }
    if (input.severity !== undefined) {
      payload["severity"] = this.catalogs.resolveNamed(
        catalog.severities,
        input.severity,
        "severity",
        catalog.slug,
      );
    }
    if (input.priority !== undefined) {
      payload["priority"] = this.catalogs.resolveNamed(
        catalog.priorities,
        input.priority,
        "priority",
        catalog.slug,
      );
    }

    const tags = this.mergeTags(raw, input);
    if (tags) payload["tags"] = tags;

    if (Object.keys(payload).length === 0) {
      throw new ResolutionError(
        `Nothing to update — pass at least one field (status, assigned_to, subject, ...).`,
      );
    }

    const updated = await this.session.run((client) =>
      resourceFor(client, input.type).patch(raw.id, payload, raw.version),
    );

    const context = { ...this.formatContext, catalog };
    return {
      ...formatItemDetail(input.type, updated, context),
      changed: this.summarizeChanges(input.type, raw, updated, context, payload),
    };
  }

  /** Delete one item. Only reachable when the server runs with deletes enabled. */
  async remove(locator: ItemLocator): Promise<Record<string, unknown>> {
    const loaded = await this.load(locator);
    await this.session.run((client) => resourceFor(client, locator.type).delete(loaded.raw.id));
    return {
      deleted: true,
      type: locator.type,
      id: loaded.raw.id,
      ref: loaded.raw.ref,
      subject: loaded.raw.subject,
      project: loaded.catalog.slug,
    };
  }

  /** Add a comment. In Taiga a comment is a `comment` field on a PATCH of the item. */
  async comment(locator: ItemLocator, text: string): Promise<Record<string, unknown>> {
    const loaded = await this.load(locator);
    await this.session.run((client) =>
      resourceFor(client, locator.type).patch(
        loaded.raw.id,
        { comment: text },
        loaded.raw.version,
      ),
    );
    const context = { ...this.formatContext, catalog: loaded.catalog };
    return {
      commented: true,
      comment: text,
      item: formatItem(locator.type, loaded.raw, context),
    };
  }

  /** Comment thread (and optionally the field changes) of one item, newest last. */
  async history(
    locator: ItemLocator,
    options: { limit: number; includeChanges: boolean },
  ): Promise<Record<string, unknown>> {
    const id = await this.resolveId(locator);
    const segment = ITEM_KINDS[locator.type].historySegment;
    const entries = await this.session.run(
      async (client) =>
        (await client.http.get<HistoryEntry[]>(`/history/${segment}/${id}`)).data ?? [],
    );

    // Taiga serves history newest-first; present it chronologically so "the last N
    // entries" means the most recent ones.
    const mapped = [...entries]
      .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
      .map((entry) => formatHistoryEntry(entry))
      .filter((entry): entry is Record<string, unknown> => entry !== null)
      .filter((entry) => options.includeChanges || typeof entry["comment"] === "string");

    return {
      type: locator.type,
      id,
      total: mapped.length,
      entries: mapped.slice(-options.limit),
    };
  }

  /** Full-text search inside one project, across every item kind. */
  async search(input: {
    project: ProjectRef;
    text: string;
    types: ItemType[];
    limit: number;
  }): Promise<Record<string, unknown>> {
    const catalog = await this.catalogs.catalog(input.project);
    const raw = await this.session.run(
      async (client) =>
        (
          await client.http.get<Record<string, unknown>>("/search", {
            query: { project: catalog.id, text: input.text },
          })
        ).data,
    );

    const context = { ...this.formatContext, catalog };
    const result: Record<string, unknown> = { project: catalog.slug, text: input.text };
    let total = 0;

    for (const type of input.types) {
      const bucket = raw[ITEM_KINDS[type].searchKey];
      if (!Array.isArray(bucket) || bucket.length === 0) continue;
      const items = (bucket as RawItem[])
        .slice(0, input.limit)
        .map((item) => formatItem(type, item, context));
      result[ITEM_KINDS[type].labelPlural.replace(/\s+/g, "_")] = items;
      total += items.length;
    }

    result["total"] = total;
    return result;
  }

  /** Create a sprint (Taiga milestone) and refresh the project catalog that lists it. */
  async createSprint(input: {
    project: ProjectRef;
    name: string;
    start: string;
    finish: string;
  }): Promise<Record<string, unknown>> {
    const catalog = await this.catalogs.catalog(input.project);
    const milestone = await this.session.run((client) =>
      client.milestones.create({
        project: catalog.id,
        name: input.name,
        estimated_start: input.start,
        estimated_finish: input.finish,
      }),
    );
    this.catalogs.invalidate();

    return {
      created: true,
      sprint: {
        id: milestone.id,
        name: milestone.name,
        start: milestone.estimated_start,
        finish: milestone.estimated_finish,
        project: catalog.slug,
      },
    };
  }

  /** Attach a user story to an epic, or detach it. */
  async linkEpic(input: {
    epic: ItemLocator;
    userStory: ItemLocator;
    action: "link" | "unlink";
  }): Promise<Record<string, unknown>> {
    const epicId = await this.resolveId({ ...input.epic, type: "epic" });
    const storyId = await this.resolveId({ ...input.userStory, type: "userstory" });

    await this.session.run(async (client) => {
      if (input.action === "link") {
        await client.epics.addRelatedUserStory(epicId, { user_story: storyId });
      } else {
        await client.epics.removeRelatedUserStory(epicId, storyId);
      }
    });

    return { action: input.action, epic: epicId, user_story: storyId, ok: true };
  }

  /**
   * Translate list filters into Taiga query parameters.
   *
   * Names (status, sprint, severity, ...) only exist inside a project, so a filter given by
   * name without a project is rejected with an explanation rather than silently ignored.
   */
  private async buildListQuery(
    input: ListInput,
    catalog: ProjectCatalog | null,
  ): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = { page_size: input.limit };
    if (catalog) query["project"] = catalog.id;

    if (input.status !== undefined) {
      query["status"] = this.catalogs.resolveStatus(
        this.requireCatalog(catalog, "status"),
        input.type,
        input.status,
      );
    } else if (!input.includeClosed) {
      // Only exclude closed items when no explicit status was asked for, otherwise a
      // filter on a closed status would always come back empty.
      query["status__is_closed"] = false;
    }

    if (input.assignedTo !== undefined) {
      const assignee = await this.resolveAssignee(input.assignedTo, catalog);
      query["assigned_to"] = assignee === null ? "null" : assignee;
    }
    if (input.sprint !== undefined) {
      query["milestone"] =
        this.catalogs.resolveSprint(this.requireCatalog(catalog, "sprint"), input.sprint) ?? "null";
    }
    if (input.tags?.length) query["tags"] = input.tags.join(",");
    if (input.epic !== undefined) query["epic"] = input.epic;
    if (input.userStory !== undefined) query["user_story"] = input.userStory;
    if (input.issueType !== undefined) {
      const resolved = this.requireCatalog(catalog, "issue type");
      query["type"] = this.catalogs.resolveNamed(
        resolved.issueTypes,
        input.issueType,
        "issue type",
        resolved.slug,
      );
    }
    if (input.severity !== undefined) {
      const resolved = this.requireCatalog(catalog, "severity");
      query["severity"] = this.catalogs.resolveNamed(
        resolved.severities,
        input.severity,
        "severity",
        resolved.slug,
      );
    }
    if (input.priority !== undefined) {
      const resolved = this.requireCatalog(catalog, "priority");
      query["priority"] = this.catalogs.resolveNamed(
        resolved.priorities,
        input.priority,
        "priority",
        resolved.slug,
      );
    }
    if (input.orderBy) query["order_by"] = input.orderBy;

    return query;
  }

  /** `"me"`, a user id and `"unassigned"` need no catalog; a username does. */
  private async resolveAssignee(
    value: string | number,
    catalog: ProjectCatalog | null,
  ): Promise<number | null> {
    if (typeof value === "number") return value;
    const raw = value.trim().toLowerCase();
    if (/^\d+$/.test(raw)) return Number(raw);
    if (raw === "me" || raw === "self") return this.session.currentUserId();
    if (raw === "unassigned" || raw === "none" || raw === "null" || raw === "") return null;
    return this.catalogs.resolveMember(this.requireCatalog(catalog, "assignee name"), value);
  }

  private requireCatalog(catalog: ProjectCatalog | null, field: string): ProjectCatalog {
    if (!catalog) {
      throw new ResolutionError(
        `Filtering by ${field} requires "project": ${field} values are configured per project.`,
      );
    }
    return catalog;
  }

  /**
   * Taiga derives a task's sprint from its parent user story and ignores `milestone` on a
   * task that has one. Saying so beats letting the field be silently dropped.
   */
  private requireSprintIsSettable(type: ItemType, hasParentStory: boolean): void {
    if (type === "task" && hasParentStory) {
      throw new ResolutionError(
        "A task that belongs to a user story always follows that story's sprint — Taiga " +
          "ignores a sprint set on the task itself. Move the user story instead " +
          '(taiga_update_item on the story with "sprint"), or create the task without a ' +
          "parent user story.",
      );
    }
  }

  /**
   * Taiga answers a list request with a single page. Say so when children were cut off,
   * instead of letting a truncated list read as the whole set.
   */
  private noteTruncation(
    payload: Record<string, unknown>,
    key: string,
    page: { data: unknown[]; pagination: { count: number } | null },
  ): void {
    const total = page.pagination?.count;
    if (total !== undefined && total > page.data.length) {
      payload[`${key}_truncated`] = { shown: page.data.length, total };
    }
  }

  private requireCapability(allowed: boolean, labelPlural: string, what: string): void {
    if (!allowed) {
      throw new ResolutionError(`Taiga ${labelPlural} do not have ${what}.`);
    }
  }

  private mergeTags(raw: RawItem, input: UpdateInput): string[] | null {
    if (input.tags !== undefined) return input.tags;
    if (input.addTags === undefined && input.removeTags === undefined) return null;

    const current = new Set(normalizeTags(raw.tags));
    for (const tag of input.addTags ?? []) current.add(tag);
    for (const tag of input.removeTags ?? []) {
      for (const existing of current) {
        if (existing.toLowerCase() === tag.toLowerCase()) current.delete(existing);
      }
    }
    return [...current];
  }

  /**
   * Describe what actually changed, by diffing the compact projection of the item
   * before and after the patch. Gives the caller a one-glance confirmation.
   */
  private summarizeChanges(
    type: ItemType,
    before: RawItem,
    after: RawItem,
    context: { webUrl: string; catalog: ProjectCatalog },
    payload: Record<string, unknown>,
  ): Record<string, string> {
    const skip = new Set(["type", "id", "ref", "url", "project"]);
    const from = formatItem(type, before, context);
    const to = formatItem(type, after, context);
    const changes: Record<string, string> = {};

    const render = (value: unknown): string => {
      if (value === null || value === undefined || value === "") return "none";
      if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
      return String(value);
    };

    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (skip.has(key)) continue;
      if (JSON.stringify(from[key] ?? null) === JSON.stringify(to[key] ?? null)) continue;
      changes[key] = `${render(from[key])} → ${render(to[key])}`;
    }

    if ("description" in payload && before.description !== after.description) {
      changes["description"] = "updated";
    }
    if ("comment" in payload) changes["comment"] = "added";

    return changes;
  }
}
