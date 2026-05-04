import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type {
  CreateProjectPayload,
  ListProjectsParams,
  Project,
  ProjectModulesConfig,
  ProjectStats,
  UpdateProjectPayload,
} from "../types/project.js";
import { BaseResource } from "./base.js";

export class ProjectsResource extends BaseResource<
  Project,
  CreateProjectPayload,
  UpdateProjectPayload,
  ListProjectsParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/projects" });
  }

  async getBySlug(slug: string): Promise<Project> {
    const result = await this.http.get<Project>("/projects/by_slug", { query: { slug } });
    return result.data;
  }

  async stats(id: Id): Promise<ProjectStats> {
    const result = await this.http.get<ProjectStats>(`/projects/${id}/stats`);
    return result.data;
  }

  async modulesConfig(id: Id): Promise<ProjectModulesConfig> {
    const result = await this.http.get<ProjectModulesConfig>(`/projects/${id}/modules`);
    return result.data;
  }

  async setModulesConfig(id: Id, config: ProjectModulesConfig): Promise<void> {
    await this.http.patch(`/projects/${id}/modules`, { body: config });
  }
}
