/**
 * Abstract base class for every error thrown by `taiga-api-client`.
 *
 * Catch this when you want a single fallback handler for any client-originated error.
 *
 * @example
 * ```ts
 * try { await client.projects.get(1); }
 * catch (e) { if (e instanceof TaigaError) console.error(e.message); }
 * ```
 */
export class TaigaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaigaError";
  }
}

/**
 * Thrown for any unsuccessful HTTP response from Taiga (4xx / 5xx) that does not have
 * a more specific subclass.
 *
 * Subclasses cover well-known cases:
 * - `401` / `403` → {@link TaigaAuthError}
 * - `429`         → {@link TaigaRateLimitError}
 */
export class TaigaApiError extends TaigaError {
  /** HTTP status code (e.g. 400, 404, 500). */
  readonly status: number;
  /** Machine-readable error code from Taiga's `_error_type`, when present. */
  readonly code?: string;
  /** Human-readable error message from Taiga's `_error_message`, when present. */
  readonly detail?: string;
  /** Raw parsed response body (usually JSON object or string). */
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    const parsed = parseErrorBody(body);
    super(message ?? parsed.message ?? `Taiga API error ${status}`);
    this.name = "TaigaApiError";
    this.status = status;
    this.code = parsed.code;
    this.detail = parsed.detail;
    this.body = body;
  }
}

/**
 * Thrown on `401 Unauthorized` and `403 Forbidden` responses, including the case
 * where automatic refresh failed (`refresh failed, re-login required`).
 *
 * Inherits all fields of {@link TaigaApiError}.
 */
export class TaigaAuthError extends TaigaApiError {
  constructor(status: number, body: unknown, message?: string) {
    super(status, body, message);
    this.name = "TaigaAuthError";
  }
}

/**
 * Thrown on `429 Too Many Requests`. Inspect `retryAfter` to know how long to wait.
 *
 * @example
 * ```ts
 * try { await client.projects.list(); }
 * catch (e) {
 *   if (e instanceof TaigaRateLimitError) {
 *     await sleep((e.retryAfter ?? 1) * 1000);
 *   }
 * }
 * ```
 */
export class TaigaRateLimitError extends TaigaApiError {
  /** Seconds to wait before retrying, parsed from the `Retry-After` header. */
  readonly retryAfter?: number;

  constructor(status: number, body: unknown, retryAfter: number | undefined, message?: string) {
    super(status, body, message);
    this.name = "TaigaRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when the request never reached an HTTP response — DNS failure, TCP reset,
 * `AbortController` timeout, or any thrown error from the underlying `fetch`.
 *
 * Inspect `cause` for the underlying error (typically a `TypeError` or `AbortError`).
 */
export class TaigaNetworkError extends TaigaError {
  /** The underlying error from `fetch` / `AbortController`. */
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TaigaNetworkError";
    this.cause = cause;
  }
}

function parseErrorBody(body: unknown): { message?: string; code?: string; detail?: string } {
  if (!body || typeof body !== "object") return {};
  const obj = body as Record<string, unknown>;
  const detail = typeof obj["_error_message"] === "string" ? (obj["_error_message"] as string) : undefined;
  const code = typeof obj["_error_type"] === "string" ? (obj["_error_type"] as string) : undefined;
  return { message: detail, code, detail };
}
