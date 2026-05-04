import type { HttpClient } from "../http.js";
import type {
  BulkCreateTasksPayload,
  CreateTaskPayload,
  ListTasksParams,
  Task,
  UpdateTaskPayload,
} from "../types/task.js";
import { BaseResource } from "./base.js";

/**
 * Tasks gateway. Available as `client.tasks`.
 *
 * Inherits CRUD from {@link BaseResource} and adds bulk-create + the `filters_data` helper.
 * Tasks can optionally be linked to a parent user story via {@link CreateTaskPayload.user_story}.
 */
export class TasksResource extends BaseResource<Task, CreateTaskPayload, UpdateTaskPayload, ListTasksParams> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/tasks" });
  }

  /** `POST /tasks/bulk_create` — create multiple tasks from a newline-separated string. */
  async bulkCreate(payload: BulkCreateTasksPayload): Promise<Task[]> {
    const result = await this.http.post<Task[]>("/tasks/bulk_create", { body: payload });
    return result.data;
  }

  /** `GET /tasks/filters_data?project=...` — available filter values for the UI. */
  async filtersData(params: { project: number }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/tasks/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }
}
