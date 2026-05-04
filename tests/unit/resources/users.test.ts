import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("UsersResource", () => {
  it("fetches the current user via me()", async () => {
    server.use(
      http.get(`${BASE}/api/v1/users/me`, () => HttpResponse.json({ id: 1, username: "alice" })),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const me = await c.users.me();
    expect(me).toEqual({ id: 1, username: "alice" });
  });

  it("lists users", async () => {
    server.use(
      http.get(`${BASE}/api/v1/users`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("3");
        return HttpResponse.json([{ id: 1 }, { id: 2 }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const users = await c.users.list({ project: 3 });
    expect(users).toHaveLength(2);
  });

  it("gets a user by id", async () => {
    server.use(http.get(`${BASE}/api/v1/users/7`, () => HttpResponse.json({ id: 7, username: "bob" })));
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const user = await c.users.get(7);
    expect(user).toEqual({ id: 7, username: "bob" });
  });

  it("updateMe fetches /me then PUTs to /users/:id", async () => {
    server.use(
      http.get(`${BASE}/api/v1/users/me`, () => HttpResponse.json({ id: 5, username: "me" })),
      http.put(`${BASE}/api/v1/users/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["bio"]).toBe("hi");
        return HttpResponse.json({ id: 5, username: "me", bio: "hi" });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.users.updateMe({ bio: "hi" });
    expect(result).toMatchObject({ id: 5, bio: "hi" });
  });

  it("changePassword posts current/new", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${BASE}/api/v1/users/change_password`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.users.changePassword("old", "new");
    expect(body).toEqual({ current_password: "old", password: "new" });
  });

  it("returns user stats", async () => {
    server.use(http.get(`${BASE}/api/v1/users/8/stats`, () => HttpResponse.json({ total_logged: 10 })));
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const stats = await c.users.stats(8);
    expect(stats).toEqual({ total_logged: 10 });
  });

  it("create() throws — registration is not supported", async () => {
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await expect(c.users.create()).rejects.toThrow(/not supported/);
  });
});
