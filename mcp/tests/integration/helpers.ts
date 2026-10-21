import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

/** Credentials for the throwaway Taiga account these tests run against. */
export interface IntegrationEnv {
  baseUrl: string;
  login: string;
  password: string;
}

/** `null` when `.env` is not filled in — every integration test then skips itself. */
export function readEnv(): IntegrationEnv | null {
  const baseUrl = process.env["TAIGA_INTEGRATION_URL"];
  const login = process.env["TAIGA_TEST_USER"];
  const password = process.env["TAIGA_TEST_PASSWORD"];
  if (!baseUrl || !login || !password) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), login, password };
}

export const integrationEnv = readEnv();

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** `YYYY-MM-DD`, `offsetDays` from today. */
export function isoDate(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * Load the repository-root `.env` the same way the client's own integration tests do.
 * This package runs with `mcp/` as the working directory, so the parent is tried first.
 */
function loadDotEnv(): void {
  for (const candidate of [resolve(process.cwd(), "..", ".env"), resolve(process.cwd(), ".env")]) {
    let text: string;
    try {
      text = readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}
