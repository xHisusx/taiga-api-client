import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("MilestonesResource", () => {
  it("lists milestones filtered by project", async () => {
    server.use(
      http.get(`${BASE}/api/v1/milestones`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("1");
        return HttpResponse.json([{ id: 1, name: "Sprint" }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.milestones.list({ project: 1 })).toEqual([{ id: 1, name: "Sprint" }]);
  });

  it("creates a milestone", async () => {
    server.use(
      http.post(`${BASE}/api/v1/milestones`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["name"]).toBe("Sprint 1");
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const r = await c.milestones.create({
      project: 1,
      name: "Sprint 1",
      estimated_start: "2026-01-01",
      estimated_finish: "2026-01-14",
    });
    expect(r).toMatchObject({ id: 100 });
  });

  it("patches a milestone with version (OCC)", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/milestones/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["version"]).toBe(2);
        return HttpResponse.json({ id: 5, version: 3 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.milestones.patch(5, { name: "x" }, 2)).toMatchObject({ id: 5 });
  });

  it("deletes a milestone", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/milestones/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.milestones.delete(9);
    expect(called).toBe(true);
  });

  it("returns burndown stats", async () => {
    server.use(
      http.get(`${BASE}/api/v1/milestones/4/stats`, () =>
        HttpResponse.json({ name: "Sprint", total_points: 10, completed_points: 4 }),
      ),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const stats = await c.milestones.stats(4);
    expect(stats).toMatchObject({ name: "Sprint", total_points: 10 });
  });
});
