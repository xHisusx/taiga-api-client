import type { FetchLike } from "taiga-api-client";

/** One request the fake received, for assertions. */
export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

export interface FakeTaigaOptions {
  /** Force a status code for the first request matching `METHOD /path`. */
  failOnce?: Record<string, { status: number; body: unknown }>;
  /**
   * Cap list responses that ask for no page size, as a Taiga that ignores
   * `x-disable-pagination` does: fewer items than the count in the headers.
   */
  listCap?: number;
}

const ME = {
  id: 1,
  username: "alice",
  full_name: "Alice Example",
  full_name_display: "Alice Example",
  email: "alice@example.com",
  bio: "",
  lang: "en",
  theme: "taiga",
  timezone: "UTC",
  is_active: true,
  photo: null,
  big_photo: null,
  gravatar_id: null,
  roles: ["Back"],
  date_joined: "2026-01-01T00:00:00Z",
};

const PROJECT_LIST_ENTRY = {
  id: 7,
  name: "Apollo",
  slug: "apollo",
  description: "Flight software",
  is_private: true,
  is_backlog_activated: true,
  is_kanban_activated: false,
  is_issues_activated: true,
  is_epics_activated: true,
  is_wiki_activated: false,
  members: [1, 2],
  i_am_admin: true,
  i_am_owner: true,
  i_am_member: true,
};

const PROJECT_LIST_ENTRY_2 = {
  ...PROJECT_LIST_ENTRY,
  id: 8,
  name: "Orion",
  slug: "orion",
  description: "Billing",
};

const PROJECT_DETAIL = {
  ...PROJECT_LIST_ENTRY,
  my_permissions: ["view_project", "add_us", "modify_us", "add_task", "comment_us"],
  members: [
    { id: 1, username: "alice", full_name: "Alice Example", full_name_display: "Alice Example", role_name: "Back", is_active: true },
    { id: 2, username: "bob", full_name: "Bob Builder", full_name_display: "Bob Builder", role_name: "Front", is_active: true },
  ],
  roles: [
    { id: 11, name: "Back", computable: true },
    { id: 12, name: "Front", computable: true },
    { id: 13, name: "Stakeholder", computable: false },
  ],
  us_statuses: [
    { id: 101, name: "New", is_closed: false, order: 1 },
    { id: 102, name: "In progress", is_closed: false, order: 2 },
    { id: 103, name: "Done", is_closed: true, order: 3 },
  ],
  task_statuses: [
    { id: 201, name: "New", is_closed: false },
    { id: 202, name: "In progress", is_closed: false },
    { id: 203, name: "Closed", is_closed: true },
  ],
  issue_statuses: [
    { id: 301, name: "New", is_closed: false },
    { id: 302, name: "Fixed", is_closed: true },
  ],
  epic_statuses: [
    { id: 401, name: "New", is_closed: false },
    { id: 402, name: "Done", is_closed: true },
  ],
  issue_types: [
    { id: 501, name: "Bug" },
    { id: 502, name: "Enhancement" },
  ],
  severities: [{ id: 601, name: "Normal" }],
  priorities: [{ id: 701, name: "High" }],
  points: [
    { id: 801, name: "?", value: null },
    { id: 802, name: "3", value: 3 },
    { id: 803, name: "5", value: 5 },
  ],
  swimlanes: [],
  milestones: [
    { id: 901, name: "Sprint 1", slug: "sprint-1", closed: false, estimated_start: "2026-10-01", estimated_finish: "2026-10-14" },
    { id: 902, name: "Sprint 2", slug: "sprint-2", closed: false, estimated_start: "2026-10-15", estimated_finish: "2026-10-28" },
  ],
  tags: ["ui", "backend"],
};

/** The second project shares the first one's catalogs — only its identity differs. */
const PROJECT_DETAIL_2 = {
  ...PROJECT_DETAIL,
  ...PROJECT_LIST_ENTRY_2,
  members: PROJECT_DETAIL.members,
  milestones: PROJECT_DETAIL.milestones,
};

function userStory(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    ref: 12,
    project: 7,
    subject: "Login with SSO",
    description: "As a user I want SSO",
    status: 102,
    status_extra_info: { name: "In progress", is_closed: false },
    is_closed: false,
    assigned_to: 1,
    assigned_to_extra_info: { id: 1, username: "alice", full_name_display: "Alice Example" },
    owner: 1,
    owner_extra_info: { id: 1, username: "alice" },
    project_extra_info: { id: 7, name: "Apollo", slug: "apollo" },
    milestone: 901,
    milestone_name: "Sprint 1",
    tags: [["ui", null]],
    due_date: "2026-11-01",
    version: 4,
    total_points: 5,
    points: { "11": 803 },
    watchers: [2],
    is_blocked: false,
    epics: [{ id: 3001, ref: 97, subject: "Authentication" }],
    created_date: "2026-10-01T10:00:00Z",
    modified_date: "2026-10-10T10:00:00Z",
    ...overrides,
  };
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 2001,
    ref: 34,
    project: 7,
    subject: "Wire up the OIDC callback",
    description: "",
    status: 201,
    status_extra_info: { name: "New", is_closed: false },
    is_closed: false,
    assigned_to: 1,
    assigned_to_extra_info: { id: 1, username: "alice" },
    project_extra_info: { id: 7, name: "Apollo", slug: "apollo" },
    user_story: 1001,
    user_story_extra_info: { id: 1001, ref: 12, subject: "Login with SSO" },
    milestone: 901,
    milestone_name: "Sprint 1",
    tags: [],
    version: 2,
    owner: 1,
    watchers: [],
    is_blocked: false,
    ...overrides,
  };
}

function epic(overrides: Record<string, unknown> = {}) {
  return {
    id: 3001,
    ref: 97,
    project: 7,
    subject: "Authentication",
    status: 401,
    status_extra_info: { name: "New", is_closed: false },
    is_closed: false,
    project_extra_info: { id: 7, name: "Apollo", slug: "apollo" },
    color: "#a8e6cf",
    tags: [],
    version: 1,
    owner: 1,
    watchers: [],
    ...overrides,
  };
}

/** `?project=` is honoured by every list endpoint, so one project cannot leak into another. */
function matchesProject(item: Record<string, unknown>, project: string | undefined): boolean {
  if (project === undefined) return true;
  return String(item["project"]) === project;
}

/** `?epic=` filters user stories by the epics embedded in them, as Taiga does. */
function matchesEpic(story: Record<string, unknown>, epic: string | undefined): boolean {
  if (epic === undefined) return true;
  const epics = Array.isArray(story["epics"]) ? (story["epics"] as Array<{ id?: number }>) : [];
  return epics.some((entry) => String(entry.id) === epic);
}

function paginated(
  items: unknown[],
  perPage = 30,
  count = items.length,
): { body: unknown; headers: Record<string, string> } {
  return {
    body: items,
    headers: {
      "content-type": "application/json",
      "x-paginated": "true",
      "x-paginated-by": String(perPage),
      "x-pagination-count": String(count),
      "x-pagination-current": "1",
    },
  };
}

/**
 * An in-memory stand-in for a Taiga instance, injected as the client's `fetch`.
 *
 * It implements just enough of the REST surface for the MCP tools, records every
 * request so tests can assert on payloads, and keeps mutations so a PATCH is visible
 * to the following GET.
 */
export class FakeTaiga {
  readonly requests: RecordedRequest[] = [];
  readonly stories = new Map<number, Record<string, unknown>>();
  readonly tasks = new Map<number, Record<string, unknown>>();
  /** Issues and epics start empty: only the activity tests populate them. */
  readonly issues = new Map<number, Record<string, unknown>>();
  readonly epics = new Map<number, Record<string, unknown>>();
  /** Project timeline, newest event first — the order Taiga serves it in. */
  readonly timelines = new Map<number, unknown[]>();
  private readonly failures: Record<string, { status: number; body: unknown }>;
  private readonly listCap: number | undefined;
  private nextId = 5000;

  constructor(options: FakeTaigaOptions = {}) {
    this.failures = { ...(options.failOnce ?? {}) };
    this.listCap = options.listCap;
    this.stories.set(1001, userStory());
    this.tasks.set(2001, task());
  }

  /** The `fetch` implementation to hand to `TaigaClient`. */
  get fetch(): FetchLike {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const query = Object.fromEntries(url.searchParams.entries());
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      const headers = new Headers((init?.headers ?? {}) as Record<string, string>);

      this.requests.push({
        method,
        path,
        query,
        body,
        authorization: headers.get("authorization"),
      });

      const failureKey = `${method} ${path}`;
      const failure = this.failures[failureKey];
      if (failure) {
        delete this.failures[failureKey];
        return this.json(failure.body, failure.status);
      }

      return this.route(method, path, query, body);
    }) as FetchLike;
  }

  /** Every request made so far for `METHOD /path`. */
  find(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.method === method && request.path === path);
  }

  /** One page of a collection, with the full count in the headers — as Taiga answers. */
  private page(items: unknown[], query: Record<string, string>): Response {
    const perPage = Number(query["page_size"] ?? this.listCap ?? 30);
    const body = paginated(items.slice(0, perPage), perPage, items.length);
    return this.json(body.body, 200, body.headers);
  }

  private json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
    if (status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...extraHeaders },
    });
  }

  private route(
    method: string,
    path: string,
    query: Record<string, string>,
    body: Record<string, unknown> | null,
  ): Response {
    if (method === "POST" && path === "/auth") {
      return this.json({ ...ME, auth_token: "token-1", refresh: "refresh-1" });
    }
    if (method === "POST" && path === "/auth/refresh") {
      return this.json({ auth_token: "token-2", refresh: "refresh-2" });
    }
    if (method === "GET" && path === "/users/me") {
      return this.json(ME);
    }
    if (method === "GET" && path === "/projects") {
      const page = paginated([PROJECT_LIST_ENTRY, PROJECT_LIST_ENTRY_2]);
      return this.json(page.body, 200, page.headers);
    }
    if (method === "GET" && path === "/projects/7") {
      return this.json(PROJECT_DETAIL);
    }
    if (method === "GET" && path === "/projects/8") {
      return this.json(PROJECT_DETAIL_2);
    }
    if (method === "GET" && path === "/projects/by_slug") {
      return query["slug"] === "apollo" ? this.json(PROJECT_DETAIL) : this.json({}, 404);
    }
    if (method === "GET" && path === "/resolver") {
      if (query["task"] === "34") return this.json({ project: 7, task: 2001 });
      if (query["us"] === "12") return this.json({ project: 7, us: 1001 });
      return this.json({ _error_message: "not found" }, 404);
    }

    if (method === "GET" && path === "/userstories") {
      const items = [...this.stories.values()]
        .filter((story) => matchesProject(story, query["project"]))
        .filter((story) =>
          query["status"] === undefined ? true : String(story["status"]) === query["status"],
        )
        .filter((story) => matchesEpic(story, query["epic"]));
      return this.page(items, query);
    }
    if (method === "GET" && path === "/tasks") {
      const items = [...this.tasks.values()]
        .filter((task) => matchesProject(task, query["project"]))
        .filter((task) =>
          query["user_story"] === undefined
            ? true
            : String(task["user_story"]) === query["user_story"],
        );
      return this.page(items, query);
    }
    if (method === "GET" && path === "/epics/3001") {
      return this.json(epic());
    }
    if (method === "GET" && path === "/issues") {
      return this.page(
        [...this.issues.values()].filter((issue) => matchesProject(issue, query["project"])),
        query,
      );
    }
    if (method === "GET" && path === "/epics") {
      return this.page(
        [...this.epics.values()].filter((item) => matchesProject(item, query["project"])),
        query,
      );
    }

    const timelineMatch = /^\/timeline\/project\/(\d+)$/.exec(path);
    if (method === "GET" && timelineMatch) {
      const events = this.timelines.get(Number(timelineMatch[1])) ?? [];
      const size = Number(query["page_size"] ?? 100);
      const current = Number(query["page"] ?? 1);
      const slice = events.slice((current - 1) * size, current * size);
      return this.json(slice, 200, {
        "x-pagination-count": String(events.length),
        "x-pagination-current": String(current),
      });
    }

    const storyMatch = /^\/userstories\/(\d+)$/.exec(path);
    if (storyMatch) return this.entity(this.stories, Number(storyMatch[1]), method, body);

    const taskMatch = /^\/tasks\/(\d+)$/.exec(path);
    if (taskMatch) return this.entity(this.tasks, Number(taskMatch[1]), method, body);

    const issueMatch = /^\/issues\/(\d+)$/.exec(path);
    if (issueMatch) return this.entity(this.issues, Number(issueMatch[1]), method, body);

    const epicMatch = /^\/epics\/(\d+)$/.exec(path);
    if (epicMatch) return this.entity(this.epics, Number(epicMatch[1]), method, body);

    if (method === "POST" && path === "/tasks") {
      const created = task({ ...body, id: this.nextId++, ref: 99, version: 1 });
      this.tasks.set(created.id as number, created);
      return this.json(created, 201);
    }
    if (method === "POST" && path === "/userstories") {
      const created = userStory({ ...body, id: this.nextId++, ref: 98, version: 1 });
      this.stories.set(created.id as number, created);
      return this.json(created, 201);
    }
    if (method === "POST" && path === "/epics") {
      return this.json({ id: this.nextId++, ref: 97, project: 7, subject: body?.["subject"], status: 401, version: 1 }, 201);
    }
    if (method === "POST" && path === "/milestones") {
      return this.json(
        {
          id: 903,
          name: body?.["name"],
          slug: "sprint-3",
          project: 7,
          estimated_start: body?.["estimated_start"],
          estimated_finish: body?.["estimated_finish"],
          closed: false,
        },
        201,
      );
    }
    if (method === "GET" && path === "/milestones") {
      const page = paginated(PROJECT_DETAIL.milestones);
      return this.json(page.body, 200, page.headers);
    }
    if (method === "POST" && /^\/epics\/\d+\/related_userstories$/.test(path)) {
      return this.json({ epic: 3001, user_story: body?.["user_story"], order: 1 }, 201);
    }
    if (method === "DELETE" && /^\/epics\/\d+\/related_userstories\/\d+$/.test(path)) {
      return this.json(null, 204);
    }

    if (method === "GET" && path === "/history/userstory/1001") {
      // Taiga serves history newest-first — the order the server reverses for output.
      return this.json([
        {
          id: "h2",
          created_at: "2026-10-03T09:00:00Z",
          user: { pk: 1, username: "alice" },
          comment: "",
          delete_comment_date: null,
          diff: { status: [101, 102] },
          values: { status: { "101": "New", "102": "In progress" } },
        },
        {
          id: "h1",
          created_at: "2026-10-02T09:00:00Z",
          user: { pk: 2, username: "bob", name: "Bob Builder" },
          comment: "Started on this",
          delete_comment_date: null,
          diff: {},
        },
      ]);
    }

    if (method === "GET" && path === "/search") {
      return this.json({
        count: 1,
        userstories: [userStory()],
        tasks: [],
        issues: [],
        epics: [],
        wikipages: [],
      });
    }

    return this.json({ _error_message: `fake taiga: unhandled ${method} ${path}` }, 404);
  }

  private entity(
    store: Map<number, Record<string, unknown>>,
    id: number,
    method: string,
    body: Record<string, unknown> | null,
  ): Response {
    const current = store.get(id);
    if (!current) return this.json({ _error_message: "Not found" }, 404);

    if (method === "GET") return this.json(current);
    if (method === "DELETE") {
      store.delete(id);
      return this.json(null, 204);
    }
    if (method === "PATCH" || method === "PUT") {
      const next: Record<string, unknown> = {
        ...current,
        ...body,
        version: (current["version"] as number) + 1,
      };
      delete next["comment"];
      // Keep the embedded projections consistent with the new ids.
      const statuses = [
        ...PROJECT_DETAIL.us_statuses,
        ...PROJECT_DETAIL.task_statuses,
        ...PROJECT_DETAIL.issue_statuses,
      ];
      const status = statuses.find((candidate) => candidate.id === next["status"]);
      if (status) {
        next["status_extra_info"] = { name: status.name, is_closed: status.is_closed };
        next["is_closed"] = status.is_closed;
      }
      if ("assigned_to" in (body ?? {})) {
        const member = PROJECT_DETAIL.members.find((candidate) => candidate.id === next["assigned_to"]);
        next["assigned_to_extra_info"] = member
          ? { id: member.id, username: member.username }
          : null;
      }
      if ("milestone" in (body ?? {})) {
        const sprint = PROJECT_DETAIL.milestones.find((candidate) => candidate.id === next["milestone"]);
        next["milestone_name"] = sprint?.name ?? null;
      }
      store.set(id, next);
      return this.json(next);
    }
    return this.json({ _error_message: "method not allowed" }, 405);
  }
}

/** Minimal config pointing at the fake, for tests. */
export function fakeConfig(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: "https://taiga.test",
    webUrl: "https://board.taiga.test",
    username: "alice",
    password: "secret",
    readOnly: false,
    allowDelete: false,
    tokenFile: null,
    tz: "+03:00",
    timeoutMs: 5000,
    catalogTtlMs: 60_000,
    maxResults: 100,
    ...overrides,
  } as const;
}
