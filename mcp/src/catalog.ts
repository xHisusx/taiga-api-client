import type { Project } from "taiga-api-client";
import type { TaigaSession } from "./session.js";
import type {
  CatalogNamed,
  CatalogPoint,
  CatalogRole,
  CatalogSprint,
  CatalogStatus,
  ItemType,
  ProjectCatalog,
} from "./types.js";
import { ITEM_KINDS } from "./types.js";

/** How a tool call may refer to a project: numeric id, slug, or name. */
export type ProjectRef = string | number;

/**
 * Raised when a human-readable reference cannot be mapped onto a Taiga ID.
 *
 * The message always lists the valid alternatives, so the caller (usually a model)
 * can correct itself without another round of discovery.
 */
export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}

/** Compact project projection returned by `taiga_list_projects`. */
export interface ProjectSummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  isPrivate: boolean;
  iAmAdmin: boolean;
  iAmMember: boolean;
  modules: ProjectCatalog["modules"];
}

interface RawNamed {
  id?: number;
  name?: string;
  [key: string]: unknown;
}

/**
 * The project payload as the detail endpoint actually returns it.
 *
 * `GET /projects/:id` is a richer serializer than the list one: it embeds every catalog,
 * and `members` holds member objects rather than the bare ids the list endpoint returns —
 * hence `Omit<Project, "members">`.
 */
interface RawProjectDetail extends Omit<Project, "members"> {
  members?: RawNamed[];
  us_statuses?: RawNamed[];
  task_statuses?: RawNamed[];
  issue_statuses?: RawNamed[];
  epic_statuses?: RawNamed[];
  issue_types?: RawNamed[];
  severities?: RawNamed[];
  priorities?: RawNamed[];
  points?: RawNamed[];
  roles?: RawNamed[];
  swimlanes?: RawNamed[];
  milestones?: RawNamed[];
  my_permissions?: string[];
  i_am_admin?: boolean;
  i_am_owner?: boolean;
  i_am_member?: boolean;
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function mapStatuses(raw: RawNamed[] | undefined): CatalogStatus[] {
  return (raw ?? []).flatMap((item) => {
    const id = asNumber(item["id"]);
    if (id === undefined) return [];
    const order = asNumber(item["order"]);
    return [
      {
        id,
        name: asString(item["name"]) ?? String(id),
        is_closed: item["is_closed"] === true,
        ...(order !== undefined ? { order } : {}),
      },
    ];
  });
}

function mapNamed(raw: RawNamed[] | undefined): CatalogNamed[] {
  return (raw ?? []).flatMap((item) => {
    const id = asNumber(item["id"]);
    if (id === undefined) return [];
    return [{ id, name: asString(item["name"]) ?? String(id) }];
  });
}

function mapRoles(raw: RawNamed[] | undefined): CatalogRole[] {
  return (raw ?? []).flatMap((item) => {
    const id = asNumber(item["id"]);
    if (id === undefined) return [];
    return [
      {
        id,
        name: asString(item["name"]) ?? String(id),
        // Taiga marks the roles that take part in estimation as computable.
        computable: item["computable"] !== false,
      },
    ];
  });
}

function mapPoints(raw: RawNamed[] | undefined): CatalogPoint[] {
  return (raw ?? []).flatMap((item) => {
    const id = asNumber(item["id"]);
    if (id === undefined) return [];
    const value = item["value"];
    return [
      {
        id,
        name: asString(item["name"]) ?? String(id),
        value: typeof value === "number" ? value : null,
      },
    ];
  });
}

function mapMembers(raw: RawNamed[] | undefined): ProjectCatalog["members"] {
  return (raw ?? []).flatMap((item) => {
    const id = asNumber(item["id"]) ?? asNumber(item["user"]);
    if (id === undefined) return [];
    return [
      {
        id,
        username: asString(item["username"]) ?? asString(item["full_name"]) ?? String(id),
        full_name: asString(item["full_name_display"]) ?? asString(item["full_name"]) ?? "",
        role: asString(item["role_name"]) ?? null,
        is_active: item["is_active"] !== false,
      },
    ];
  });
}

function mapSprints(raw: RawNamed[] | undefined): CatalogSprint[] {
  return (raw ?? []).flatMap((item) => {
    const id = asNumber(item["id"]);
    if (id === undefined) return [];
    const slug = asString(item["slug"]);
    const start = asString(item["estimated_start"]);
    const finish = asString(item["estimated_finish"]);
    return [
      {
        id,
        name: asString(item["name"]) ?? String(id),
        closed: item["closed"] === true,
        ...(slug ? { slug } : {}),
        ...(start ? { estimated_start: start } : {}),
        ...(finish ? { estimated_finish: finish } : {}),
      },
    ];
  });
}

function modulesOf(project: {
  is_backlog_activated?: boolean;
  is_kanban_activated?: boolean;
  is_issues_activated?: boolean;
  is_epics_activated?: boolean;
  is_wiki_activated?: boolean;
}): ProjectCatalog["modules"] {
  return {
    backlog: project.is_backlog_activated === true,
    kanban: project.is_kanban_activated === true,
    issues: project.is_issues_activated === true,
    epics: project.is_epics_activated === true,
    wiki: project.is_wiki_activated === true,
  };
}

/**
 * Reads and caches the per-project catalogs (statuses, members, sprints, points, ...)
 * and turns human-readable references into the numeric IDs the Taiga API requires.
 *
 * A single `GET /projects/:id` call yields every catalog of a project, so a tool call
 * that mentions names costs one extra request at most — and none while the cache is warm.
 */
export class CatalogService {
  private projects: CacheEntry<ProjectSummary[]> | null = null;
  private readonly catalogs = new Map<number, CacheEntry<ProjectCatalog>>();

  constructor(private readonly session: TaigaSession) {}

  private get ttl(): number {
    return this.session.settings.catalogTtlMs;
  }

  private fresh<T>(entry: CacheEntry<T> | null | undefined): T | null {
    if (!entry) return null;
    return Date.now() - entry.at < this.ttl ? entry.value : null;
  }

  /** Drop every cached catalog. Used by `taiga_project_schema` with `refresh: true`. */
  invalidate(): void {
    this.projects = null;
    this.catalogs.clear();
  }

  /** Every project the authenticated user is a member of. */
  async listProjects(options: { refresh?: boolean } = {}): Promise<ProjectSummary[]> {
    if (!options.refresh) {
      const cached = this.fresh(this.projects);
      if (cached) return cached;
    }

    const meId = await this.session.currentUserId();
    const collected: ProjectSummary[] = [];
    await this.session.run(async (client) => {
      for await (const project of client.projects.paginate({ member: meId })) {
        collected.push(this.toSummary(project as unknown as RawProjectDetail));
        if (collected.length >= 200) break;
      }
    });

    this.projects = { at: Date.now(), value: collected };
    return collected;
  }

  /** Full catalog of one project, fetched with a single request and cached. */
  async catalog(ref: ProjectRef, options: { refresh?: boolean } = {}): Promise<ProjectCatalog> {
    const id = await this.resolveProjectId(ref);
    if (!options.refresh) {
      const cached = this.fresh(this.catalogs.get(id));
      if (cached) return cached;
    }

    const detail = await this.session.run(
      async (client) => (await client.http.get<RawProjectDetail>(`/projects/${id}`)).data,
    );
    const catalog = await this.toCatalog(detail);
    this.catalogs.set(id, { at: Date.now(), value: catalog });
    return catalog;
  }

  /** Numeric project ID for an id / slug / name reference. */
  async resolveProjectId(ref: ProjectRef): Promise<number> {
    if (typeof ref === "number") return ref;
    const raw = ref.trim().replace(/^#/, "");
    if (/^\d+$/.test(raw)) return Number(raw);

    const needle = normalizeName(raw);
    const projects = await this.listProjects();

    const bySlug = projects.find((p) => normalizeName(p.slug) === needle);
    if (bySlug) return bySlug.id;

    const byName = projects.filter((p) => normalizeName(p.name) === needle);
    const exact = byName[0];
    if (exact && byName.length === 1) return exact.id;
    if (byName.length > 1) {
      throw new ResolutionError(
        `Several projects are named "${raw}": ${byName
          .map((p) => `${p.name} (${p.slug}, id ${p.id})`)
          .join("; ")}. Pass the slug or the id instead.`,
      );
    }

    const partial = projects.filter(
      (p) => normalizeName(p.name).includes(needle) || normalizeName(p.slug).includes(needle),
    );
    const onlyPartial = partial[0];
    if (onlyPartial && partial.length === 1) return onlyPartial.id;

    // Not one of my projects — it may still be a visible public one.
    try {
      const project = await this.session.run((client) => client.projects.getBySlug(raw));
      return project.id;
    } catch {
      // Fall through to the error below.
    }

    const known = projects.length
      ? projects.map((p) => `${p.slug} (${p.name})`).join(", ")
      : "none — this account is not a member of any project";
    throw new ResolutionError(`Unknown project "${raw}". Your projects: ${known}.`);
  }

  /** Status ID for a status name (case-insensitive) or numeric id, validated per item kind. */
  resolveStatus(catalog: ProjectCatalog, type: ItemType, value: string | number): number {
    const statuses = catalog.statuses[type];
    const direct = this.matchNamed(statuses, value);
    if (direct !== undefined) return direct;
    throw new ResolutionError(
      `Unknown status "${value}" for ${ITEM_KINDS[type].labelPlural} in project ` +
        `"${catalog.slug}". Available: ${statuses.map((s) => s.name).join(", ") || "none"}.`,
    );
  }

  /**
   * Member ID for `"me"`, a username, a full name or a numeric id.
   * Returns `null` for `"unassigned"` / `"none"` / `"null"`.
   */
  async resolveMember(catalog: ProjectCatalog, value: string | number): Promise<number | null> {
    if (typeof value === "number") return value;
    const raw = value.trim();
    const needle = normalizeName(raw);

    if (needle === "me" || needle === "self") return this.session.currentUserId();
    if (needle === "unassigned" || needle === "none" || needle === "null" || needle === "") {
      return null;
    }
    if (/^\d+$/.test(raw)) return Number(raw);

    const byUsername = catalog.members.filter((m) => normalizeName(m.username) === needle);
    const username = byUsername[0];
    if (username && byUsername.length === 1) return username.id;

    const byFullName = catalog.members.filter((m) => normalizeName(m.full_name) === needle);
    const fullName = byFullName[0];
    if (fullName && byFullName.length === 1) return fullName.id;

    const partial = catalog.members.filter(
      (m) =>
        normalizeName(m.username).includes(needle) || normalizeName(m.full_name).includes(needle),
    );
    const onlyPartial = partial[0];
    if (onlyPartial && partial.length === 1) return onlyPartial.id;
    if (partial.length > 1) {
      throw new ResolutionError(
        `"${raw}" matches several members of "${catalog.slug}": ${partial
          .map((m) => m.username)
          .join(", ")}. Use an exact username.`,
      );
    }

    throw new ResolutionError(
      `"${raw}" is not a member of project "${catalog.slug}". Members: ${
        catalog.members
          .map((m) => `${m.username}${m.full_name ? ` (${m.full_name})` : ""}`)
          .join(", ") || "none"
      }.`,
    );
  }

  /** Sprint ID for a sprint name or id. Returns `null` for `"none"` / `"backlog"`. */
  resolveSprint(catalog: ProjectCatalog, value: string | number): number | null {
    if (typeof value === "number") return value;
    const raw = value.trim();
    const needle = normalizeName(raw);
    if (needle === "none" || needle === "null" || needle === "backlog" || needle === "") return null;
    if (/^\d+$/.test(raw)) return Number(raw);

    const direct = this.matchNamed(catalog.sprints, raw);
    if (direct !== undefined) return direct;

    const bySlug = catalog.sprints.find((s) => s.slug && normalizeName(s.slug) === needle);
    if (bySlug) return bySlug.id;

    throw new ResolutionError(
      `Unknown sprint "${raw}" in project "${catalog.slug}". Available: ${
        catalog.sprints.map((s) => s.name).join(", ") || "none"
      }. Pass "none" to move the item to the backlog.`,
    );
  }

  /** Generic `{ id, name }` catalog lookup (issue type, severity, priority). */
  resolveNamed(
    list: CatalogNamed[],
    value: string | number,
    label: string,
    projectSlug: string,
  ): number {
    const direct = this.matchNamed(list, value);
    if (direct !== undefined) return direct;
    throw new ResolutionError(
      `Unknown ${label} "${value}" in project "${projectSlug}". Available: ${
        list.map((entry) => entry.name).join(", ") || "none"
      }.`,
    );
  }

  /**
   * Build the `points` payload Taiga expects — a `{ roleId: pointId }` map.
   *
   * Keys of `input` are role names (or `"all"` / `"*"` for every estimating role);
   * values are point names (`"5"`, `"?"`) or their numeric value.
   */
  resolvePoints(
    catalog: ProjectCatalog,
    input: Record<string, string | number>,
  ): Record<string, number> {
    if (catalog.points.length === 0) {
      throw new ResolutionError(`Project "${catalog.slug}" has no story-point scale configured.`);
    }
    const result: Record<string, number> = {};

    for (const [roleKey, pointValue] of Object.entries(input)) {
      const pointId = this.matchPoint(catalog, pointValue);
      const needle = normalizeName(roleKey);
      const roles =
        needle === "all" || needle === "*"
          ? catalog.roles.filter((role) => role.computable)
          : catalog.roles.filter(
              (role) => normalizeName(role.name) === needle || String(role.id) === roleKey.trim(),
            );

      if (roles.length === 0) {
        throw new ResolutionError(
          `Unknown role "${roleKey}" in project "${catalog.slug}". Roles: ${
            catalog.roles.map((role) => role.name).join(", ") || "none"
          }. Use "all" to estimate for every role.`,
        );
      }
      for (const role of roles) result[String(role.id)] = pointId;
    }

    return result;
  }

  private matchPoint(catalog: ProjectCatalog, value: string | number): number {
    const raw = typeof value === "number" ? String(value) : value.trim();
    const byName = catalog.points.find((point) => normalizeName(point.name) === normalizeName(raw));
    if (byName) return byName.id;

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const byValue = catalog.points.find((point) => point.value === numeric);
      if (byValue) return byValue.id;
    }

    throw new ResolutionError(
      `Unknown point value "${value}" in project "${catalog.slug}". Available: ${catalog.points
        .map((point) => point.name)
        .join(", ")}.`,
    );
  }

  private matchNamed(
    list: Array<{ id: number; name: string }>,
    value: string | number,
  ): number | undefined {
    if (typeof value === "number") {
      return list.some((entry) => entry.id === value) ? value : undefined;
    }
    const raw = value.trim();
    if (/^\d+$/.test(raw)) {
      const id = Number(raw);
      if (list.some((entry) => entry.id === id)) return id;
    }
    const needle = normalizeName(raw);
    const exact = list.find((entry) => normalizeName(entry.name) === needle);
    if (exact) return exact.id;

    const partial = list.filter((entry) => normalizeName(entry.name).includes(needle));
    const only = partial[0];
    return partial.length === 1 && only ? only.id : undefined;
  }

  private toSummary(project: RawProjectDetail): ProjectSummary {
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description ?? "",
      isPrivate: project.is_private === true,
      iAmAdmin: project.i_am_admin === true,
      iAmMember: project.i_am_member !== false,
      modules: modulesOf(project),
    };
  }

  private async toCatalog(detail: RawProjectDetail): Promise<ProjectCatalog> {
    const sprints = Array.isArray(detail.milestones)
      ? mapSprints(detail.milestones)
      : await this.fetchSprints(detail.id);

    return {
      id: detail.id,
      slug: detail.slug,
      name: detail.name,
      description: detail.description ?? "",
      isPrivate: detail.is_private === true,
      iAmAdmin: detail.i_am_admin === true,
      iAmOwner: detail.i_am_owner === true,
      permissions: Array.isArray(detail.my_permissions) ? detail.my_permissions : [],
      modules: modulesOf(detail),
      statuses: {
        userstory: mapStatuses(detail.us_statuses),
        task: mapStatuses(detail.task_statuses),
        issue: mapStatuses(detail.issue_statuses),
        epic: mapStatuses(detail.epic_statuses),
      },
      issueTypes: mapNamed(detail.issue_types),
      severities: mapNamed(detail.severities),
      priorities: mapNamed(detail.priorities),
      points: mapPoints(detail.points),
      roles: mapRoles(detail.roles),
      swimlanes: mapNamed(detail.swimlanes),
      members: mapMembers(detail.members),
      sprints,
      tags: Array.isArray(detail.tags) ? detail.tags.filter((tag) => typeof tag === "string") : [],
    };
  }

  private async fetchSprints(projectId: number): Promise<CatalogSprint[]> {
    try {
      const milestones = await this.session.run((client) =>
        client.milestones.list({ project: projectId }),
      );
      return mapSprints(milestones as unknown as RawNamed[]);
    } catch {
      // Sprints are optional context — never fail a whole catalog over them.
      return [];
    }
  }
}
