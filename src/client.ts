import { AuthManager } from "./auth.js";
import { HttpClient, type FetchLike } from "./http.js";
import { AuthResource } from "./resources/auth.js";
import { IssuesResource } from "./resources/issues.js";
import { MembershipsResource } from "./resources/memberships.js";
import { MilestonesResource } from "./resources/milestones.js";
import { ProjectsResource } from "./resources/projects.js";
import { TasksResource } from "./resources/tasks.js";
import { UserStoriesResource } from "./resources/userstories.js";
import { UsersResource } from "./resources/users.js";
import type { TokenChangeHandler } from "./types/auth.js";

/**
 * Configuration options for {@link TaigaClient}.
 *
 * Only `baseUrl` is required — every other field is optional and has a sensible default.
 */
export interface TaigaClientOptions {
  /**
   * Root URL of your Taiga instance (without `/api/v1` — it is appended automatically).
   *
   * - For Taiga Cloud (SaaS): `https://api.taiga.io`
   * - For self-hosted: the root of your instance, e.g. `http://localhost:9000`
   *
   * @example "https://api.taiga.io"
   */
  baseUrl: string;

  /**
   * Bearer access token. Pass it to restore an existing session without calling {@link AuthResource.login}.
   *
   * Mutually exclusive with `applicationToken`.
   */
  token?: string | null;

  /**
   * Refresh token paired with `token`. Required for {@link TaigaClientOptions.autoRefresh} to work.
   */
  refreshToken?: string | null;

  /**
   * A long-lived Application token (`Authorization: Application <token>`). Used by integrations and bots.
   *
   * Mutually exclusive with `token` / `refreshToken`. There is no refresh flow for Application tokens.
   */
  applicationToken?: string | null;

  /**
   * Custom `fetch` implementation. Useful for proxies, request signing, or test mocking
   * (for example, an MSW handler).
   *
   * @default globalThis.fetch
   */
  fetch?: FetchLike;

  /**
   * Per-request timeout in milliseconds. The request is aborted via {@link AbortController}
   * once exceeded, raising a `TaigaNetworkError`.
   *
   * @default 30000
   */
  timeoutMs?: number;

  /**
   * Value for the `User-Agent` header on every request.
   */
  userAgent?: string;

  /**
   * Value for the `Accept-Language` header. Controls i18n of localized strings in responses.
   *
   * @example "en"
   */
  acceptLanguage?: string;

  /**
   * Whether to transparently refresh the token on `401` and retry the original request once.
   * Concurrent 401s are deduplicated — `/auth/refresh` is invoked exactly once.
   *
   * @default true
   */
  autoRefresh?: boolean;

  /**
   * API path prefix prepended to every resource path. Change it only if your self-hosted
   * Taiga is mounted under a non-default location.
   *
   * @default "/api/v1"
   */
  apiPrefix?: string;

  /**
   * Callback invoked whenever the token pair changes — after `login`, after a successful
   * automatic refresh, and after `logout` (with `null`).
   *
   * Use it to persist tokens to a database / file / Redis. The returned Promise is awaited
   * before the original request is retried, so persistence completes before any subsequent call.
   *
   * @example
   * ```ts
   * onTokenChange: async (tokens) => {
   *   if (tokens) await db.saveTokens(tokens);
   *   else await db.clearTokens();
   * }
   * ```
   */
  onTokenChange?: TokenChangeHandler;
}

/**
 * Top-level facade for the Taiga REST API.
 *
 * Holds a single {@link HttpClient} and {@link AuthManager} internally and exposes
 * resource gateways as lazily-initialized getters: `auth`, `users`, `projects`,
 * `memberships`, `userStories`, `tasks`, `issues`, `milestones`.
 *
 * @example Simple usage
 * ```ts
 * import { TaigaClient } from "taiga-api-client";
 *
 * const client = new TaigaClient({ baseUrl: "https://api.taiga.io" });
 * await client.auth.login({ username: "alice", password: "secret" });
 * const projects = await client.projects.list();
 * ```
 *
 * @example Restoring a session and persisting refreshed tokens
 * ```ts
 * const client = new TaigaClient({
 *   baseUrl: "https://api.taiga.io",
 *   token: await db.loadToken(),
 *   refreshToken: await db.loadRefreshToken(),
 *   onTokenChange: (tokens) => db.saveTokens(tokens),
 * });
 * ```
 */
export class TaigaClient {
  /** Low-level HTTP client. Use it directly for endpoints not yet wrapped as resources. */
  readonly http: HttpClient;

  private readonly authManager: AuthManager;

  private _auth?: AuthResource;
  private _users?: UsersResource;
  private _projects?: ProjectsResource;
  private _memberships?: MembershipsResource;
  private _userStories?: UserStoriesResource;
  private _tasks?: TasksResource;
  private _issues?: IssuesResource;
  private _milestones?: MilestonesResource;

  /**
   * Construct a new client. See {@link TaigaClientOptions} for every available option.
   * `baseUrl` is the only required option.
   */
  constructor(options: TaigaClientOptions) {
    this.authManager = new AuthManager({
      token: options.token ?? null,
      refreshToken: options.refreshToken ?? null,
      applicationToken: options.applicationToken ?? null,
      onTokenChange: options.onTokenChange,
    });

    this.http = new HttpClient({
      baseUrl: options.baseUrl,
      auth: this.authManager,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent,
      acceptLanguage: options.acceptLanguage,
      autoRefresh: options.autoRefresh,
      apiPrefix: options.apiPrefix,
    });
  }

  /** Authentication: login, refresh, logout, token management. */
  get auth(): AuthResource {
    if (!this._auth) this._auth = new AuthResource({ http: this.http, auth: this.authManager });
    return this._auth;
  }

  /** Users: profile, list, update, change password, stats. */
  get users(): UsersResource {
    if (!this._users) this._users = new UsersResource({ http: this.http });
    return this._users;
  }

  /** Projects: CRUD, lookup by slug, stats, modules config. */
  get projects(): ProjectsResource {
    if (!this._projects) this._projects = new ProjectsResource({ http: this.http });
    return this._projects;
  }

  /** Project memberships: CRUD, bulk invite, resend invitation. */
  get memberships(): MembershipsResource {
    if (!this._memberships) this._memberships = new MembershipsResource({ http: this.http });
    return this._memberships;
  }

  /** User stories: CRUD, bulk_create, bulk_update_order for backlog/kanban/sprint, filters_data. */
  get userStories(): UserStoriesResource {
    if (!this._userStories) this._userStories = new UserStoriesResource({ http: this.http });
    return this._userStories;
  }

  /** Tasks: CRUD, bulk_create, filters_data. */
  get tasks(): TasksResource {
    if (!this._tasks) this._tasks = new TasksResource({ http: this.http });
    return this._tasks;
  }

  /** Issues: CRUD, voters / watchers, upvote / downvote / watch / unwatch, filters_data. */
  get issues(): IssuesResource {
    if (!this._issues) this._issues = new IssuesResource({ http: this.http });
    return this._issues;
  }

  /** Milestones (sprints): CRUD plus burndown stats. */
  get milestones(): MilestonesResource {
    if (!this._milestones) this._milestones = new MilestonesResource({ http: this.http });
    return this._milestones;
  }
}
