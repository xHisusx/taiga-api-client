export { TaigaClient } from "./client.js";
export type { TaigaClientOptions } from "./client.js";

export { HttpClient } from "./http.js";
export type {
  FetchLike,
  HttpClientOptions,
  HttpResponse,
  Query,
  QueryValue,
  RequestOptions,
} from "./http.js";

export { AuthManager } from "./auth.js";
export type { AuthManagerOptions, AuthMode } from "./auth.js";

export {
  TaigaError,
  TaigaApiError,
  TaigaAuthError,
  TaigaRateLimitError,
  TaigaNetworkError,
} from "./errors.js";

export { parsePaginationHeaders, paginate, extractPageFromUrl } from "./pagination.js";

export { AuthResource } from "./resources/auth.js";
export { BaseResource } from "./resources/base.js";
export { IssuesResource } from "./resources/issues.js";
export { MembershipsResource } from "./resources/memberships.js";
export { MilestonesResource } from "./resources/milestones.js";
export { ProjectsResource } from "./resources/projects.js";
export { TasksResource } from "./resources/tasks.js";
export { UserStoriesResource } from "./resources/userstories.js";
export { UsersResource } from "./resources/users.js";

export type * from "./types/auth.js";
export type * from "./types/common.js";
export type * from "./types/issue.js";
export type * from "./types/membership.js";
export type * from "./types/milestone.js";
export type * from "./types/project.js";
export type * from "./types/task.js";
export type * from "./types/user.js";
export type * from "./types/userstory.js";
