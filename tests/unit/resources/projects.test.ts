import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../../src/client.js";
import { server } from "../setup.js";

const BASE = "https://api.example.com";

describe("ProjectsResource", () => {
  it("lists projects", async () => {
    server.use(
      http.get(`${BASE}/api/v1/projects`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("member")).toBe("7");
        return HttpResponse.json([{ id: 1, name: "P1" }]);
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const projects = await c.projects.list({ member: 7 });
    expect(projects).toEqual([{ id: 1, name: "P1" }]);
  });

  it("gets a project by id", async () => {
    server.use(http.get(`${BASE}/api/v1/projects/42`, () => HttpResponse.json({ id: 42, name: "X" })));
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.projects.get(42);
    expect(result).toEqual({ id: 42, name: "X" });
  });

  it("creates a project", async () => {
    server.use(
      http.post(`${BASE}/api/v1/projects`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["name"]).toBe("New");
        return HttpResponse.json({ id: 100, ...body });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.projects.create({ name: "New", description: "d" });
    expect(result).toMatchObject({ id: 100, name: "New" });
  });

  it("patches a project with version (OCC)", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/projects/5`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body["version"]).toBe(3);
        expect(body["name"]).toBe("Renamed");
        return HttpResponse.json({ id: 5, name: "Renamed", version: 4 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.projects.patch(5, { name: "Renamed" }, 3);
    expect(result).toMatchObject({ id: 5, name: "Renamed" });
  });

  it("deletes a project", async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/api/v1/projects/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    await c.projects.delete(9);
    expect(called).toBe(true);
  });

  it("supports getBySlug", async () => {
    server.use(
      http.get(`${BASE}/api/v1/projects/by_slug`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("slug")).toBe("my-proj");
        return HttpResponse.json({ id: 1, slug: "my-proj" });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const result = await c.projects.getBySlug("my-proj");
    expect(result).toEqual({ id: 1, slug: "my-proj" });
  });

  it("paginates across pages", async () => {
    server.use(
      http.get(`${BASE}/api/v1/projects`, ({ request }) => {
        const url = new URL(request.url);
        const page = url.searchParams.get("page");
        if (page === "1") {
          return HttpResponse.json([{ id: 1 }, { id: 2 }], {
            headers: {
              "x-paginated": "true",
              "x-paginated-by": "2",
              "x-pagination-count": "3",
              "x-pagination-current": "1",
              "x-pagination-next": `${BASE}/api/v1/projects?page=2`,
            },
          });
        }
        return HttpResponse.json([{ id: 3 }], {
          headers: {
            "x-paginated": "true",
            "x-paginated-by": "2",
            "x-pagination-count": "3",
            "x-pagination-current": "2",
          },
        });
      }),
    );
    const c = new TaigaClient({ baseUrl: BASE, token: "tok" });
    const ids: number[] = [];
    for await (const p of c.projects.paginate()) {
      ids.push((p as { id: number }).id);
    }
    expect(ids).toEqual([1, 2, 3]);
  });
});
