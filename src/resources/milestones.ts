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

export class MilestonesResource extends BaseResource<
  Milestone,
  CreateMilestonePayload,
  UpdateMilestonePayload,
  ListMilestonesParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/milestones" });
  }

  async stats(id: Id): Promise<MilestoneStats> {
    const result = await this.http.get<MilestoneStats>(`/milestones/${id}/stats`);
    return result.data;
  }
}
