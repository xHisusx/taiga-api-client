/** Shared types for the Taiga MCP server. */

/** The four Taiga work-item kinds this server can read and write. */
export const ITEM_TYPES = ["userstory", "task", "issue", "epic"] as const;

/** Discriminator used by every polymorphic tool (`taiga_get_item`, `taiga_update_item`, ...). */
export type ItemType = (typeof ITEM_TYPES)[number];

/** Which optional fields a given item kind accepts. Used to reject nonsense early with a clear message. */
export interface ItemCapabilities {
  /** Can be attached to a sprint (`milestone`). Epics cannot. */
  milestone: boolean;
  /** Has a `due_date`. Epics do not. */
  dueDate: boolean;
  /** Has role-based story points. Only user stories do. */
  points: boolean;
  /** Belongs to a parent user story. Only tasks do. */
  parentUserStory: boolean;
  /** Has `type` / `severity` / `priority`. Only issues do. */
  issueFields: boolean;
  /** Has a badge `color`. Only epics do. */
  color: boolean;
}

/** Static description of one item kind: API paths, URL segments and capabilities. */
export interface ItemKind {
  type: ItemType;
  /** Human-readable singular label, used in messages. */
  label: string;
  /** Plural label for list output. */
  labelPlural: string;
  /** Key of this kind inside a `/resolver` response and query string, e.g. `us`. */
  resolverKey: string;
  /** Path segment of the Taiga web UI, e.g. `us` in `/project/slug/us/12`. */
  webSegment: string;
  /** Path segment of the `/history/<segment>/<id>` endpoint. */
  historySegment: string;
  /** Key holding this kind in a `/search` response. */
  searchKey: string;
  capabilities: ItemCapabilities;
}

const CAPS = (over: Partial<ItemCapabilities>): ItemCapabilities => ({
  milestone: false,
  dueDate: false,
  points: false,
  parentUserStory: false,
  issueFields: false,
  color: false,
  ...over,
});

/** Registry of every supported item kind, keyed by {@link ItemType}. */
export const ITEM_KINDS: Record<ItemType, ItemKind> = {
  userstory: {
    type: "userstory",
    label: "user story",
    labelPlural: "user stories",
    resolverKey: "us",
    webSegment: "us",
    historySegment: "userstory",
    searchKey: "userstories",
    capabilities: CAPS({ milestone: true, dueDate: true, points: true }),
  },
  task: {
    type: "task",
    label: "task",
    labelPlural: "tasks",
    resolverKey: "task",
    webSegment: "task",
    historySegment: "task",
    searchKey: "tasks",
    capabilities: CAPS({ milestone: true, dueDate: true, parentUserStory: true }),
  },
  issue: {
    type: "issue",
    label: "issue",
    labelPlural: "issues",
    resolverKey: "issue",
    webSegment: "issue",
    historySegment: "issue",
    searchKey: "issues",
    capabilities: CAPS({ milestone: true, dueDate: true, issueFields: true }),
  },
  epic: {
    type: "epic",
    label: "epic",
    labelPlural: "epics",
    resolverKey: "epic",
    webSegment: "epic",
    historySegment: "epic",
    searchKey: "epics",
    capabilities: CAPS({ color: true }),
  },
};

/** Nested user projection Taiga embeds into list/detail responses as `*_extra_info`. */
export interface ExtraInfoUser {
  id?: number;
  pk?: number;
  username?: string;
  full_name?: string;
  full_name_display?: string;
  photo?: string | null;
}

/**
 * Loose shape of a work item as returned by Taiga.
 *
 * Deliberately permissive: one interface covers user stories, tasks, issues and epics,
 * and the `*_extra_info` projections Taiga adds to list responses are optional because
 * they are absent from some endpoints.
 */
export interface RawItem {
  id: number;
  ref?: number;
  project: number;
  subject?: string;
  description?: string;
  status?: number;
  is_closed?: boolean;
  is_blocked?: boolean;
  blocked_note?: string;
  assigned_to?: number | null;
  assigned_users?: number[];
  owner?: number;
  watchers?: number[];
  milestone?: number | null;
  milestone_name?: string | null;
  milestone_slug?: string | null;
  tags?: Array<string | [string, string | null]> | null;
  due_date?: string | null;
  due_date_reason?: string;
  version?: number;
  created_date?: string;
  modified_date?: string;
  finish_date?: string | null;
  finished_date?: string | null;
  total_points?: number | null;
  points?: Record<string, number>;
  user_story?: number | null;
  type?: number;
  severity?: number;
  priority?: number;
  color?: string;
  epics?: Array<{ id: number; ref?: number; subject?: string }> | null;
  total_comments?: number;
  status_extra_info?: { name?: string; color?: string; is_closed?: boolean } | null;
  assigned_to_extra_info?: ExtraInfoUser | null;
  owner_extra_info?: ExtraInfoUser | null;
  project_extra_info?: { id?: number; name?: string; slug?: string } | null;
  user_story_extra_info?: { id?: number; ref?: number; subject?: string } | null;
  [key: string]: unknown;
}

/** A status configured in a project, e.g. `In progress`. */
export interface CatalogStatus {
  id: number;
  name: string;
  is_closed: boolean;
  order?: number;
}

/** A plain `{ id, name }` catalog entry (issue type, severity, priority, swimlane). */
export interface CatalogNamed {
  id: number;
  name: string;
}

/** A project role. Only `computable` roles take part in story-point estimation. */
export interface CatalogRole {
  id: number;
  name: string;
  computable: boolean;
}

/** One entry of the project's story-point scale. */
export interface CatalogPoint {
  id: number;
  name: string;
  value: number | null;
}

/** A project member, with the name of their role. */
export interface CatalogMember {
  id: number;
  username: string;
  full_name: string;
  role: string | null;
  is_active: boolean;
}

/** A sprint (Taiga calls it a milestone). */
export interface CatalogSprint {
  id: number;
  name: string;
  slug?: string;
  closed: boolean;
  estimated_start?: string;
  estimated_finish?: string;
}

/**
 * Everything the server needs to know about one project to translate human names
 * ("In progress", "alice", "Sprint 4") into the numeric IDs the Taiga API expects.
 *
 * Built from a single `GET /projects/:id` call and cached with a TTL.
 */
export interface ProjectCatalog {
  id: number;
  slug: string;
  name: string;
  description: string;
  isPrivate: boolean;
  iAmAdmin: boolean;
  iAmOwner: boolean;
  /** Taiga's `my_permissions` — the actions the authenticated user may perform here. */
  permissions: string[];
  modules: {
    backlog: boolean;
    kanban: boolean;
    issues: boolean;
    epics: boolean;
    wiki: boolean;
  };
  statuses: Record<ItemType, CatalogStatus[]>;
  issueTypes: CatalogNamed[];
  severities: CatalogNamed[];
  priorities: CatalogNamed[];
  points: CatalogPoint[];
  roles: CatalogRole[];
  swimlanes: CatalogNamed[];
  members: CatalogMember[];
  sprints: CatalogSprint[];
  tags: string[];
}

/**
 * Structural view of the generic CRUD surface shared by the user story / task / issue /
 * epic resources of `taiga-api-client`. Lets one tool implementation serve all four.
 */
export interface ItemResource {
  listPage(
    params?: Record<string, unknown>,
    page?: number,
  ): Promise<{ data: RawItem[]; pagination: { count: number; perPage: number; current: number; next: string | null } | null }>;
  get(id: number): Promise<RawItem>;
  create(payload: Record<string, unknown>): Promise<RawItem>;
  patch(id: number, payload: Record<string, unknown>, version?: number): Promise<RawItem>;
  delete(id: number): Promise<void>;
}
