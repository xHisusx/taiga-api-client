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

export class IssuesResource extends BaseResource<
  Issue,
  CreateIssuePayload,
  UpdateIssuePayload,
  ListIssuesParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/issues" });
  }

  async filtersData(params: { project: Id }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/issues/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }

  async voters(id: Id): Promise<IssueVoter[]> {
    const result = await this.http.get<IssueVoter[]>(`/issues/${id}/voters`);
    return result.data;
  }

  async upvote(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/upvote`);
  }

  async downvote(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/downvote`);
  }

  async watchers(id: Id): Promise<IssueWatcher[]> {
    const result = await this.http.get<IssueWatcher[]>(`/issues/${id}/watchers`);
    return result.data;
  }

  async watch(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/watch`);
  }

  async unwatch(id: Id): Promise<void> {
    await this.http.post(`/issues/${id}/unwatch`);
  }
}
