import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("EpicsResource", () => {
  it("lists epics filtered by project", async () => {
    server.use(
      http.get(`${BASE}/api/v1/epics`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("3");
        return HttpResponse.json([{ id: 10, subject: "Roadmap" }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const epics = await c.epics.list({ project: 3 });
    expect(epics).toEqual([{ id: 10, subject: "Roadmap" }]);
  });

  it("gets an epic by id", async () => {
    server.use(http.get(`${BASE}/api/v1/epics/42`, () => HttpResponse.json({ id: 42, subject: "X" })));
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.epics.get(42);
    expect(result).toEqual({ id: 42, subject: "X" });
  });

  it("creates an epic", async () => {
    server.use(
      http.post(`${BASE}/api/v1/epics`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["project"]).toBe(1);
        expect(body["subject"]).toBe("New epic");
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.epics.create({ project: 1, subject: "New epic" });
    expect(result).toMatchObject({ id: 100, subject: "New epic" });
  });

  it("patches an epic with version (OCC)", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/epics/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["version"]).toBe(2);
        expect(body["subject"]).toBe("Renamed");
        return HttpResponse.json({ id: 5, subject: "Renamed", version: 3 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.epics.patch(5, { subject: "Renamed" }, 2);
    expect(result).toMatchObject({ id: 5, subject: "Renamed", version: 3 });
  });

  it("deletes an epic", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/epics/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.epics.delete(9);
    expect(called).toBe(true);
  });

  it("bulk-creates epics", async () => {
    server.use(
      http.post(`${BASE}/api/v1/epics/bulk_create`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["project_id"]).toBe(1);
        expect(body["bulk_epics"]).toBe("A\nB");
        return HttpResponse.json([
          { id: 1, subject: "A" },
          { id: 2, subject: "B" },
        ]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.epics.bulkCreate({ project_id: 1, bulk_epics: "A\nB" });
    expect(result).toHaveLength(2);
  });

  it("returns filters_data", async () => {
    server.use(
      http.get(`${BASE}/api/v1/epics/filters_data`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("7");
        return HttpResponse.json({ statuses: [], tags: [] });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const data = await c.epics.filtersData({ project: 7 });
    expect(data).toEqual({ statuses: [], tags: [] });
  });

  it("lists related user stories", async () => {
    server.use(
      http.get(`${BASE}/api/v1/epics/4/related_userstories`, () =>
        HttpResponse.json([{ epic: 4, user_story: 11, order: 1 }]),
      ),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.epics.relatedUserStories(4);
    expect(result).toEqual([{ epic: 4, user_story: 11, order: 1 }]);
  });

  it("adds a related user story", async () => {
    server.use(
      http.post(`${BASE}/api/v1/epics/4/related_userstories`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["user_story"]).toBe(11);
        return HttpResponse.json({ epic: 4, user_story: 11, order: 1 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.epics.addRelatedUserStory(4, { user_story: 11 });
    expect(result).toEqual({ epic: 4, user_story: 11, order: 1 });
  });

  it("removes a related user story", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/epics/4/related_userstories/11`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.epics.removeRelatedUserStory(4, 11);
    expect(called).toBe(true);
  });

  it("lists voters", async () => {
    server.use(
      http.get(`${BASE}/api/v1/epics/4/voters`, () =>
        HttpResponse.json([{ id: 1, username: "alice", full_name: "Alice" }]),
      ),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const voters = await c.epics.voters(4);
    expect(voters).toHaveLength(1);
  });

  it("upvotes and downvotes", async () => {
    let upvoted = false;
    let downvoted = false;
    server.use(
      http.post(`${BASE}/api/v1/epics/4/upvote`, () => {
        upvoted = true;
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(`${BASE}/api/v1/epics/4/downvote`, () => {
        downvoted = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.epics.upvote(4);
    await c.epics.downvote(4);
    expect(upvoted).toBe(true);
    expect(downvoted).toBe(true);
  });

  it("lists watchers", async () => {
    server.use(
      http.get(`${BASE}/api/v1/epics/4/watchers`, () =>
        HttpResponse.json([{ id: 2, username: "bob", full_name: "Bob" }]),
      ),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const watchers = await c.epics.watchers(4);
    expect(watchers).toHaveLength(1);
  });

  it("watches and unwatches", async () => {
    let watched = false;
    let unwatched = false;
    server.use(
      http.post(`${BASE}/api/v1/epics/4/watch`, () => {
        watched = true;
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(`${BASE}/api/v1/epics/4/unwatch`, () => {
        unwatched = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.epics.watch(4);
    await c.epics.unwatch(4);
    expect(watched).toBe(true);
    expect(unwatched).toBe(true);
  });
});
