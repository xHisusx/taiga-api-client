import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("MembershipsResource", () => {
  it("lists memberships filtered by project", async () => {
    server.use(
      http.get(`${BASE}/api/v1/memberships`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("project")).toBe("3");
        return HttpResponse.json([{ id: 1, user: 10, role: 2 }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const list = await c.memberships.list({ project: 3 });
    expect(list).toHaveLength(1);
  });

  it("gets one membership", async () => {
    server.use(http.get(`${BASE}/api/v1/memberships/9`, () => HttpResponse.json({ id: 9 })));
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    expect(await c.memberships.get(9)).toEqual({ id: 9 });
  });

  it("creates a membership", async () => {
    server.use(
      http.post(`${BASE}/api/v1/memberships`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["project"]).toBe(1);
        expect(body["username"]).toBe("alice@example.com");
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.memberships.create({
      project: 1,
      role: 2,
      username: "alice@example.com",
    });
    expect(result).toMatchObject({ id: 100 });
  });

  it("deletes a membership", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/memberships/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.memberships.delete(9);
    expect(called).toBe(true);
  });

  it("bulk-creates memberships", async () => {
    server.use(
      http.post(`${BASE}/api/v1/memberships/bulk_create`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["project_id"]).toBe(1);
        expect(Array.isArray(body["bulk_memberships"])).toBe(true);
        return HttpResponse.json([{ id: 1 }, { id: 2 }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.memberships.bulkCreate({
      project_id: 1,
      bulk_memberships: [
        { role_id: 2, username: "a@x" },
        { role_id: 2, username: "b@x" },
      ],
    });
    expect(result).toHaveLength(2);
  });

  it("resends invitation", async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/api/v1/memberships/9/resend_invitation`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.memberships.resendInvitation(9);
    expect(called).toBe(true);
  });
});
