import type { ProjectSummary } from "./catalog.js";
import type { ItemType, ProjectCatalog, RawItem } from "./types.js";
import { ITEM_KINDS } from "./types.js";

/** What the formatters need in order to turn IDs back into names and links. */
export interface FormatContext {
  /** Root of the Taiga web UI, used to build `url` fields. */
  webUrl: string;
  /** Catalog of the item's project, when already loaded. Used as a fallback for names. */
  catalog?: ProjectCatalog | null;
}

/** Strip keys that carry no information, so tool output stays small. */
function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** Taiga tags are either plain strings or `[name, color]` pairs. Keep the names. */
export function normalizeTags(tags: RawItem["tags"]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    if (typeof tag === "string") return [tag];
    if (Array.isArray(tag) && typeof tag[0] === "string") return [tag[0]];
    return [];
  });
}

/** Link to the item in the Taiga web UI — the form a human can click. */
export function itemUrl(
  webUrl: string,
  projectSlug: string | undefined,
  type: ItemType,
  ref: number | undefined,
): string | undefined {
  if (!projectSlug || ref === undefined) return undefined;
  return `${webUrl}/project/${projectSlug}/${ITEM_KINDS[type].webSegment}/${ref}`;
}

function userLabel(
  extra: RawItem["assigned_to_extra_info"],
  id: number | null | undefined,
  catalog: ProjectCatalog | null | undefined,
): string | undefined {
  if (extra) {
    const username = extra.username ?? extra.full_name_display ?? extra.full_name;
    if (username) return username;
  }
  if (id === null || id === undefined) return undefined;
  const member = catalog?.members.find((candidate) => candidate.id === id);
  return member?.username ?? String(id);
}

function statusLabel(raw: RawItem, type: ItemType, catalog: ProjectCatalog | null | undefined) {
  const name = raw.status_extra_info?.name;
  if (name) {
    return { name, is_closed: raw.status_extra_info?.is_closed ?? raw.is_closed };
  }
  const status = catalog?.statuses[type].find((candidate) => candidate.id === raw.status);
  return {
    name: status?.name ?? (raw.status === undefined ? undefined : String(raw.status)),
    is_closed: status?.is_closed ?? raw.is_closed,
  };
}

function projectSlugOf(raw: RawItem, catalog: ProjectCatalog | null | undefined): string | undefined {
  return raw.project_extra_info?.slug ?? (catalog?.id === raw.project ? catalog.slug : undefined);
}

function sprintLabel(raw: RawItem, catalog: ProjectCatalog | null | undefined): string | undefined {
  if (raw.milestone_name) return raw.milestone_name;
  if (raw.milestone === null || raw.milestone === undefined) return undefined;
  const sprint = catalog?.sprints.find((candidate) => candidate.id === raw.milestone);
  return sprint?.name ?? String(raw.milestone);
}

/**
 * One-line projection of a work item: enough for a model to decide what to do next,
 * without the forty-odd fields Taiga actually returns.
 */
export function formatItem(
  type: ItemType,
  raw: RawItem,
  context: FormatContext,
): Record<string, unknown> {
  const catalog = context.catalog ?? null;
  const status = statusLabel(raw, type, catalog);
  const slug = projectSlugOf(raw, catalog);

  return compact({
    type,
    id: raw.id,
    ref: raw.ref,
    subject: raw.subject,
    status: status.name,
    is_closed: status.is_closed ?? false,
    assigned_to: userLabel(raw.assigned_to_extra_info, raw.assigned_to, catalog) ?? "unassigned",
    project: slug ?? raw.project,
    sprint: sprintLabel(raw, catalog),
    tags: normalizeTags(raw.tags),
    due_date: raw.due_date,
    is_blocked: raw.is_blocked === true ? true : undefined,
    url: itemUrl(context.webUrl, slug, type, raw.ref),
  });
}

/** Everything in {@link formatItem} plus the fields that only matter once you open an item. */
export function formatItemDetail(
  type: ItemType,
  raw: RawItem,
  context: FormatContext,
): Record<string, unknown> {
  const catalog = context.catalog ?? null;
  const base = formatItem(type, raw, context);
  const capabilities = ITEM_KINDS[type].capabilities;

  const pointsByRole: Record<string, string> = {};
  if (capabilities.points && raw.points && catalog) {
    for (const [roleId, pointId] of Object.entries(raw.points)) {
      const role = catalog.roles.find((candidate) => String(candidate.id) === roleId);
      const point = catalog.points.find((candidate) => candidate.id === pointId);
      if (role && point) pointsByRole[role.name] = point.name;
    }
  }

  return {
    ...base,
    ...compact({
      description: raw.description,
      owner: userLabel(raw.owner_extra_info, raw.owner, catalog),
      blocked_note: raw.is_blocked ? raw.blocked_note : undefined,
      created_date: raw.created_date,
      modified_date: raw.modified_date,
      finished_date: raw.finished_date ?? raw.finish_date,
      watchers: raw.watchers?.length ?? undefined,
      total_points: capabilities.points ? raw.total_points : undefined,
      points: Object.keys(pointsByRole).length ? pointsByRole : undefined,
      // The id, because that is what the `user_story` input of create/update expects. The
      // #ref travels under its own name, so the two numbering spaces cannot be confused.
      user_story: capabilities.parentUserStory
        ? (raw.user_story_extra_info?.id ?? raw.user_story ?? undefined)
        : undefined,
      user_story_ref: capabilities.parentUserStory
        ? raw.user_story_extra_info?.ref
        : undefined,
      issue_type: capabilities.issueFields
        ? catalog?.issueTypes.find((entry) => entry.id === raw.type)?.name
        : undefined,
      severity: capabilities.issueFields
        ? catalog?.severities.find((entry) => entry.id === raw.severity)?.name
        : undefined,
      priority: capabilities.issueFields
        ? catalog?.priorities.find((entry) => entry.id === raw.priority)?.name
        : undefined,
      color: capabilities.color ? raw.color : undefined,
      epics: raw.epics?.map((epic) => ({ id: epic.id, ref: epic.ref, subject: epic.subject })),
      version: raw.version,
    }),
  };
}

/** Projection of {@link ProjectSummary} for `taiga_list_projects`. */
export function formatProjectSummary(project: ProjectSummary): Record<string, unknown> {
  return compact({
    id: project.id,
    slug: project.slug,
    name: project.name,
    is_private: project.isPrivate,
    i_am_admin: project.iAmAdmin,
    modules: Object.entries(project.modules)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    description: project.description,
  });
}

/**
 * The payload of `taiga_project_schema`: every name a write tool may need, and nothing else.
 *
 * Catalogs belonging to a disabled module are omitted — an agent should not offer to
 * create an issue in a project with the issues module turned off.
 */
export function formatCatalog(catalog: ProjectCatalog): Record<string, unknown> {
  const statuses: Record<string, Array<Record<string, unknown>>> = {
    userstory: catalog.statuses.userstory.map((s) => ({ name: s.name, id: s.id, closed: s.is_closed })),
    task: catalog.statuses.task.map((s) => ({ name: s.name, id: s.id, closed: s.is_closed })),
  };
  if (catalog.modules.issues) {
    statuses["issue"] = catalog.statuses.issue.map((s) => ({
      name: s.name,
      id: s.id,
      closed: s.is_closed,
    }));
  }
  if (catalog.modules.epics) {
    statuses["epic"] = catalog.statuses.epic.map((s) => ({
      name: s.name,
      id: s.id,
      closed: s.is_closed,
    }));
  }

  return compact({
    project: {
      id: catalog.id,
      slug: catalog.slug,
      name: catalog.name,
      is_private: catalog.isPrivate,
      i_am_admin: catalog.iAmAdmin,
      i_am_owner: catalog.iAmOwner,
      modules: Object.entries(catalog.modules)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
    },
    statuses,
    members: catalog.members.map((member) =>
      compact({
        username: member.username,
        full_name: member.full_name,
        role: member.role,
        id: member.id,
        inactive: member.is_active ? undefined : true,
      }),
    ),
    sprints: catalog.sprints.map((sprint) =>
      compact({
        name: sprint.name,
        id: sprint.id,
        closed: sprint.closed,
        start: sprint.estimated_start,
        finish: sprint.estimated_finish,
      }),
    ),
    issue_types: catalog.modules.issues ? catalog.issueTypes.map((entry) => entry.name) : undefined,
    severities: catalog.modules.issues ? catalog.severities.map((entry) => entry.name) : undefined,
    priorities: catalog.modules.issues ? catalog.priorities.map((entry) => entry.name) : undefined,
    points: catalog.points.map((point) => point.name),
    roles: catalog.roles.filter((role) => role.computable).map((role) => role.name),
    swimlanes: catalog.swimlanes.map((entry) => entry.name),
    tags: catalog.tags,
    permissions: catalog.permissions,
  });
}

/** One entry of `/history/<type>/<id>`, reduced to a comment and/or a field diff. */
export interface HistoryEntry {
  id?: string;
  created_at?: string;
  comment?: string;
  comment_html?: string;
  delete_comment_date?: string | null;
  edit_comment_date?: string | null;
  user?: { pk?: number; username?: string; name?: string };
  diff?: Record<string, unknown>;
  values?: Record<string, Record<string, string>>;
  [key: string]: unknown;
}

function renderDiff(entry: HistoryEntry): Record<string, string> | undefined {
  if (!entry.diff || typeof entry.diff !== "object") return undefined;
  const changes: Record<string, string> = {};

  for (const [field, change] of Object.entries(entry.diff)) {
    if (field === "comment" || field === "comment_html") continue;
    if (!Array.isArray(change) || change.length !== 2) continue;
    const labels = entry.values?.[field];
    const render = (value: unknown): string => {
      if (value === null || value === undefined || value === "") return "none";
      const asKey = String(value);
      return labels?.[asKey] ?? asKey;
    };
    changes[field] = `${render(change[0])} → ${render(change[1])}`;
  }

  return Object.keys(changes).length ? changes : undefined;
}

/** Turn a raw history entry into `{ author, at, comment, changes }`. */
export function formatHistoryEntry(entry: HistoryEntry): Record<string, unknown> | null {
  const deleted = Boolean(entry.delete_comment_date);
  const comment = deleted ? undefined : entry.comment?.trim() || undefined;
  const changes = renderDiff(entry);
  if (!comment && !changes) return null;

  return compact({
    author: entry.user?.username ?? entry.user?.name,
    at: entry.created_at,
    comment,
    edited: entry.edit_comment_date ? true : undefined,
    changes,
  });
}
