import type { AuthManager } from "./auth.js";
import {
  TaigaApiError,
  TaigaAuthError,
  TaigaNetworkError,
  TaigaRateLimitError,
} from "./errors.js";
import { parsePaginationHeaders } from "./pagination.js";
import type { PaginationMeta } from "./types/common.js";

/** A `fetch`-compatible function. Use it to inject a custom transport. */
export type FetchLike = typeof fetch;

/** Constructor options for {@link HttpClient}. Normally built by {@link TaigaClient}. */
export interface HttpClientOptions {
  baseUrl: string;
  auth: AuthManager;
  fetch?: FetchLike;
  timeoutMs?: number;
  userAgent?: string;
  acceptLanguage?: string;
  autoRefresh?: boolean;
  apiPrefix?: string;
}

/** A primitive that can be safely serialized into a URL query string parameter. */
export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;
/** Record of query string parameters. Arrays are joined with commas. `null` / `undefined` are skipped. */
export type Query = Record<string, QueryValue>;

/** Per-request options for {@link HttpClient.request} and shortcut methods. */
export interface RequestOptions {
  /** Query string parameters. Arrays are joined with commas. `null` / `undefined` are skipped. */
  query?: Query;
  /** Request body. Serialized as JSON for non-GET / non-HEAD methods. */
  body?: unknown;
  /** Extra request headers (merged on top of the defaults). */
  headers?: Record<string, string>;
  /** External `AbortSignal` to cancel the request before the timeout expires. */
  signal?: AbortSignal;
  /** Send `x-disable-pagination: True` to ask Taiga to return the entire collection. */
  disablePagination?: boolean;
  /** Do not attach an `Authorization` header (used for `/auth` and `/auth/refresh`). */
  skipAuth?: boolean;
}

/** Result of a successful HTTP request. */
export interface HttpResponse<T> {
  /** The parsed response body. `undefined` for `204 No Content`. */
  data: T;
  /** HTTP status code. */
  status: number;
  /** Parsed `x-paginated*` headers, or `null` when the response is not paginated. */
  pagination: PaginationMeta | null;
  /** Raw response headers — useful for advanced use cases. */
  headers: Headers;
}

/**
 * Low-level HTTP transport. Owns the `fetch` call, attaches the `Authorization` header,
 * parses pagination metadata and translates non-OK responses into typed errors.
 *
 * Use it directly via {@link TaigaClient.http} for endpoints that are not yet wrapped
 * as resources.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly auth: AuthManager;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly userAgent?: string;
  private readonly acceptLanguage?: string;
  private readonly autoRefresh: boolean;
  private readonly apiPrefix: string;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.userAgent = options.userAgent;
    this.acceptLanguage = options.acceptLanguage;
    this.autoRefresh = options.autoRefresh ?? true;
    this.apiPrefix = options.apiPrefix ?? "/api/v1";
  }

  /**
   * Perform an arbitrary HTTP request. Handles auth header attachment, optional
   * automatic refresh on 401, body serialization and error translation.
   *
   * @param method HTTP method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, ...).
   * @param path Path relative to `baseUrl`. The `apiPrefix` is added automatically if missing.
   * @param options See {@link RequestOptions}.
   * @returns The parsed response. See {@link HttpResponse}.
   * @throws {TaigaAuthError} On 401 / 403.
   * @throws {TaigaRateLimitError} On 429.
   * @throws {TaigaApiError} On any other 4xx / 5xx.
   * @throws {TaigaNetworkError} On network failure, abort or timeout.
   */
  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = this.buildUrl(path, options.query);
    const init = this.buildRequestInit(method, options, false);

    const response = await this.executeWithTimeout(url, init, options.signal);

    if (
      response.status === 401 &&
      this.autoRefresh &&
      !options.skipAuth &&
      this.auth.hasRefreshToken() &&
      this.auth.getMode() === "bearer"
    ) {
      try {
        await this.auth.refresh();
      } catch {
        return this.handleResponse<T>(response);
      }
      const retryInit = this.buildRequestInit(method, options, true);
      const retried = await this.executeWithTimeout(url, retryInit, options.signal);
      return this.handleResponse<T>(retried);
    }

    return this.handleResponse<T>(response);
  }

  private buildUrl(path: string, query?: Query): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const fullPath = cleanPath.startsWith(this.apiPrefix) ? cleanPath : `${this.apiPrefix}${cleanPath}`;
    const url = new URL(this.baseUrl + fullPath);
    if (query) appendQuery(url, query);
    return url.toString();
  }

  private buildRequestInit(method: string, options: RequestOptions, isRetry: boolean): RequestInit {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.headers ?? {}),
    };

    if (this.userAgent) headers["User-Agent"] = this.userAgent;
    if (this.acceptLanguage) headers["Accept-Language"] = this.acceptLanguage;
    if (options.disablePagination) headers["x-disable-pagination"] = "True";

    if (!options.skipAuth) {
      const authHeader = this.auth.getAuthHeader();
      if (authHeader) headers["Authorization"] = authHeader;
    }

    let body: string | undefined;
    if (options.body !== undefined && method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    void isRetry;
    return { method, headers, body };
  }

  private async executeWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const onAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new TaigaNetworkError(`Request aborted: ${err.message}`, err);
      }
      throw new TaigaNetworkError(
        err instanceof Error ? err.message : "Network error",
        err,
      );
    } finally {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    }
  }

  private async handleResponse<T>(response: Response): Promise<HttpResponse<T>> {
    const pagination = parsePaginationHeaders(response.headers);

    if (response.status === 204) {
      return { data: undefined as T, status: 204, pagination, headers: response.headers };
    }

    let data: unknown = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } else if (response.status !== 204) {
      data = await response.text();
    }

    if (response.ok) {
      return { data: data as T, status: response.status, pagination, headers: response.headers };
    }

    if (response.status === 401 || response.status === 403) {
      throw new TaigaAuthError(response.status, data);
    }
    if (response.status === 429) {
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfter = retryAfterRaw !== null ? Number(retryAfterRaw) : undefined;
      throw new TaigaRateLimitError(response.status, data, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
    throw new TaigaApiError(response.status, data);
  }

  /** Shortcut for {@link HttpClient.request} with method `GET`. */
  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>("GET", path, options);
  }
  /** Shortcut for {@link HttpClient.request} with method `POST`. */
  post<T>(path: string, options?: RequestOptions) {
    return this.request<T>("POST", path, options);
  }
  /** Shortcut for {@link HttpClient.request} with method `PUT`. */
  put<T>(path: string, options?: RequestOptions) {
    return this.request<T>("PUT", path, options);
  }
  /** Shortcut for {@link HttpClient.request} with method `PATCH`. */
  patch<T>(path: string, options?: RequestOptions) {
    return this.request<T>("PATCH", path, options);
  }
  /** Shortcut for {@link HttpClient.request} with method `DELETE`. */
  delete<T = void>(path: string, options?: RequestOptions) {
    return this.request<T>("DELETE", path, options);
  }
}

function appendQuery(url: URL, query: Query): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.map(String).join(","));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}
