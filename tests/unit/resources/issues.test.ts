import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("IssuesResource", () => {
  it("lists issues filtered by project", async () => {
    server.use(
      http.get(`${BASE}/api/v1/issues`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("1");
        return HttpResponse.json([{ id: 1, subject: "I" }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.issues.list({ project: 1 })).toEqual([{ id: 1, subject: "I" }]);
  });

  it("creates an issue", async () => {
    server.use(
      http.post(`${BASE}/api/v1/issues`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["subject"]).toBe("New");
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const r = await c.issues.create({ project: 1, subject: "New" });
    expect(r).toMatchObject({ id: 100 });
  });

  it("patches an issue with version (OCC)", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/issues/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["version"]).toBe(2);
        return HttpResponse.json({ id: 5 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.issues.patch(5, { subject: "x" }, 2);
  });

  it("deletes an issue", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/issues/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.issues.delete(9);
    expect(called).toBe(true);
  });

  it("returns filters_data", async () => {
    server.use(
      http.get(`${BASE}/api/v1/issues/filters_data`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("7");
        return HttpResponse.json({ types: [] });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.issues.filtersData({ project: 7 })).toEqual({ types: [] });
  });

  it("lists voters and watchers", async () => {
    server.use(
      http.get(`${BASE}/api/v1/issues/4/voters`, () =>
        HttpResponse.json([{ id: 1, username: "a", full_name: "A" }]),
      ),
      http.get(`${BASE}/api/v1/issues/4/watchers`, () =>
        HttpResponse.json([{ id: 2, username: "b", full_name: "B" }]),
      ),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.issues.voters(4)).toHaveLength(1);
    expect(await c.issues.watchers(4)).toHaveLength(1);
  });

  it("upvote/downvote/watch/unwatch hit the right endpoints", async () => {
    const seen: string[] = [];
    for (const action of ["upvote", "downvote", "watch", "unwatch"]) {
      server.use(
        http.post(`${BASE}/api/v1/issues/4/${action}`, () => {
          seen.push(action);
          return new HttpResponse(null, { status: 200 });
        }),
      );
    }
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.issues.upvote(4);
    await c.issues.downvote(4);
    await c.issues.watch(4);
    await c.issues.unwatch(4);
    expect(seen).toEqual(["upvote", "downvote", "watch", "unwatch"]);
  });
});
