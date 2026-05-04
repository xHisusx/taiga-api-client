import type { Id, Timestamp } from "./common.js";

export interface Project {
  id: Id;
  name: string;
  slug: string;
  description: string;
  created_date: Timestamp;
  modified_date: Timestamp;
  owner: Id | { id: Id; username: string; full_name_display: string };
  members: Id[];
  total_milestones: number | null;
  total_story_points: number | null;
  is_backlog_activated: boolean;
  is_kanban_activated: boolean;
  is_wiki_activated: boolean;
  is_issues_activated: boolean;
  is_epics_activated: boolean;
  is_private: boolean;
  videoconferences: string | null;
  videoconferences_extra_data: string | null;
  creation_template: Id | null;
  is_looking_for_people: boolean;
  looking_for_people_note: string;
  tags: string[] | null;
  tags_colors: Array<[string, string | null]>;
  total_closed_milestones: number;
  blocked_code: string | null;
  totals_updated_datetime: Timestamp;
  total_fans: number;
  total_fans_last_week: number;
  total_fans_last_month: number;
  total_fans_last_year: number;
  total_activity: number;
  total_activity_last_week: number;
  total_activity_last_month: number;
  total_activity_last_year: number;
}

export interface CreateProjectPayload {
  name: string;
  description: string;
  creation_template?: Id;
  is_backlog_activated?: boolean;
  is_kanban_activated?: boolean;
  is_wiki_activated?: boolean;
  is_issues_activated?: boolean;
  is_epics_activated?: boolean;
  is_private?: boolean;
  videoconferences?: string | null;
  videoconferences_extra_data?: string | null;
}

export type UpdateProjectPayload = Partial<CreateProjectPayload> & { name?: string };

export interface ListProjectsParams {
  member?: Id;
  members?: Id[];
  is_looking_for_people?: boolean;
  is_featured?: boolean;
  is_backlog_activated?: boolean;
  is_kanban_activated?: boolean;
  order_by?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface ProjectStats {
  assigned_points: number;
  closed_points: number;
  defined_points: number;
  milestones?: Array<Record<string, unknown>>;
  name?: string;
  speed?: number;
  total_milestones: number | null;
  total_points: number | null;
}

export interface ProjectModulesConfig {
  bitbucket?: Record<string, unknown>;
  github?: Record<string, unknown>;
  gitlab?: Record<string, unknown>;
  gogs?: Record<string, unknown>;
  [key: string]: unknown;
}
