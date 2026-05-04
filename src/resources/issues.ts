import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type {
  CreateIssuePayload,
  Issue,
  IssueVoter,
  IssueWatcher,
  ListIssuesParams,
  UpdateIssuePayload,
} from "../types/issue.js";
import { BaseResource } from "./base.js";

/**
 * Issues gateway. Available as `client.issues`.
 *
 * Inherits CRUD from {@link BaseResource} and adds voting + watching helpers and
 * the `filters_data` lookup.
 */
export class IssuesResource extends BaseResource<
  Issue,
  CreateIssuePayload,
  UpdateIssuePayload,
  ListIssuesParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/issues" });
  }

  /** `GET /issues/filters_data?project=...` — types, severities and priorities for the UI. */
  async filtersData(params: { project: Id }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/issues/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }

  /** `GET /issues/:id/voters` — users that have upvoted the issue. */
  async voters(id: Id): Promise<IssueVoter[]> {
    const result = await this.http.get<IssueVoter[]>(`/issues/${id}/voters`);
    return result.data;
  }

  /** `POST /issues/:id/upvote` — register your upvote on the issue. */
  async upvote(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/upvote`);
  }

  /** `POST /issues/:id/downvote` — remove your upvote. */
  async downvote(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/downvote`);
  }

  /** `GET /issues/:id/watchers` — users currently watching the issue. */
  async watchers(id: Id): Promise<IssueWatcher[]> {
    const result = await this.http.get<IssueWatcher[]>(`/issues/${id}/watchers`);
    return result.data;
  }

  /** `POST /issues/:id/watch` — subscribe to notifications for this issue. */
  async watch(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/watch`);
  }

  /** `POST /issues/:id/unwatch` — unsubscribe from notifications for this issue. */
  async unwatch(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/unwatch`);
  }
}
