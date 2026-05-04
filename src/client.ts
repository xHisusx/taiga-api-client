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

export interface TaigaClientOptions {
  baseUrl: string;
  token?: string | null;
  refreshToken?: string | null;
  applicationToken?: string | null;
  fetch?: FetchLike;
  timeoutMs?: number;
  userAgent?: string;
  acceptLanguage?: string;
  autoRefresh?: boolean;
  apiPrefix?: string;
  onTokenChange?: TokenChangeHandler;
}

export class TaigaClient {
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

  get auth(): AuthResource {
    if (!this._auth) this._auth = new AuthResource({ http: this.http, auth: this.authManager });
    return this._auth;
  }

  get users(): UsersResource {
    if (!this._users) this._users = new UsersResource({ http: this.http });
    return this._users;
  }

  get projects(): ProjectsResource {
    if (!this._projects) this._projects = new ProjectsResource({ http: this.http });
    return this._projects;
  }

  get memberships(): MembershipsResource {
    if (!this._memberships) this._memberships = new MembershipsResource({ http: this.http });
    return this._memberships;
  }

  get userStories(): UserStoriesResource {
    if (!this._userStories) this._userStories = new UserStoriesResource({ http: this.http });
    return this._userStories;
  }

  get tasks(): TasksResource {
    if (!this._tasks) this._tasks = new TasksResource({ http: this.http });
    return this._tasks;
  }

  get issues(): IssuesResource {
    if (!this._issues) this._issues = new IssuesResource({ http: this.http });
    return this._issues;
  }

  get milestones(): MilestonesResource {
    if (!this._milestones) this._milestones = new MilestonesResource({ http: this.http });
    return this._milestones;
  }
}
