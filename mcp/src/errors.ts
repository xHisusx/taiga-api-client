import {
  TaigaApiError,
  TaigaAuthError,
  TaigaNetworkError,
  TaigaRateLimitError,
} from "taiga-api-client";
import { ConfigError } from "./config.js";
import { ResolutionError } from "./catalog.js";

/** The slice of the MCP `CallToolResult` shape this server produces. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Successful tool result: the payload as pretty-printed JSON. */
export function toolText(payload: unknown): ToolResult {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Failed tool result. MCP reports tool failures in-band so the model can react. */
export function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function bodyExcerpt(body: unknown): string {
  if (body === null || body === undefined || body === "") return "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/**
 * Turn any thrown value into a message that helps whoever reads it do better next time:
 * the HTTP status, Taiga's own explanation, and a hint about the usual cause.
 */
export function describeError(error: unknown): string {
  if (error instanceof ResolutionError || error instanceof ConfigError) {
    return error.message;
  }

  if (error instanceof TaigaRateLimitError) {
    const wait = error.retryAfter !== undefined ? ` Retry after ${error.retryAfter}s.` : "";
    return `Taiga is rate limiting this account (429).${wait}`;
  }

  if (error instanceof TaigaAuthError) {
    if (error.status === 403) {
      return (
        `Taiga refused this action (403): your account does not have permission for it in ` +
        `this project. Check "permissions" in taiga_project_schema. ${error.detail ?? ""}`.trim()
      );
    }
    return (
      `Taiga rejected the credentials (401). If the server was started with a token, it may ` +
      `have expired — set TAIGA_USERNAME and TAIGA_PASSWORD, or refresh TAIGA_APP_TOKEN. ` +
      `${error.detail ?? ""}`.trim()
    );
  }

  if (error instanceof TaigaApiError) {
    const hint =
      error.status === 404
        ? " The id/ref may be wrong, or the item may belong to a project you cannot see."
        : error.status === 400
          ? " Taiga validated the payload and rejected it; the field names above say why."
          : error.status === 409 || error.status === 412
            ? " The item changed in Taiga since it was read — fetch it again and retry."
            : "";
    const body = bodyExcerpt(error.body);
    return `Taiga API error ${error.status}: ${error.message}${hint}${body ? ` ${body}` : ""}`;
  }

  if (error instanceof TaigaNetworkError) {
    return `Could not reach Taiga: ${error.message}. Check TAIGA_URL and network access.`;
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * Run a tool body, serialize what it returns, and convert any failure into an in-band
 * error result. Every tool handler is a one-liner over this.
 */
export async function guard(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return toolText(await run());
  } catch (error) {
    return toolError(describeError(error));
  }
}
