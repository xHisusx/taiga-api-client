import { TaigaAuthError, TaigaClient, type FetchLike, type User } from "taiga-api-client";
import type { TaigaMcpConfig } from "./config.js";
import {
  FileTokenStore,
  MemoryTokenStore,
  tokenCacheKey,
  type TokenStore,
} from "./token-store.js";

/** Optional injection points — the tests pass a fake `fetch` and an in-memory token store. */
export interface TaigaSessionDeps {
  fetch?: FetchLike;
  tokenStore?: TokenStore;
}

/**
 * Owns the authenticated {@link TaigaClient} for the lifetime of the server process.
 *
 * Responsibilities:
 * - restore a cached token pair before the first request, so a restart is silent;
 * - log in lazily (on the first tool call, never at startup — a client that spawns the
 *   server must not hang because Taiga is unreachable);
 * - re-login once when a request fails with `401` and a password is configured, which
 *   covers an expired refresh token.
 */
export class TaigaSession {
  readonly client: TaigaClient;

  private readonly store: TokenStore;
  private readonly cacheKey: string;
  private readonly canLogin: boolean;
  private ready: Promise<void> | null = null;
  private cachedUser: User | null = null;

  constructor(
    private readonly config: TaigaMcpConfig,
    deps: TaigaSessionDeps = {},
  ) {
    this.store =
      deps.tokenStore ??
      (config.tokenFile ? new FileTokenStore(config.tokenFile) : new MemoryTokenStore());
    this.cacheKey = tokenCacheKey(config.baseUrl, config.username);
    this.canLogin = Boolean(config.username && config.password);

    this.client = new TaigaClient({
      baseUrl: config.baseUrl,
      token: config.authToken ?? null,
      refreshToken: config.refreshToken ?? null,
      applicationToken: config.applicationToken ?? null,
      timeoutMs: config.timeoutMs,
      userAgent: "taiga-mcp-server",
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      onTokenChange: async (tokens) => {
        // Only bearer sessions are cacheable; Application tokens never change.
        if (!this.config.applicationToken) {
          await this.store.save(
            this.cacheKey,
            tokens ? { token: tokens.token, refreshToken: tokens.refreshToken } : null,
          );
        }
      },
    });

    // Touching `auth` instantiates AuthResource, which registers the refresh function on
    // the AuthManager. Without it, the transparent refresh-on-401 inside HttpClient has
    // nothing to call.
    void this.client.auth;
  }

  /** Whether writes are disabled for this process. */
  get readOnly(): boolean {
    return this.config.readOnly;
  }

  /** Root URL of the Taiga web UI, for building links. */
  get webUrl(): string {
    return this.config.webUrl;
  }

  /** The whole resolved configuration. */
  get settings(): TaigaMcpConfig {
    return this.config;
  }

  /**
   * Run one unit of work against an authenticated client.
   *
   * Transparently recovers from a dead session: on `401`, if a password is configured,
   * it logs in again and replays `fn` exactly once.
   */
  async run<T>(fn: (client: TaigaClient) => Promise<T>): Promise<T> {
    await this.ensureReady();
    try {
      return await fn(this.client);
    } catch (err) {
      if (err instanceof TaigaAuthError && err.status === 401 && this.canLogin) {
        await this.login();
        return await fn(this.client);
      }
      throw err;
    }
  }

  /** The authenticated user, fetched once per process. */
  async currentUser(): Promise<User> {
    if (this.cachedUser) return this.cachedUser;
    const user = await this.run((client) => client.users.me());
    this.cachedUser = user;
    return user;
  }

  /** Numeric ID of the authenticated user — the anchor of every "assigned to me" query. */
  async currentUserId(): Promise<number> {
    return (await this.currentUser()).id;
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= this.prepare();
    try {
      await this.ready;
    } catch (err) {
      // Never cache a failed handshake: the next call should retry.
      this.ready = null;
      throw err;
    }
  }

  private async prepare(): Promise<void> {
    if (this.config.applicationToken) return;

    if (!this.config.authToken) {
      const cached = await this.store.load(this.cacheKey);
      if (cached) {
        await this.client.auth.setTokens({
          token: cached.token,
          refreshToken: cached.refreshToken,
        });
      }
    }

    if (!this.client.auth.getTokens() && this.canLogin) {
      await this.login();
    }
  }

  private async login(): Promise<void> {
    const { username, password } = this.config;
    if (!username || !password) {
      throw new TaigaAuthError(
        401,
        null,
        "Taiga session expired and no password is configured. Set TAIGA_USERNAME and " +
          "TAIGA_PASSWORD, or supply a fresh TAIGA_AUTH_TOKEN / TAIGA_APP_TOKEN.",
      );
    }
    await this.client.auth.login({ username, password });
    this.cachedUser = null;
  }
}
