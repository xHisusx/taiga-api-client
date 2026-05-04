import type { HttpClient } from "../http.js";
import type {
  BulkCreateUserStoriesPayload,
  BulkUpdateUserStoryOrderPayload,
  CreateUserStoryPayload,
  ListUserStoriesParams,
  UpdateUserStoryPayload,
  UserStory,
} from "../types/userstory.js";
import { BaseResource } from "./base.js";

/**
 * User stories gateway. Available as `client.userStories`.
 *
 * Inherits CRUD from {@link BaseResource} and adds bulk-create, board reordering and
 * the `filters_data` helper.
 */
export class UserStoriesResource extends BaseResource<
  UserStory,
  CreateUserStoryPayload,
  UpdateUserStoryPayload,
  ListUserStoriesParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/userstories" });
  }

  /**
   * `POST /userstories/bulk_create` — create several stories at once from a multi-line
   * string. Each line becomes a separate story (the same way the Taiga UI works).
   *
   * @example
   * ```ts
   * await client.userStories.bulkCreate({
   *   project_id: 1,
   *   bulk_stories: "First\nSecond\nThird",
   * });
   * ```
   */
  async bulkCreate(payload: BulkCreateUserStoriesPayload): Promise<UserStory[]> {
    const result = await this.http.post<UserStory[]>("/userstories/bulk_create", { body: payload });
    return result.data;
  }

  /** `POST /userstories/bulk_update_backlog_order` — reorder stories in the project backlog. */
  async bulkUpdateBacklogOrder(payload: BulkUpdateUserStoryOrderPayload): Promise<void> {
    await this.http.post("/userstories/bulk_update_backlog_order", { body: payload });
  }

  /** `POST /userstories/bulk_update_kanban_order` — reorder stories on the kanban board. */
  async bulkUpdateKanbanOrder(payload: BulkUpdateUserStoryOrderPayload): Promise<void> {
    await this.http.post("/userstories/bulk_update_kanban_order", { body: payload });
  }

  /** `POST /userstories/bulk_update_sprint_order` — reorder stories within a sprint. */
  async bulkUpdateSprintOrder(payload: BulkUpdateUserStoryOrderPayload): Promise<void> {
    await this.http.post("/userstories/bulk_update_sprint_order", { body: payload });
  }

  /**
   * `GET /userstories/filters_data?project=...` — available filter values for the UI:
   * statuses, tags, assignees, etc.
   */
  async filtersData(params: { project: number }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/userstories/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }
}
