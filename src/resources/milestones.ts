import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type {
  CreateMilestonePayload,
  ListMilestonesParams,
  Milestone,
  MilestoneStats,
  UpdateMilestonePayload,
} from "../types/milestone.js";
import { BaseResource } from "./base.js";

/**
 * Milestones (sprints) gateway. Available as `client.milestones`.
 *
 * Inherits CRUD from {@link BaseResource} and adds the burndown stats endpoint.
 */
export class MilestonesResource extends BaseResource<
  Milestone,
  CreateMilestonePayload,
  UpdateMilestonePayload,
  ListMilestonesParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/milestones" });
  }

  /** `GET /milestones/:id/stats` — burndown data and progress points. */
  async stats(id: Id): Promise<MilestoneStats> {
    const result = await this.http.get<MilestoneStats>(`/milestones/${id}/stats`);
    return result.data;
  }
}
