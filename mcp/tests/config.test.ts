import { describe, expect, it } from "vitest";
import { ConfigError, defaultWebUrl, loadConfig, parseArgs } from "../src/config.js";

const PASSWORD_ENV = {
  TAIGA_URL: "https://api.taiga.io",
  TAIGA_USERNAME: "alice",
  TAIGA_PASSWORD: "secret",
};

describe("parseArgs", () => {
  it("reads bare flags and key=value pairs", () => {
    expect(parseArgs(["--read-only", "--project=apollo", "ignored"])).toEqual({
      "read-only": "1",
      project: "apollo",
    });
  });
});

describe("defaultWebUrl", () => {
  it("maps the Taiga Cloud API host onto the UI host", () => {
    expect(defaultWebUrl("https://api.taiga.io")).toBe("https://tree.taiga.io");
  });

  it("keeps the origin of a self-hosted instance", () => {
    expect(defaultWebUrl("http://localhost:9000/")).toBe("http://localhost:9000");
  });
});

describe("loadConfig", () => {
  it("accepts a username and password", () => {
    const config = loadConfig(PASSWORD_ENV, []);
    expect(config.baseUrl).toBe("https://api.taiga.io");
    expect(config.webUrl).toBe("https://tree.taiga.io");
    expect(config.username).toBe("alice");
    expect(config.readOnly).toBe(false);
    expect(config.allowDelete).toBe(false);
  });

  it("accepts an application token alone", () => {
    const config = loadConfig({ TAIGA_URL: "https://taiga.test", TAIGA_APP_TOKEN: "app-token" }, []);
    expect(config.applicationToken).toBe("app-token");
    expect(config.username).toBeUndefined();
  });

  it("rejects a missing base URL", () => {
    expect(() => loadConfig({ TAIGA_APP_TOKEN: "x" }, [])).toThrow(ConfigError);
  });

  it("rejects an invalid base URL", () => {
    expect(() => loadConfig({ TAIGA_URL: "not a url", TAIGA_APP_TOKEN: "x" }, [])).toThrow(
      /not a valid URL/,
    );
  });

  it("rejects a configuration with no credentials", () => {
    expect(() => loadConfig({ TAIGA_URL: "https://taiga.test" }, [])).toThrow(/No Taiga credentials/);
  });

  it("rejects a username without a password", () => {
    expect(() =>
      loadConfig({ TAIGA_URL: "https://taiga.test", TAIGA_USERNAME: "alice" }, []),
    ).toThrow(/TAIGA_PASSWORD is missing/);
  });

  it("lets flags override the environment", () => {
    const config = loadConfig({ ...PASSWORD_ENV, TAIGA_PROJECT: "from-env" }, [
      "--read-only",
      "--allow-delete",
      "--project=from-flag",
      "--web-url=https://ui.example.com/",
    ]);
    expect(config.readOnly).toBe(true);
    expect(config.allowDelete).toBe(true);
    expect(config.defaultProject).toBe("from-flag");
    expect(config.webUrl).toBe("https://ui.example.com");
  });

  it("disables the token cache on request", () => {
    expect(loadConfig(PASSWORD_ENV, ["--no-token-cache"]).tokenFile).toBeNull();
    expect(loadConfig({ ...PASSWORD_ENV, TAIGA_MCP_TOKEN_FILE: "/tmp/t.json" }, []).tokenFile).toBe(
      "/tmp/t.json",
    );
  });

  it("treats an unexpanded ${VAR} placeholder as unset", () => {
    // Claude Code passes the literal text through when a .mcp.json variable has no value.
    expect(() =>
      loadConfig(
        {
          TAIGA_URL: "https://taiga.test",
          TAIGA_USERNAME: "alice",
          TAIGA_PASSWORD: "${TAIGA_PASSWORD}",
        },
        [],
      ),
    ).toThrow(/TAIGA_PASSWORD is missing/);

    const config = loadConfig(
      { ...PASSWORD_ENV, TAIGA_PROJECT: "${TAIGA_PROJECT}", TAIGA_WEB_URL: "${TAIGA_WEB_URL}" },
      [],
    );
    expect(config.defaultProject).toBeUndefined();
    expect(config.webUrl).toBe("https://tree.taiga.io");
  });

  it("falls back to defaults for malformed numbers", () => {
    const config = loadConfig({ ...PASSWORD_ENV, TAIGA_MCP_TIMEOUT_MS: "soon" }, []);
    expect(config.timeoutMs).toBe(30_000);
  });
});
