import os from "node:os";
import path from "node:path";

/** Resolved server configuration: environment variables merged with CLI flags. */
export interface TaigaMcpConfig {
  /** Root URL of the Taiga instance, without `/api/v1`. */
  baseUrl: string;
  /** Root URL of the Taiga web UI, used to build human-clickable links. */
  webUrl: string;
  username?: string;
  password?: string;
  applicationToken?: string;
  authToken?: string;
  refreshToken?: string;
  /** When true, no write tools are registered at all. */
  readOnly: boolean;
  /** When true, `taiga_delete_item` is registered. Off by default. */
  allowDelete: boolean;
  /** Where to cache the bearer/refresh pair, or `null` to keep tokens in memory only. */
  tokenFile: string | null;
  /** Project (id, slug or name) used when a tool call omits `project`. */
  defaultProject?: string;
  /**
   * Fixed UTC offset the activity windows are resolved in, e.g. `"+03:00"`.
   *
   * A window is a statement about local working days, so it cannot be resolved in UTC
   * without moving its edges by the offset — three hours is enough to drop a Monday
   * morning out of the week it belongs to.
   */
  tz: string;
  /** Per-request timeout passed to the Taiga client. */
  timeoutMs: number;
  /** How long a project catalog stays cached. */
  catalogTtlMs: number;
  /** Hard cap on the number of items any single tool call may return. */
  maxResults: number;
}

/** Thrown when the environment does not describe a usable Taiga connection. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const HELP_TEXT = `taiga-mcp-server — Model Context Protocol server for Taiga

Usage:
  taiga-mcp-server [options]

Connection (environment variables):
  TAIGA_URL                 Taiga instance root, without /api/v1   (required)
                            Taiga Cloud: https://api.taiga.io
  TAIGA_WEB_URL             Web UI root for building links
                            (default: tree.taiga.io for Taiga Cloud, TAIGA_URL otherwise)

Credentials — pick exactly one of:
  TAIGA_USERNAME + TAIGA_PASSWORD        username or email + password
  TAIGA_APP_TOKEN                        long-lived Application token
  TAIGA_AUTH_TOKEN [+ TAIGA_REFRESH_TOKEN]   an existing bearer token pair

Behaviour:
  TAIGA_PROJECT             default project (id, slug or name) for tools that take one
  TAIGA_TZ                  UTC offset for taiga_activity windows, default +03:00
  TAIGA_MCP_READ_ONLY=1     register read tools only
  TAIGA_MCP_ALLOW_DELETE=1  also register taiga_delete_item (off by default)
  TAIGA_MCP_TOKEN_FILE      token cache path (default ~/.taiga-mcp/tokens.json)
  TAIGA_MCP_NO_TOKEN_CACHE=1  never write tokens to disk
  TAIGA_MCP_TIMEOUT_MS      per-request timeout, default 30000
  TAIGA_MCP_CATALOG_TTL_MS  project catalog cache TTL, default 300000
  TAIGA_MCP_MAX_RESULTS     cap on items per tool call, default 100

Flags (override the environment):
  --url=<url>  --web-url=<url>  --project=<ref>  --token-file=<path>
  --read-only  --allow-delete   --no-token-cache
  --help  --version
`;

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function asBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return TRUTHY.has(value.trim().toLowerCase());
}

function asInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Trim a value and treat it as absent when empty.
 *
 * An unexpanded `${VAR}` placeholder counts as absent too: a client that interpolates its
 * config (Claude Code's `.mcp.json`, for one) passes the literal text through when the
 * variable is unset, and a literal `${TAIGA_PASSWORD}` would otherwise surface as a
 * puzzling 401 from Taiga instead of "this variable is not set".
 */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

/** Parse `--flag` / `--key=value` arguments into a plain record. */
export function parseArgs(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) flags[body] = "1";
    else flags[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return flags;
}

/** Default web UI origin for a given API origin. */
export function defaultWebUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "api.taiga.io") return "https://tree.taiga.io";
    return url.origin;
  } catch {
    return baseUrl;
  }
}

function defaultTokenFile(): string {
  return path.join(os.homedir(), ".taiga-mcp", "tokens.json");
}

/**
 * Build the configuration from environment variables and CLI flags (flags win).
 *
 * @throws {ConfigError} When the base URL is missing or no usable credential is present.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = [],
): TaigaMcpConfig {
  const flags = parseArgs(argv);

  const baseUrlRaw =
    clean(flags["url"]) ??
    clean(env["TAIGA_URL"]) ??
    clean(env["TAIGA_API_URL"]) ??
    clean(env["TAIGA_BASE_URL"]);
  if (!baseUrlRaw) {
    throw new ConfigError(
      "TAIGA_URL is not set. Point it at your Taiga instance root without /api/v1, " +
        "e.g. https://api.taiga.io for Taiga Cloud.",
    );
  }

  let baseUrl: string;
  try {
    baseUrl = new URL(baseUrlRaw).toString().replace(/\/+$/, "");
  } catch {
    throw new ConfigError(`TAIGA_URL is not a valid URL: ${baseUrlRaw}`);
  }

  const username = clean(flags["username"]) ?? clean(env["TAIGA_USERNAME"]);
  const password = clean(env["TAIGA_PASSWORD"]);
  const applicationToken =
    clean(env["TAIGA_APP_TOKEN"]) ?? clean(env["TAIGA_APPLICATION_TOKEN"]);
  const authToken = clean(env["TAIGA_AUTH_TOKEN"]) ?? clean(env["TAIGA_TOKEN"]);
  const refreshToken = clean(env["TAIGA_REFRESH_TOKEN"]);

  const hasPasswordLogin = Boolean(username && password);
  if (!hasPasswordLogin && !applicationToken && !authToken) {
    // The half-configured case gets the more specific message.
    if (username) {
      throw new ConfigError("TAIGA_USERNAME is set but TAIGA_PASSWORD is missing.");
    }
    throw new ConfigError(
      "No Taiga credentials found. Set TAIGA_USERNAME + TAIGA_PASSWORD, " +
        "or TAIGA_APP_TOKEN, or TAIGA_AUTH_TOKEN (optionally with TAIGA_REFRESH_TOKEN).",
    );
  }

  const cacheDisabled =
    asBool(flags["no-token-cache"]) || asBool(env["TAIGA_MCP_NO_TOKEN_CACHE"]);

  return {
    baseUrl,
    webUrl: (
      clean(flags["web-url"]) ??
      clean(env["TAIGA_WEB_URL"]) ??
      defaultWebUrl(baseUrl)
    ).replace(/\/+$/, ""),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(applicationToken ? { applicationToken } : {}),
    ...(authToken ? { authToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    readOnly: asBool(flags["read-only"]) || asBool(env["TAIGA_MCP_READ_ONLY"]),
    allowDelete: asBool(flags["allow-delete"]) || asBool(env["TAIGA_MCP_ALLOW_DELETE"]),
    tokenFile: cacheDisabled
      ? null
      : (clean(flags["token-file"]) ?? clean(env["TAIGA_MCP_TOKEN_FILE"]) ?? defaultTokenFile()),
    ...(clean(flags["project"]) ?? clean(env["TAIGA_PROJECT"])
      ? { defaultProject: (clean(flags["project"]) ?? clean(env["TAIGA_PROJECT"])) as string }
      : {}),
    tz: clean(env["TAIGA_TZ"]) ?? clean(env["TAIGA_TIMEZONE"]) ?? "+03:00",
    timeoutMs: asInt(env["TAIGA_MCP_TIMEOUT_MS"], 30_000),
    catalogTtlMs: asInt(env["TAIGA_MCP_CATALOG_TTL_MS"], 300_000),
    maxResults: Math.min(asInt(env["TAIGA_MCP_MAX_RESULTS"], 100), 500),
  };
}
