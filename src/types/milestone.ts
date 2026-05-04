import type { Id, Timestamp } from "./common.js";

export interface Milestone {
  id: Id;
  name: string;
  slug: string;
  project: Id;
  estimated_start: string;
  estimated_finish: string;
  created_date: Timestamp;
  modified_date: Timestamp;
  closed: boolean;
  disponibility: number;
  order: number;
  user_stories: Array<Record<string, unknown>>;
  total_points: number | null;
  closed_points: number | null;
}

export interface CreateMilestonePayload {
  project: Id;
  name: string;
  estimated_start: string;
  estimated_finish: string;
  disponibility?: number;
  slug?: string;
  closed?: boolean;
  order?: number;
}

export type UpdateMilestonePayload = Partial<CreateMilestonePayload>;

export interface ListMilestonesParams {
  project?: Id;
  closed?: boolean;
  [key: string]: unknown;
}

export interface MilestoneStats {
  name: string;
  estimated_start: string;
  estimated_finish: string;
  total_points: number;
  completed_points: Record<string, number>;
  total_userstories: number;
  completed_userstories: number;
  total_tasks: number;
  completed_tasks: number;
  iocaine_doses: number;
  days: Array<{ day: string; name: number; open_points: number; optimal_points: number }>;
}
