import type { AuthTokens, TokenChangeHandler } from "./types/auth.js";

/**
 * Active authentication mode.
 *
 * - `"bearer"` — using a regular bearer token (with refresh capability).
 * - `"application"` — using a long-lived Application token (no refresh flow).
 * - `"none"` — anonymous (no `Authorization` header sent).
 */
export type AuthMode = "bearer" | "application" | "none";

/**
 * Constructor options for {@link AuthManager}. Normally you should not instantiate
 * `AuthManager` directly — use {@link TaigaClient} instead.
 */
export interface AuthManagerOptions {
  /** Initial bearer token (e.g. restored from persistence). */
  token?: string | null;
  /** Initial refresh token paired with `token`. */
  refreshToken?: string | null;
  /** Long-lived Application token, mutually exclusive with bearer. */
  applicationToken?: string | null;
  /** Callback fired after every token change (login / refresh / clear). */
  onTokenChange?: TokenChangeHandler;
}

/**
 * Owns the in-memory token state, generates the `Authorization` header for outgoing
 * requests, and orchestrates token refresh with deduplication.
 *
 * You usually interact with `AuthManager` indirectly via `client.auth` (an
 * {@link AuthResource}). It is exported for advanced cases where you need to inject
 * tokens or integrate with a custom auth flow.
 */
export class AuthManager {
  private token: string | null;
  private refreshToken: string | null;
  private readonly applicationToken: string | null;
  private onTokenChange?: TokenChangeHandler;
  private inflightRefresh: Promise<string> | null = null;
  private refreshFn: ((refresh: string) => Promise<{ token: string; refresh: string }>) | null = null;

  constructor(options: AuthManagerOptions = {}) {
    this.token = options.token ?? null;
    this.refreshToken = options.refreshToken ?? null;
    this.applicationToken = options.applicationToken ?? null;
    this.onTokenChange = options.onTokenChange;
  }

  /**
   * Wires up the refresh implementation. Called internally by {@link AuthResource} so it
   * can hit `POST /auth/refresh` through the configured {@link HttpClient}. End users
   * normally do not call this.
   */
  setRefreshFn(fn: (refresh: string) => Promise<{ token: string; refresh: string }>): void {
    this.refreshFn = fn;
  }

  /** Replace the {@link TokenChangeHandler} at runtime. */
  setOnTokenChange(handler: TokenChangeHandler | undefined): void {
    this.onTokenChange = handler;
  }

  /** Returns the currently active authentication mode. See {@link AuthMode}. */
  getMode(): AuthMode {
    if (this.applicationToken) return "application";
    if (this.token) return "bearer";
    return "none";
  }

  /**
   * Builds the value of the `Authorization` header for the next request.
   * Returns `null` when no credentials are configured (the header is omitted).
   */
  getAuthHeader(): string | null {
    if (this.applicationToken) return `Application ${this.applicationToken}`;
    if (this.token) return `Bearer ${this.token}`;
    return null;
  }

  /** Returns the current bearer + refresh pair, or `null` if not logged in. */
  getTokens(): AuthTokens | null {
    if (!this.token) return null;
    return { token: this.token, refreshToken: this.refreshToken };
  }

  /** Whether a refresh token is currently available. */
  hasRefreshToken(): boolean {
    return this.refreshToken !== null && this.refreshToken !== "";
  }

  /**
   * Replace the in-memory token pair. Pass `null` to clear (equivalent to a logout).
   * Triggers the {@link TokenChangeHandler} callback and awaits its returned Promise.
   */
  async setTokens(tokens: AuthTokens | null): Promise<void> {
    if (tokens === null) {
      this.token = null;
      this.refreshToken = null;
    } else {
      this.token = tokens.token;
      this.refreshToken = tokens.refreshToken;
    }
    if (this.onTokenChange) {
      await this.onTokenChange(this.getTokens());
    }
  }

  /** Clear the in-memory token pair and trigger `onTokenChange(null)`. */
  async clear(): Promise<void> {
    await this.setTokens(null);
  }

  /**
   * Refresh the bearer token using the stored refresh token.
   *
   * Concurrent calls share the same in-flight Promise — `/auth/refresh` is invoked
   * exactly once even if many requests trigger refresh simultaneously.
   *
   * @returns The freshly obtained bearer token.
   * @throws If no refresh token is available, or if the refresh function is not configured.
   */
  async refresh(): Promise<string> {
    if (!this.refreshFn) {
      throw new Error("AuthManager: refresh function is not configured");
    }
    if (!this.refreshToken) {
      throw new Error("AuthManager: no refresh token available");
    }

    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    const refreshFn = this.refreshFn;
    const currentRefresh = this.refreshToken;

    this.inflightRefresh = (async () => {
      try {
        const result = await refreshFn(currentRefresh);
        await this.setTokens({ token: result.token, refreshToken: result.refresh });
        return result.token;
      } finally {
        this.inflightRefresh = null;
      }
    })();

    return this.inflightRefresh;
  }
}
