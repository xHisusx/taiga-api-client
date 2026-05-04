import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { AuthManager } from "../../src/auth.js";
import { HttpClient } from "../../src/http.js";
import {
  TaigaApiError,
  TaigaAuthError,
  TaigaRateLimitError,
} from "../../src/errors.js";
import { server } from "./setup.js";

const BASE = "https://api.example.com";

function makeClient(opts: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  const auth = new AuthManager({ token: "tok" });
  return new HttpClient({ baseUrl: BASE, auth, ...opts });
}

describe("HttpClient", () => {
  it("sends Authorization header with bearer token and parses JSON", async () => {
    let receivedAuth: string | null = null;
    server.use(
      http.get(`${BASE}/api/v1/projects`, ({ request }) => {
        receivedAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: 1 }]);
      }),
    );
    const client = makeClient();
    const result = await client.get<{ id: number }[]>("/projects");
    expect(receivedAuth).toBe("Bearer tok");
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.status).toBe(200);
  });

  it("serializes query parameters", async () => {
    let receivedUrl = "";
    server.use(
      http.get(`${BASE}/api/v1/userstories`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await makeClient().get("/userstories", { query: { project: 5, status: 3, milestone: "null" } });
    const url = new URL(receivedUrl);
    expect(url.searchParams.get("project")).toBe("5");
    expect(url.searchParams.get("status")).toBe("3");
    expect(url.searchParams.get("milestone")).toBe("null");
  });

  it("attaches x-disable-pagination header when requested", async () => {
    let value: string | null = null;
    server.use(
      http.get(`${BASE}/api/v1/x`, ({ request }) => {
        value = request.headers.get("x-disable-pagination");
        return HttpResponse.json([]);
      }),
    );
    await makeClient().get("/x", { disablePagination: true });
    expect(value).toBe("True");
  });

  it("parses pagination meta from headers", async () => {
    server.use(
      http.get(`${BASE}/api/v1/projects`, () =>
        HttpResponse.json([], {
          headers: {
            "x-paginated": "true",
            "x-paginated-by": "30",
            "x-pagination-count": "60",
            "x-pagination-current": "1",
            "x-pagination-next": "https://api.example.com/api/v1/projects?page=2",
          },
        }),
      ),
    );
    const result = await makeClient().get("/projects");
    expect(result.pagination?.count).toBe(60);
    expect(result.pagination?.next).toBe("https://api.example.com/api/v1/projects?page=2");
  });

  it("throws TaigaAuthError on 401 when no refresh token", async () => {
    server.use(
      http.get(`${BASE}/api/v1/x`, () => HttpResponse.json({ _error_message: "no" }, { status: 401 })),
    );
    const auth = new AuthManager({ token: "tok" });
    const client = new HttpClient({ baseUrl: BASE, auth });
    await expect(client.get("/x")).rejects.toBeInstanceOf(TaigaAuthError);
  });

  it("throws TaigaRateLimitError with retry-after on 429", async () => {
    server.use(
      http.get(`${BASE}/api/v1/x`, () =>
        HttpResponse.json({}, { status: 429, headers: { "retry-after": "12" } }),
      ),
    );
    try {
      await makeClient().get("/x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TaigaRateLimitError);
      expect((e as TaigaRateLimitError).retryAfter).toBe(12);
    }
  });

  it("throws TaigaApiError on generic 4xx/5xx", async () => {
    server.use(http.get(`${BASE}/api/v1/x`, () => HttpResponse.json({ a: 1 }, { status: 500 })));
    await expect(makeClient().get("/x")).rejects.toBeInstanceOf(TaigaApiError);
  });

  it("uses Application <token> when applicationToken is set", async () => {
    let receivedAuth: string | null = null;
    server.use(
      http.get(`${BASE}/api/v1/x`, ({ request }) => {
        receivedAuth = request.headers.get("authorization");
        return HttpResponse.json({});
      }),
    );
    const auth = new AuthManager({ applicationToken: "appTok" });
    const client = new HttpClient({ baseUrl: BASE, auth });
    await client.get("/x");
    expect(receivedAuth).toBe("Application appTok");
  });

  it("returns undefined data for 204 responses", async () => {
    server.use(http.delete(`${BASE}/api/v1/x/1`, () => new HttpResponse(null, { status: 204 })));
    const result = await makeClient().delete("/x/1");
    expect(result.status).toBe(204);
    expect(result.data).toBeUndefined();
  });
});
