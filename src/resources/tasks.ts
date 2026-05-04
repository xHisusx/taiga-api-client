import type { HttpClient } from "../http.js";
import type {
  BulkCreateTasksPayload,
  CreateTaskPayload,
  ListTasksParams,
  Task,
  UpdateTaskPayload,
} from "../types/task.js";
import { BaseResource } from "./base.js";

export class TasksResource extends BaseResource<Task, CreateTaskPayload, UpdateTaskPayload, ListTasksParams> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/tasks" });
  }

  async bulkCreate(payload: BulkCreateTasksPayload): Promise<Task[]> {
    const result = await this.http.post<Task[]>("/tasks/bulk_create", { body: payload });
    return result.data;
  }

  async filtersData(params: { project: number }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/tasks/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }
}
