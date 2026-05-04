import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("UserStoriesResource", () => {
  it("lists stories filtered by project", async () => {
    server.use(
      http.get(`${BASE}/api/v1/userstories`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("1");
        return HttpResponse.json([{ id: 1, subject: "S" }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const list = await c.userStories.list({ project: 1 });
    expect(list).toEqual([{ id: 1, subject: "S" }]);
  });

  it("creates a story", async () => {
    server.use(
      http.post(`${BASE}/api/v1/userstories`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["project"]).toBe(1);
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.userStories.create({ project: 1, subject: "New" });
    expect(result).toMatchObject({ id: 100, subject: "New" });
  });

  it("patches a story with version (OCC)", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/userstories/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["version"]).toBe(2);
        return HttpResponse.json({ id: 5, version: 3 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const r = await c.userStories.patch(5, { subject: "X" }, 2);
    expect(r).toMatchObject({ id: 5, version: 3 });
  });

  it("deletes a story", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/userstories/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.userStories.delete(9);
    expect(called).toBe(true);
  });

  it("bulk-creates stories", async () => {
    server.use(
      http.post(`${BASE}/api/v1/userstories/bulk_create`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["bulk_stories"]).toBe("A\nB");
        return HttpResponse.json([{ id: 1 }, { id: 2 }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const r = await c.userStories.bulkCreate({ project_id: 1, bulk_stories: "A\nB" });
    expect(r).toHaveLength(2);
  });

  it.each([
    ["bulkUpdateBacklogOrder", "/api/v1/userstories/bulk_update_backlog_order"],
    ["bulkUpdateKanbanOrder", "/api/v1/userstories/bulk_update_kanban_order"],
    ["bulkUpdateSprintOrder", "/api/v1/userstories/bulk_update_sprint_order"],
  ])("%s posts to the correct endpoint", async (method, path) => {
    let called = false;
    server.use(
      http.post(`${BASE}${path}`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await (c.userStories as unknown as Record<string, (p: unknown) => Promise<void>>)[method]!({
      project_id: 1,
      bulk_stories: [{ us_id: 1, order: 1 }],
    });
    expect(called).toBe(true);
  });

  it("returns filters_data", async () => {
    server.use(
      http.get(`${BASE}/api/v1/userstories/filters_data`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("7");
        return HttpResponse.json({ statuses: [] });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.userStories.filtersData({ project: 7 })).toEqual({ statuses: [] });
  });
});
