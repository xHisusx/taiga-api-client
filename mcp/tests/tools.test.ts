import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { TaigaMcpConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { MemoryTokenStore } from "../src/token-store.js";
import { FakeTaiga, fakeConfig, type FakeTaigaOptions } from "./fake-taiga.js";

interface CallOutcome {
  isError: boolean;
  text: string;
  json: <T = Record<string, unknown>>() => T;
}

async function connect(
  overrides: Record<string, unknown> = {},
  fakeOptions: FakeTaigaOptions = {},
) {
  const fake = new FakeTaiga(fakeOptions);
  const { server } = createServer({
    config: fakeConfig(overrides) as unknown as TaigaMcpConfig,
    deps: { fetch: fake.fetch, tokenStore: new MemoryTokenStore() },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<CallOutcome> => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0]?.text ?? "";
    return {
      isError: result.isError === true,
      text,
      json: <T = Record<string, unknown>>() => JSON.parse(text) as T,
    };
  };

  return { client, fake, call };
}

describe("tool registration", () => {
  it("exposes reads and writes by default, but not deletes", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "taiga_add_comment",
      "taiga_create_item",
      "taiga_create_sprint",
      "taiga_get_item",
      "taiga_link_epic",
      "taiga_list_comments",
      "taiga_list_items",
      "taiga_list_projects",
      "taiga_my_work",
      "taiga_project_schema",
      "taiga_search",
      "taiga_update_item",
      "taiga_whoami",
    ]);
  });

  it("hides every write tool in read-only mode", async () => {
    const { client } = await connect({ readOnly: true });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("taiga_my_work");
    expect(names.filter((name) => /create|update|delete|comment$/.test(name))).toEqual([]);
  });

  it("adds the delete tool only when deletes are enabled", async () => {
    const { client } = await connect({ allowDelete: true });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("taiga_delete_item");
  });

  it("marks read tools as read-only for the client", async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools.find((tool) => tool.name === "taiga_my_work")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "taiga_update_item")?.annotations?.readOnlyHint).toBe(
      false,
    );
  });
});

describe("taiga_whoami", () => {
  it("logs in lazily and reports the account and the server mode", async () => {
    const { call, fake } = await connect();
    expect(fake.requests).toHaveLength(0);

    const result = await call("taiga_whoami");
    const payload = result.json();

    expect(result.isError).toBe(false);
    expect(payload["username"]).toBe("alice");
    expect(payload["mode"]).toEqual({
      read_only: false,
      deletes_enabled: false,
      default_project: null,
    });
    expect(fake.find("POST", "/auth")).toHaveLength(1);
    expect(fake.find("GET", "/users/me")[0]?.authorization).toBe("Bearer token-1");
  });
});

describe("taiga_project_schema", () => {
  it("returns the names a write needs, and drops disabled modules", async () => {
    const { call } = await connect();
    const payload = (await call("taiga_project_schema", { project: "apollo" })).json();

    expect(payload["statuses"]).toMatchObject({
      userstory: [
        { name: "New", id: 101, closed: false },
        { name: "In progress", id: 102, closed: false },
        { name: "Done", id: 103, closed: true },
      ],
    });
    expect(payload["issue_types"]).toEqual(["Bug", "Enhancement"]);
    expect(payload["roles"]).toEqual(["Back", "Front"]);
    expect(payload["permissions"]).toContain("modify_us");
  });

  it("explains itself when no project was given", async () => {
    const { call } = await connect();
    const result = await call("taiga_project_schema");
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/needs a project/);
  });

  it("uses the server's default project", async () => {
    const { call } = await connect({ defaultProject: "apollo" });
    const payload = (await call("taiga_project_schema")).json();
    expect((payload["project"] as Record<string, unknown>)["slug"]).toBe("apollo");
  });
});

describe("taiga_my_work", () => {
  it("groups open items assigned to the authenticated user", async () => {
    const { call, fake } = await connect();
    const payload = (await call("taiga_my_work")).json();

    expect(payload["user"]).toBe("alice");
    expect(payload["scope"]).toBe("all projects");
    expect(payload["total"]).toBe(2);
    expect(payload["user_stories"]).toMatchObject([
      {
        type: "userstory",
        ref: 12,
        subject: "Login with SSO",
        status: "In progress",
        assigned_to: "alice",
        project: "apollo",
        sprint: "Sprint 1",
        url: "https://board.taiga.test/project/apollo/us/12",
      },
    ]);

    const query = fake.find("GET", "/userstories")[0]?.query;
    expect(query).toMatchObject({ assigned_to: "1", status__is_closed: "false" });
  });

  it("can be limited to one kind in one project", async () => {
    const { call, fake } = await connect();
    const payload = (await call("taiga_my_work", { project: "apollo", types: ["task"] })).json();

    expect(payload["tasks"]).toHaveLength(1);
    expect(payload["user_stories"]).toBeUndefined();
    expect(fake.find("GET", "/tasks")[0]?.query).toMatchObject({ project: "7" });
    expect(fake.find("GET", "/userstories")).toHaveLength(0);
  });
});

describe("taiga_list_items", () => {
  it("translates a status name into the project's status id", async () => {
    const { call, fake } = await connect();
    await call("taiga_list_items", { type: "userstory", project: "apollo", status: "In progress" });

    const query = fake.find("GET", "/userstories")[0]?.query;
    expect(query).toMatchObject({ project: "7", status: "102", page_size: "25", page: "1" });
    // An explicit status must not be combined with the "open items only" filter.
    expect(query?.["status__is_closed"]).toBeUndefined();
  });

  it("refuses a name-based filter without a project", async () => {
    const { call } = await connect();
    const result = await call("taiga_list_items", { type: "userstory", status: "In progress" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Filtering by status requires "project"/);
  });

  it("accepts me and unassigned without a project", async () => {
    const { call, fake } = await connect();
    await call("taiga_list_items", { type: "userstory", assigned_to: "me" });
    expect(fake.find("GET", "/userstories")[0]?.query).toMatchObject({ assigned_to: "1" });

    await call("taiga_list_items", { type: "userstory", assigned_to: "unassigned" });
    expect(fake.find("GET", "/userstories")[1]?.query).toMatchObject({ assigned_to: "null" });
  });

  it("reports pagination metadata", async () => {
    const { call } = await connect();
    const payload = (await call("taiga_list_items", { type: "userstory", project: "apollo" })).json();
    expect(payload).toMatchObject({ page: 1, returned: 1, total: 1, has_more: false });
  });
});

describe("taiga_get_item", () => {
  it("resolves a #ref through the resolver endpoint", async () => {
    const { call, fake } = await connect();
    const payload = (await call("taiga_get_item", { type: "task", ref: 34, project: "apollo" })).json();

    expect(payload).toMatchObject({
      type: "task",
      id: 2001,
      ref: 34,
      subject: "Wire up the OIDC callback",
      status: "New",
      // The parent is reported by id (what create/update take), with the #ref alongside.
      user_story: 1001,
      user_story_ref: 12,
      url: "https://board.taiga.test/project/apollo/task/34",
    });
    expect(fake.find("GET", "/resolver")[0]?.query).toMatchObject({ project: "apollo", task: "34" });
  });

  it("asks for a project when only a ref is given", async () => {
    const { call } = await connect();
    const result = await call("taiga_get_item", { type: "task", ref: 34 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/only unique inside a project/);
  });

  it("resolves role points and tags on a user story", async () => {
    const { call } = await connect();
    const payload = (await call("taiga_get_item", { type: "userstory", id: 1001 })).json();
    expect(payload["points"]).toEqual({ Back: "5" });
    expect(payload["tags"]).toEqual(["ui"]);
    expect(payload["total_points"]).toBe(5);
  });

  it("can include the tasks of a user story", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_get_item", { type: "userstory", id: 1001, include_tasks: true })
    ).json();
    expect(payload["tasks"]).toMatchObject([{ type: "task", ref: 34 }]);
    expect(payload["tasks_truncated"]).toBeUndefined();
    // Taiga returns one page, so the page has to be as large as the server allows.
    expect(fake.find("GET", "/tasks")[0]?.query).toMatchObject({
      user_story: "1001",
      page_size: "100",
    });
  });

  it("says so when the tasks did not fit on one page", async () => {
    const { call, fake } = await connect({ maxResults: 1 });
    fake.tasks.set(2002, { ...(fake.tasks.get(2001) ?? {}), id: 2002, ref: 35 });

    const payload = (
      await call("taiga_get_item", { type: "userstory", id: 1001, include_tasks: true })
    ).json();

    expect(payload["tasks"]).toHaveLength(1);
    expect(payload["tasks_truncated"]).toEqual({ shown: 1, total: 2 });
  });

  it("includes the stories of an epic with one filtered request", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_get_item", { type: "epic", id: 3001, include_user_stories: true })
    ).json();

    expect(payload["user_stories"]).toMatchObject([{ type: "userstory", id: 1001 }]);
    expect(fake.find("GET", "/userstories")[0]?.query).toMatchObject({
      epic: "3001",
      project: "7",
    });
    // Not one GET per link: the list endpoint already filters by epic.
    expect(fake.find("GET", "/epics/3001/related_userstories")).toHaveLength(0);
    expect(fake.find("GET", "/userstories/1001")).toHaveLength(0);
  });
});

describe("taiga_update_item", () => {
  it("moves an item to a named status, sending the version for concurrency control", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_update_item", { type: "userstory", id: 1001, status: "Done" })
    ).json();

    const patch = fake.find("PATCH", "/userstories/1001")[0];
    expect(patch?.body).toEqual({ status: 103, version: 4 });
    expect(payload["status"]).toBe("Done");
    expect(payload["is_closed"]).toBe(true);
    expect(payload["changed"]).toMatchObject({ status: "In progress → Done" });
  });

  it("reassigns by username and reports the change", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_update_item", {
        type: "userstory",
        ref: 12,
        project: "apollo",
        assigned_to: "bob",
      })
    ).json();

    expect(fake.find("PATCH", "/userstories/1001")[0]?.body).toMatchObject({ assigned_to: 2 });
    expect(payload["changed"]).toMatchObject({ assigned_to: "alice → bob" });
  });

  it("merges tags instead of replacing them when asked to add", async () => {
    const { call, fake } = await connect();
    await call("taiga_update_item", {
      type: "userstory",
      id: 1001,
      add_tags: ["auth"],
      remove_tags: ["UI"],
    });
    expect(fake.find("PATCH", "/userstories/1001")[0]?.body).toMatchObject({ tags: ["auth"] });
  });

  it("refuses a sprint on a task that already has a parent user story", async () => {
    const { call, fake } = await connect();
    const result = await call("taiga_update_item", { type: "task", id: 2001, sprint: "Sprint 2" });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/follows that story's sprint/);
    expect(fake.find("PATCH", "/tasks/2001")).toHaveLength(0);
  });

  it("moves an item to the backlog and posts a comment in one call", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_update_item", {
        type: "userstory",
        id: 1001,
        sprint: "none",
        comment: "Deferred for now",
      })
    ).json();

    expect(fake.find("PATCH", "/userstories/1001")[0]?.body).toMatchObject({
      milestone: null,
      comment: "Deferred for now",
    });
    expect(payload["changed"]).toMatchObject({ comment: "added" });
  });

  it("rejects an unknown status with the list of valid ones", async () => {
    const { call, fake } = await connect();
    const result = await call("taiga_update_item", { type: "userstory", id: 1001, status: "Shipped" });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Available: New, In progress, Done/);
    expect(fake.find("PATCH", "/userstories/1001")).toHaveLength(0);
  });

  it("rejects a field the item kind does not have", async () => {
    const { call } = await connect();
    const result = await call("taiga_update_item", { type: "userstory", id: 1001, severity: "Normal" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/user stories do not have type \/ severity \/ priority/);
  });

  it("requires at least one field to change", async () => {
    const { call } = await connect();
    const result = await call("taiga_update_item", { type: "userstory", id: 1001 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Nothing to update/);
  });

  it("is absent in read-only mode", async () => {
    const { call } = await connect({ readOnly: true });
    const result = await call("taiga_update_item", { type: "userstory", id: 1001, status: "Done" });
    expect(result.isError).toBe(true);
  });
});

describe("taiga_create_item", () => {
  it("creates a task under a user story, resolving names", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_create_item", {
        type: "task",
        project: "apollo",
        subject: "Add integration test",
        status: "In progress",
        assigned_to: "bob",
        user_story: 1001,
        tags: ["backend"],
      })
    ).json();

    expect(fake.find("POST", "/tasks")[0]?.body).toEqual({
      project: 7,
      subject: "Add integration test",
      status: 202,
      assigned_to: 2,
      user_story: 1001,
      tags: ["backend"],
    });
    expect(payload["id"]).toBe(5000);
  });

  it("creates a standalone task directly in a sprint", async () => {
    const { call, fake } = await connect();
    await call("taiga_create_item", {
      type: "task",
      project: "apollo",
      subject: "Upgrade the runner image",
      sprint: "Sprint 2",
    });

    expect(fake.find("POST", "/tasks")[0]?.body).toEqual({
      project: 7,
      subject: "Upgrade the runner image",
      milestone: 902,
    });
  });

  it("estimates a user story for every role", async () => {
    const { call, fake } = await connect();
    await call("taiga_create_item", {
      type: "userstory",
      project: "apollo",
      subject: "Rate limiting",
      points: { all: 3 },
    });
    expect(fake.find("POST", "/userstories")[0]?.body).toMatchObject({
      points: { "11": 802, "12": 802 },
    });
  });

  it("refuses a sprint on a task that has a parent user story", async () => {
    const { call, fake } = await connect();
    const result = await call("taiga_create_item", {
      type: "task",
      project: "apollo",
      subject: "Add integration test",
      user_story: 1001,
      sprint: "Sprint 2",
    });

    // Taiga would accept the request and silently drop the sprint, so it is refused here.
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/follows that story's sprint/);
    expect(fake.find("POST", "/tasks")).toHaveLength(0);
  });

  it("refuses an epic link on a task before creating anything", async () => {
    const { call, fake } = await connect();
    const result = await call("taiga_create_item", {
      type: "task",
      project: "apollo",
      subject: "Add integration test",
      epic: 3001,
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Only user stories can be linked to an epic/);
    expect(fake.find("POST", "/tasks")).toHaveLength(0);
  });

  it("keeps the created story when the epic link fails", async () => {
    const { call, fake } = await connect(
      {},
      {
        failOnce: {
          "POST /epics/3001/related_userstories": {
            status: 400,
            body: { epic: ["This field is required."] },
          },
        },
      },
    );

    const payload = (
      await call("taiga_create_item", {
        type: "userstory",
        project: "apollo",
        subject: "Rate limiting",
        epic: 3001,
      })
    ).json();

    // The story exists, so the result must not read as a failed create.
    expect(payload["id"]).toBe(5000);
    expect(payload["linked_epic"]).toBeUndefined();
    expect(String(payload["linked_epic_error"])).toMatch(/400/);
    expect(fake.find("POST", "/userstories")).toHaveLength(1);
  });

  it("refuses a sprint on an epic", async () => {
    const { call } = await connect();
    const result = await call("taiga_create_item", {
      type: "epic",
      project: "apollo",
      subject: "Platform work",
      sprint: "Sprint 1",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/epics do not have a sprint/);
  });
});

describe("comments and history", () => {
  it("posts a comment as a patch carrying the version", async () => {
    const { call, fake } = await connect();
    await call("taiga_add_comment", { type: "userstory", id: 1001, comment: "Looks good" });
    expect(fake.find("PATCH", "/userstories/1001")[0]?.body).toEqual({
      comment: "Looks good",
      version: 4,
    });
  });

  it("returns comments only, unless changes are requested", async () => {
    const { call } = await connect();

    const comments = (await call("taiga_list_comments", { type: "userstory", id: 1001 })).json();
    expect(comments["entries"]).toMatchObject([{ author: "bob", comment: "Started on this" }]);

    const withChanges = (
      await call("taiga_list_comments", { type: "userstory", id: 1001, include_changes: true })
    ).json();
    expect(withChanges["entries"]).toHaveLength(2);
    expect((withChanges["entries"] as Array<Record<string, unknown>>)[1]).toMatchObject({
      changes: { status: "New → In progress" },
    });
  });
});

describe("taiga_search", () => {
  it("formats hits per item kind", async () => {
    const { call, fake } = await connect();
    const payload = (await call("taiga_search", { project: "apollo", text: "SSO" })).json();

    expect(fake.find("GET", "/search")[0]?.query).toMatchObject({ project: "7", text: "SSO" });
    expect(payload["total"]).toBe(1);
    expect(payload["user_stories"]).toMatchObject([{ ref: 12, subject: "Login with SSO" }]);
  });
});

describe("sprints and epic links", () => {
  it("creates a sprint", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_create_sprint", {
        project: "apollo",
        name: "Sprint 3",
        start: "2026-10-29",
        finish: "2026-11-11",
      })
    ).json();

    expect(fake.find("POST", "/milestones")[0]?.body).toEqual({
      project: 7,
      name: "Sprint 3",
      estimated_start: "2026-10-29",
      estimated_finish: "2026-11-11",
    });
    expect(payload["sprint"]).toMatchObject({ id: 903, name: "Sprint 3" });
  });

  it("links a user story to an epic by id", async () => {
    const { call, fake } = await connect();
    const payload = (
      await call("taiga_link_epic", { action: "link", epic_id: 3001, user_story_id: 1001 })
    ).json();

    // Taiga wants the epic in the body as well as in the path.
    expect(fake.find("POST", "/epics/3001/related_userstories")[0]?.body).toEqual({
      epic: 3001,
      user_story: 1001,
    });
    expect(payload).toMatchObject({ action: "link", ok: true });
  });
});

describe("delete", () => {
  it("deletes an item when deletes are enabled", async () => {
    const { call, fake } = await connect({ allowDelete: true });
    const payload = (
      await call("taiga_delete_item", { type: "task", id: 2001, confirm: true })
    ).json();

    expect(fake.find("DELETE", "/tasks/2001")).toHaveLength(1);
    expect(payload).toMatchObject({ deleted: true, id: 2001, project: "apollo" });
  });

  it("rejects a call without confirmation", async () => {
    const { call, fake } = await connect({ allowDelete: true });
    const result = await call("taiga_delete_item", { type: "task", id: 2001 });
    expect(result.isError).toBe(true);
    expect(fake.find("DELETE", "/tasks/2001")).toHaveLength(0);
  });
});

describe("error reporting", () => {
  it("turns a 403 into advice about permissions", async () => {
    const fake = new FakeTaiga({
      failOnce: {
        "PATCH /userstories/1001": {
          status: 403,
          body: { _error_message: "You do not have permission to perform this action." },
        },
      },
    });
    const { server } = createServer({
      config: fakeConfig() as unknown as TaigaMcpConfig,
      deps: { fetch: fake.fetch, tokenStore: new MemoryTokenStore() },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "taiga_update_item",
      arguments: { type: "userstory", id: 1001, status: "Done" },
    });
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";

    expect(result.isError).toBe(true);
    expect(text).toMatch(/403/);
    expect(text).toMatch(/taiga_project_schema/);
  });

  it("reports an unknown item id as a Taiga 404", async () => {
    const { call } = await connect();
    const result = await call("taiga_get_item", { type: "userstory", id: 99999 });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/404/);
  });
});
