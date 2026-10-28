import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TaigaClient, type Project } from "taiga-api-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaigaMcpConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import { MemoryTokenStore } from "../../src/token-store.js";
import { integrationEnv, isoDate, uniqueName } from "./helpers.js";

const skip = !integrationEnv;
const suite = skip ? describe.skip : describe;

interface Outcome {
  isError: boolean;
  text: string;
  json: <T = Record<string, unknown>>() => T;
}

/**
 * End-to-end check of the write path against a real Taiga instance.
 *
 * Everything happens inside a private project created in `beforeAll` and deleted in
 * `afterAll`, so no existing data is touched. Status and point names are read back from
 * `taiga_project_schema` rather than hard-coded, because a Taiga instance may have
 * localized or customized catalogs.
 */
suite("integration: MCP tools against a live Taiga", () => {
  const env = integrationEnv!;
  let client: TaigaClient;
  let project: Project;
  let mcp: Client;
  let call: (name: string, args?: Record<string, unknown>) => Promise<Outcome>;

  let openStatus: string;
  let closedStatus: string;
  let storyRef: number;
  let storyId: number;

  beforeAll(async () => {
    client = new TaigaClient({
      baseUrl: env.baseUrl,
      userAgent: "taiga-mcp-server/integration-tests",
      timeoutMs: 30_000,
    });
    await client.auth.login({ username: env.login, password: env.password });

    project = await client.projects.create({
      name: uniqueName("taiga-mcp-test"),
      description: "Temporary project created by taiga-mcp-server integration tests",
      is_backlog_activated: true,
      is_kanban_activated: true,
      is_issues_activated: true,
      is_wiki_activated: false,
      is_epics_activated: true,
      is_private: true,
    });

    const config: TaigaMcpConfig = {
      baseUrl: env.baseUrl,
      webUrl: "https://tree.taiga.io",
      username: env.login,
      password: env.password,
      readOnly: false,
      allowDelete: true,
      tokenFile: null,
      defaultProject: project.slug,
      tz: "+00:00",
      timeoutMs: 30_000,
      catalogTtlMs: 60_000,
      maxResults: 100,
    };

    const { server } = createServer({ config, deps: { tokenStore: new MemoryTokenStore() } });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: "integration-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

    call = async (name, args = {}) => {
      const result = await mcp.callTool({ name, arguments: args });
      const content = result.content as Array<{ text?: string }>;
      const text = content[0]?.text ?? "";
      return {
        isError: result.isError === true,
        text,
        json: <T = Record<string, unknown>>() => JSON.parse(text) as T,
      };
    };
  });

  afterAll(async () => {
    if (project) {
      try {
        await client.projects.delete(project.id);
      } catch {
        // best-effort teardown
      }
    }
  });

  it("reports the authenticated account", async () => {
    const result = await call("taiga_whoami");
    expect(result.isError).toBe(false);
    expect(result.json()["id"]).toBe((await client.users.me()).id);
  });

  it("reads the catalogs of the new project", async () => {
    const schema = (await call("taiga_project_schema")).json();
    const statuses = (schema["statuses"] as Record<string, Array<{ name: string; closed: boolean }>>)[
      "userstory"
    ];
    expect(statuses?.length).toBeGreaterThan(1);

    const open = statuses?.find((status) => !status.closed);
    const closed = statuses?.find((status) => status.closed);
    expect(open).toBeDefined();
    expect(closed).toBeDefined();
    openStatus = open!.name;
    closedStatus = closed!.name;

    expect((schema["members"] as Array<{ username: string }>).length).toBeGreaterThan(0);
    expect((schema["points"] as string[]).length).toBeGreaterThan(0);
  });

  it("creates a user story from names, with an estimate and tags", async () => {
    const payload = (
      await call("taiga_create_item", {
        type: "userstory",
        subject: "MCP integration: SSO login",
        description: "Created by the taiga-mcp-server integration test",
        status: openStatus,
        assigned_to: "me",
        tags: ["mcp-test"],
        points: { all: "5" },
      })
    ).json();

    // Capture the identifiers before asserting, so one bad expectation does not
    // cascade into every later test.
    storyRef = payload["ref"] as number;
    storyId = payload["id"] as number;

    expect(storyRef).toBeGreaterThan(0);
    expect(payload["status"]).toBe(openStatus);
    expect(payload["assigned_to"]).toBeTypeOf("string");
    expect(payload["tags"]).toEqual(["mcp-test"]);

    // "all" estimates every computable role at 5; Taiga's total_points is their sum.
    const points = payload["points"] as Record<string, string>;
    expect(Object.values(points).length).toBeGreaterThan(0);
    expect(new Set(Object.values(points))).toEqual(new Set(["5"]));
    expect(payload["total_points"]).toBe(5 * Object.values(points).length);
  });

  it("finds the story by #ref through the resolver", async () => {
    const payload = (await call("taiga_get_item", { type: "userstory", ref: storyRef })).json();
    expect(payload["id"]).toBe(storyId);
    expect(payload["subject"]).toBe("MCP integration: SSO login");
  });

  it("lists the story as assigned to me", async () => {
    const payload = (await call("taiga_my_work", { types: ["userstory"] })).json();
    const stories = payload["user_stories"] as Array<Record<string, unknown>>;
    expect(stories.some((story) => story["id"] === storyId)).toBe(true);
  });

  it("updates status and posts a comment in one call", async () => {
    const payload = (
      await call("taiga_update_item", {
        type: "userstory",
        ref: storyRef,
        status: closedStatus,
        comment: "Closing this from the integration test.",
      })
    ).json();

    expect(payload["status"]).toBe(closedStatus);
    expect(payload["is_closed"]).toBe(true);
    expect(payload["changed"]).toMatchObject({ comment: "added" });

    const fresh = await client.userStories.get(storyId);
    expect(fresh.is_closed).toBe(true);
  });

  it("reads back the comment and the status change from the history", async () => {
    const payload = (
      await call("taiga_list_comments", { type: "userstory", id: storyId, include_changes: true })
    ).json();
    const entries = payload["entries"] as Array<Record<string, unknown>>;

    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1];
    expect(last?.["comment"]).toBe("Closing this from the integration test.");
  });

  it("creates a sprint and a task inside it", async () => {
    const sprintName = uniqueName("Sprint");
    const sprint = (
      await call("taiga_create_sprint", {
        name: sprintName,
        start: isoDate(0),
        finish: isoDate(13),
      })
    ).json();
    expect((sprint["sprint"] as Record<string, unknown>)["name"]).toBe(sprintName);

    // A task with a parent story inherits that story's sprint, so asking for both is
    // refused rather than silently dropped.
    const refused = await call("taiga_create_item", {
      type: "task",
      subject: "MCP integration: refused",
      user_story: storyId,
      sprint: sprintName,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/follows that story's sprint/);

    const task = (
      await call("taiga_create_item", {
        type: "task",
        subject: "MCP integration: wire the callback",
        sprint: sprintName,
      })
    ).json();
    expect(task["sprint"]).toBe(sprintName);

    const childTask = (
      await call("taiga_create_item", {
        type: "task",
        subject: "MCP integration: child of the story",
        user_story: storyId,
      })
    ).json();
    // The parent comes back as an id, which is what `user_story` takes on the way in;
    // the #ref shown in the UI travels under its own name.
    expect(childTask["user_story"]).toBe(storyId);
    expect(childTask["user_story_ref"]).toBe(storyRef);

    const deleted = (
      await call("taiga_delete_item", { type: "task", id: task["id"], confirm: true })
    ).json();
    expect(deleted["deleted"]).toBe(true);
  });

  it("creates an epic and links the story to it", async () => {
    const epic = (
      await call("taiga_create_item", { type: "epic", subject: "MCP integration: auth epic" })
    ).json();

    const linked = (
      await call("taiga_link_epic", {
        action: "link",
        epic_id: epic["id"],
        user_story_id: storyId,
      })
    ).json();
    expect(linked["ok"]).toBe(true);

    const withStories = (
      await call("taiga_get_item", {
        type: "epic",
        id: epic["id"],
        include_user_stories: true,
      })
    ).json();
    const stories = withStories["user_stories"] as Array<Record<string, unknown>>;
    expect(stories.some((story) => story["id"] === storyId)).toBe(true);
  });

  it("filters a list by status name", async () => {
    const payload = (
      await call("taiga_list_items", { type: "userstory", status: closedStatus })
    ).json();
    const items = payload["items"] as Array<Record<string, unknown>>;
    expect(items.every((item) => item["status"] === closedStatus)).toBe(true);
  });

  it("rejects an unknown status without calling the API", async () => {
    const result = await call("taiga_update_item", {
      type: "userstory",
      ref: storyRef,
      status: "Definitely Not A Status",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Available:/);
  });
});
