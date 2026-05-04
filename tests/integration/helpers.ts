import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TaigaClient } from "../../src/index.js";

loadDotEnv();

export interface IntegrationEnv {
  baseUrl: string;
  login: string;
  password: string;
  templateSlug: string | undefined;
}

export function readEnv(): IntegrationEnv | null {
  const baseUrl = process.env["TAIGA_INTEGRATION_URL"];
  const login = process.env["TAIGA_TEST_USER"];
  const password = process.env["TAIGA_TEST_PASSWORD"];
  const templateSlug = process.env["TAIGA_TEMPLATE_SLUG"];
  if (!baseUrl || !login || !password) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    login,
    password,
    templateSlug: templateSlug || undefined,
  };
}

export const integrationEnv = readEnv();

export function makeClient(env: IntegrationEnv): TaigaClient {
  return new TaigaClient({
    baseUrl: env.baseUrl,
    userAgent: "taiga-api-client/integration-tests",
    timeoutMs: 30_000,
  });
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadDotEnv(): void {
  const path = resolve(process.cwd(), ".env");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
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
}
