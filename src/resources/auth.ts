import type { AuthManager } from "../auth.js";
import type { HttpClient } from "../http.js";
import type {
  AuthResponse,
  AuthTokens,
  AuthUser,
  LoginPayload,
  RefreshResponse,
  TokenChangeHandler,
} from "../types/auth.js";

/** Constructor options for {@link AuthResource}. */
export interface AuthResourceOptions {
  http: HttpClient;
  auth: AuthManager;
}

/**
 * Authentication gateway. Available as `client.auth` on a {@link TaigaClient}.
 *
 * Wraps `POST /auth` (login) and `POST /auth/refresh`. The refresh function is wired
 * into the underlying {@link AuthManager} so {@link HttpClient} can refresh
 * automatically on `401`.
 */
export class AuthResource {
  private readonly http: HttpClient;
  private readonly auth: AuthManager;
  private currentUser: AuthUser | null = null;

  constructor(options: AuthResourceOptions) {
    this.http = options.http;
    this.auth = options.auth;

    this.auth.setRefreshFn(async (refresh) => {
      const result = await this.http.post<RefreshResponse>("/auth/refresh", {
        body: { refresh },
        skipAuth: true,
      });
      return { token: result.data.auth_token, refresh: result.data.refresh };
    });
  }

  /**
   * `POST /auth` (`type: "normal"`) — log in with username / email and password.
   *
   * On success, stores the new tokens via {@link AuthManager.setTokens} and triggers the
   * {@link TokenChangeHandler} callback. Subsequent calls automatically include the
   * `Authorization: Bearer ...` header.
   *
   * @param payload Credentials. The `username` field accepts both username and email.
   * @returns The full auth response (user profile + tokens).
   */
  async login(payload: Omit<LoginPayload, "type">): Promise<AuthResponse> {
    const result = await this.http.post<AuthResponse>("/auth", {
      body: { type: "normal", ...payload },
      skipAuth: true,
    });
    const data = result.data;
    await this.auth.setTokens({ token: data.auth_token, refreshToken: data.refresh });
    this.currentUser = data;
    return data;
  }

  /**
   * Force a refresh of the bearer token. Normally called automatically on `401`,
   * so end users rarely need this directly. Concurrent calls share a single in-flight
   * `/auth/refresh` request.
   *
   * @returns The freshly issued bearer token.
   */
  async refresh(): Promise<string> {
    return this.auth.refresh();
  }

  /**
   * Local logout: clears the in-memory token pair and forgets the cached user profile.
   * Triggers `onTokenChange(null)`. Does **not** hit the Taiga server (Taiga has no
   * server-side logout endpoint for token-based auth).
   */
  async logout(): Promise<void> {
    this.currentUser = null;
    await this.auth.clear();
  }

  /**
   * Replace the in-memory token pair manually. Useful when you have tokens from another
   * source (a database, a background job, an SSO callback). Triggers
   * `onTokenChange(tokens)`.
   */
  setTokens(tokens: AuthTokens | null): Promise<void> {
    return this.auth.setTokens(tokens);
  }

  /** Replace the persistence callback at runtime. Pass `undefined` to detach it. */
  onTokenChange(handler: TokenChangeHandler | undefined): void {
    this.auth.setOnTokenChange(handler);
  }

  /** Currently held bearer + refresh tokens, or `null` if not logged in. */
  getTokens(): AuthTokens | null {
    return this.auth.getTokens();
  }

  /**
   * Cached user profile from the last successful {@link AuthResource.login} call.
   * Returns `null` if no login happened in this session, even if a token was passed
   * to the {@link TaigaClient} constructor.
   */
  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }
}
