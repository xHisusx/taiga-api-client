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

export class UserStoriesResource extends BaseResource<
  UserStory,
  CreateUserStoryPayload,
  UpdateUserStoryPayload,
  ListUserStoriesParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/userstories" });
  }

  async bulkCreate(payload: BulkCreateUserStoriesPayload): Promise<UserStory[]> {
    const result = await this.http.post<UserStory[]>("/userstories/bulk_create", { body: payload });
    return result.data;
  }

  async bulkUpdateBacklogOrder(payload: BulkUpdateUserStoryOrderPayload): Promise<void> {
    await this.http.post("/userstories/bulk_update_backlog_order", { body: payload });
  }

  async bulkUpdateKanbanOrder(payload: BulkUpdateUserStoryOrderPayload): Promise<void> {
    await this.http.post("/userstories/bulk_update_kanban_order", { body: payload });
  }

  async bulkUpdateSprintOrder(payload: BulkUpdateUserStoryOrderPayload): Promise<void> {
    await this.http.post("/userstories/bulk_update_sprint_order", { body: payload });
  }

  async filtersData(params: { project: number }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/userstories/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }
}
