import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { AuthManager } from "../../src/auth.js";
import { HttpClient } from "../../src/http.js";
import { AuthResource } from "../../src/resources/auth.js";
import { TaigaAuthError } from "../../src/errors.js";
import { server } from "./setup.js";

const BASE = "https://api.example.com";

function setup(opts: { token?: string | null; refreshToken?: string | null; autoRefresh?: boolean } = {}) {
  const auth = new AuthManager({
    token: opts.token ?? "old-token",
    refreshToken: opts.refreshToken ?? "rt-1",
  });
  const http = new HttpClient({ baseUrl: BASE, auth, autoRefresh: opts.autoRefresh });
  const authRes = new AuthResource({ http, auth });
  return { auth, http, authRes };
}

describe("AuthManager refresh", () => {
  it("auto-refreshes on 401 and retries the original request once", async () => {
    let firstCall = true;
    let refreshCalls = 0;
    server.use(
      http.get(`${BASE}/api/v1/projects`, ({ request }) => {
        const authz = request.headers.get("authorization");
        if (firstCall) {
          firstCall = false;
          expect(authz).toBe("Bearer old-token");
          return HttpResponse.json({ _error_message: "expired" }, { status: 401 });
        }
        expect(authz).toBe("Bearer NEW");
        return HttpResponse.json([{ id: 1 }]);
      }),
      http.post(`${BASE}/api/v1/auth/refresh`, async ({ request }) => {
        refreshCalls += 1;
        const body = (await request.json()) as { refresh: string };
        expect(body.refresh).toBe("rt-1");
        return HttpResponse.json({ auth_token: "NEW", refresh: "rt-2" });
      }),
    );

    const { http: client, auth } = setup();
    const result = await client.get<{ id: number }[]>("/projects");
    expect(result.data).toEqual([{ id: 1 }]);
    expect(refreshCalls).toBe(1);
    expect(auth.getTokens()).toEqual({ token: "NEW", refreshToken: "rt-2" });
  });

  it("dedupes parallel refreshes (only one POST /auth/refresh)", async () => {
    let refreshCalls = 0;
    let resolveRefresh: ((v: unknown) => void) | null = null;
    const refreshGate = new Promise((resolve) => {
      resolveRefresh = resolve;
    });

    let getCalls = 0;
    server.use(
      http.get(`${BASE}/api/v1/x`, ({ request }) => {
        getCalls += 1;
        const authz = request.headers.get("authorization");
        if (authz === "Bearer old-token") {
          return HttpResponse.json({}, { status: 401 });
        }
        return HttpResponse.json({ ok: true });
      }),
      http.post(`${BASE}/api/v1/auth/refresh`, async () => {
        refreshCalls += 1;
        await refreshGate;
        return HttpResponse.json({ auth_token: "NEW", refresh: "rt-2" });
      }),
    );

    const { http: client } = setup();

    const p1 = client.get("/x");
    const p2 = client.get("/x");
    const p3 = client.get("/x");

    await Promise.resolve();
    await Promise.resolve();
    resolveRefresh!(undefined);

    await Promise.all([p1, p2, p3]);
    expect(refreshCalls).toBe(1);
    expect(getCalls).toBe(6);
  });

  it("clears tokens and throws TaigaAuthError when refresh itself fails", async () => {
    server.use(
      http.get(`${BASE}/api/v1/x`, () => HttpResponse.json({}, { status: 401 })),
      http.post(`${BASE}/api/v1/auth/refresh`, () => HttpResponse.json({}, { status: 401 })),
    );
    const { http: client } = setup();
    await expect(client.get("/x")).rejects.toBeInstanceOf(TaigaAuthError);
  });

  it("does NOT refresh when autoRefresh is false", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(`${BASE}/api/v1/x`, () => HttpResponse.json({}, { status: 401 })),
      http.post(`${BASE}/api/v1/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ auth_token: "NEW", refresh: "rt-2" });
      }),
    );
    const { http: client } = setup({ autoRefresh: false });
    await expect(client.get("/x")).rejects.toBeInstanceOf(TaigaAuthError);
    expect(refreshCalls).toBe(0);
  });

  it("calls onTokenChange after login and after successful refresh", async () => {
    server.use(
      http.post(`${BASE}/api/v1/auth`, () =>
        HttpResponse.json({
          id: 1,
          username: "u",
          email: "e@x",
          full_name: "U",
          full_name_display: "U",
          bio: "",
          lang: "en",
          theme: "dark",
          timezone: "UTC",
          is_active: true,
          photo: null,
          big_photo: null,
          gravatar_id: null,
          roles: [],
          date_joined: "2025-01-01T00:00:00Z",
          auth_token: "T1",
          refresh: "R1",
        }),
      ),
      http.post(`${BASE}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ auth_token: "T2", refresh: "R2" }),
      ),
    );
    const onChange = vi.fn();
    const auth = new AuthManager({ onTokenChange: onChange });
    const client = new HttpClient({ baseUrl: BASE, auth });
    const authRes = new AuthResource({ http: client, auth });

    await authRes.login({ username: "u", password: "p" });
    expect(onChange).toHaveBeenLastCalledWith({ token: "T1", refreshToken: "R1" });

    await authRes.refresh();
    expect(onChange).toHaveBeenLastCalledWith({ token: "T2", refreshToken: "R2" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
