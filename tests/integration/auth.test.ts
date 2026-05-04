import { describe, expect, it } from "vitest";
import { TaigaClient } from "../../src/index.js";
import { integrationEnv, makeClient } from "./helpers.js";

const skip = !integrationEnv;
const d = skip ? describe.skip : describe;

d("integration: auth", () => {
  const env = integrationEnv!;

  it("logs in with valid credentials and returns tokens", async () => {
    const client = makeClient(env);
    const result = await client.auth.login({ username: env.login, password: env.password });
    expect(typeof result.auth_token).toBe("string");
    expect(typeof result.refresh).toBe("string");
    const tokens = client.auth.getTokens();
    expect(tokens?.token).toBe(result.auth_token);
    expect(tokens?.refreshToken).toBe(result.refresh);
  });

  it("refreshes the access token", async () => {
    const client = makeClient(env);
    const login = await client.auth.login({ username: env.login, password: env.password });
    const newToken = await client.auth.refresh();
    expect(typeof newToken).toBe("string");
    expect(newToken).not.toBe("");
    const tokens = client.auth.getTokens();
    expect(tokens?.token).toBe(newToken);
    expect(tokens?.refreshToken).not.toBe(login.refresh);
  });

  it("can fetch /users/me with the bearer token", async () => {
    const client = makeClient(env);
    await client.auth.login({ username: env.login, password: env.password });
    const me = await client.users.me();
    const matches = me.username === env.login || me.email === env.login;
    expect(matches, `expected /users/me to match login ${env.login}, got ${me.username} / ${me.email}`).toBe(true);
  });

  it("clears tokens on logout", async () => {
    const client = makeClient(env);
    await client.auth.login({ username: env.login, password: env.password });
    expect(client.auth.getTokens()).not.toBeNull();
    await client.auth.logout();
    expect(client.auth.getTokens()).toBeNull();
  });

  it("calls onTokenChange after login and refresh", async () => {
    const events: Array<{ token: string } | null> = [];
    const client = new TaigaClient({
      baseUrl: env.baseUrl,
      onTokenChange: (t) => {
        events.push(t);
      },
    });
    await client.auth.login({ username: env.login, password: env.password });
    await client.auth.refresh();
    expect(events).toHaveLength(2);
    expect(events[0]?.token).toBeTypeOf("string");
    expect(events[1]?.token).toBeTypeOf("string");
    expect(events[0]?.token).not.toBe(events[1]?.token);
  });
});
