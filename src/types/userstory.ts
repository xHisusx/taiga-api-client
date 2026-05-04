import type { Id, Timestamp } from "./common.js";

export interface UserStory {
  id: Id;
  ref: number;
  project: Id;
  is_closed: boolean;
  created_date: Timestamp;
  modified_date: Timestamp;
  finish_date: Timestamp | null;
  subject: string;
  client_requirement: boolean;
  team_requirement: boolean;
  generated_from_issue: Id | null;
  generated_from_task: Id | null;
  from_task_ref: string | null;
  external_reference: string[] | null;
  tribe_gig: string | null;
  version: number;
  watchers: Id[];
  is_blocked: boolean;
  blocked_note: string;
  description: string;
  tags: Array<[string, string | null]> | null;
  milestone: Id | null;
  milestone_slug: string | null;
  milestone_name: string | null;
  total_points: number | null;
  comment: string;
  origin_issue: Id | null;
  origin_task: Id | null;
  owner: Id;
  assigned_to: Id | null;
  assigned_users: Id[];
  points: Record<string, Id>;
  backlog_order: number;
  sprint_order: number;
  kanban_order: number;
  status: Id;
  due_date: string | null;
  due_date_reason: string;
  due_date_status: string;
  swimlane: Id | null;
}

export interface CreateUserStoryPayload {
  project: Id;
  subject: string;
  description?: string;
  status?: Id;
  milestone?: Id;
  assigned_to?: Id;
  watchers?: Id[];
  is_blocked?: boolean;
  blocked_note?: string;
  tags?: Array<[string, string | null]>;
  swimlane?: Id;
}

export type UpdateUserStoryPayload = Partial<CreateUserStoryPayload> & {
  version?: number;
};

export interface BulkCreateUserStoriesPayload {
  project_id: Id;
  bulk_stories: string;
  status_id?: Id;
  swimlane_id?: Id;
}

export interface BulkUpdateUserStoryOrderPayload {
  project_id: Id;
  bulk_stories: Array<{ us_id: Id; order: number }>;
  before_us_id?: Id;
  after_us_id?: Id;
}

export interface ListUserStoriesParams {
  project?: Id;
  milestone?: Id | "null";
  status?: Id;
  status__is_archived?: boolean;
  tags?: string;
  watchers?: Id;
  assigned_to?: Id;
  epic?: Id;
  role?: Id;
  status__is_closed?: boolean;
  exclude_status?: Id;
  exclude_tags?: string;
  exclude_assigned_to?: Id;
  exclude_role?: Id;
  exclude_epic?: Id;
  [key: string]: unknown;
}
