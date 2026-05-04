export class TaigaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaigaError";
  }
}

export class TaigaApiError extends TaigaError {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;
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

export class TaigaAuthError extends TaigaApiError {
  constructor(status: number, body: unknown, message?: string) {
    super(status, body, message);
    this.name = "TaigaAuthError";
  }
}

export class TaigaRateLimitError extends TaigaApiError {
  readonly retryAfter?: number;

  constructor(status: number, body: unknown, retryAfter: number | undefined, message?: string) {
    super(status, body, message);
    this.name = "TaigaRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class TaigaNetworkError extends TaigaError {
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
