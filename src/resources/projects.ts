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

/**
 * Projects gateway. Available as `client.projects`.
 *
 * Inherits full CRUD from {@link BaseResource} and adds project-specific helpers.
 */
export class ProjectsResource extends BaseResource<
  Project,
  CreateProjectPayload,
  UpdateProjectPayload,
  ListProjectsParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/projects" });
  }

  /** `GET /projects/by_slug?slug=...` — fetch a project by its slug instead of numeric id. */
  async getBySlug(slug: string): Promise<Project> {
    const result = await this.http.get<Project>("/projects/by_slug", { query: { slug } });
    return result.data;
  }

  /** `GET /projects/:id/stats` — points, milestones and progress statistics. */
  async stats(id: Id): Promise<ProjectStats> {
    const result = await this.http.get<ProjectStats>(`/projects/${id}/stats`);
    return result.data;
  }

  /** `GET /projects/:id/modules` — third-party integration configuration (GitHub, GitLab, ...). */
  async modulesConfig(id: Id): Promise<ProjectModulesConfig> {
    const result = await this.http.get<ProjectModulesConfig>(`/projects/${id}/modules`);
    return result.data;
  }

  /** `PATCH /projects/:id/modules` — partially update integration configuration. */
  async setModulesConfig(id: Id, config: ProjectModulesConfig): Promise<void> {
    await this.http.patch(`/projects/${id}/modules`, { body: config });
  }
}
