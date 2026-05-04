import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("TasksResource", () => {
  it("lists tasks filtered by project", async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("1");
        return HttpResponse.json([{ id: 1, subject: "T" }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.tasks.list({ project: 1 })).toEqual([{ id: 1, subject: "T" }]);
  });

  it("creates a task linked to a story", async () => {
    server.use(
      http.post(`${BASE}/api/v1/tasks`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["user_story"]).toBe(11);
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.tasks.create({ project: 1, subject: "x", user_story: 11 });
    expect(result).toMatchObject({ id: 100, user_story: 11 });
  });

  it("patches a task with version (OCC)", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/tasks/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["version"]).toBe(2);
        return HttpResponse.json({ id: 5 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.tasks.patch(5, { subject: "y" }, 2)).toEqual({ id: 5 });
  });

  it("deletes a task", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/tasks/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.tasks.delete(9);
    expect(called).toBe(true);
  });

  it("bulk-creates tasks", async () => {
    server.use(
      http.post(`${BASE}/api/v1/tasks/bulk_create`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["bulk_tasks"]).toBe("A\nB");
        return HttpResponse.json([{ id: 1 }, { id: 2 }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const r = await c.tasks.bulkCreate({ project_id: 1, bulk_tasks: "A\nB" });
    expect(r).toHaveLength(2);
  });

  it("returns filters_data", async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks/filters_data`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("3");
        return HttpResponse.json({ statuses: [] });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.tasks.filtersData({ project: 3 })).toEqual({ statuses: [] });
  });
});
