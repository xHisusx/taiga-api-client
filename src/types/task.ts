import type { Id, Timestamp } from "./common.js";

export interface Task {
  id: Id;
  ref: number;
  project: Id;
  user_story: Id | null;
  milestone: Id | null;
  status: Id;
  subject: string;
  description: string;
  is_blocked: boolean;
  blocked_note: string;
  is_closed: boolean;
  is_iocaine: boolean;
  created_date: Timestamp;
  modified_date: Timestamp;
  finished_date: Timestamp | null;
  due_date: string | null;
  due_date_reason: string;
  due_date_status: string;
  owner: Id;
  assigned_to: Id | null;
  watchers: Id[];
  version: number;
  tags: Array<[string, string | null]> | null;
  external_reference: string[] | null;
  taskboard_order: number;
  us_order: number;
}

export interface CreateTaskPayload {
  project: Id;
  subject: string;
  description?: string;
  status?: Id;
  milestone?: Id;
  user_story?: Id;
  assigned_to?: Id;
  watchers?: Id[];
  is_blocked?: boolean;
  blocked_note?: string;
  is_iocaine?: boolean;
  tags?: Array<[string, string | null]>;
}

export type UpdateTaskPayload = Partial<CreateTaskPayload> & { version?: number };

export interface BulkCreateTasksPayload {
  project_id: Id;
  sprint_id?: Id;
  us_id?: Id;
  bulk_tasks: string;
}

export interface ListTasksParams {
  project?: Id;
  user_story?: Id;
  milestone?: Id;
  status?: Id;
  assigned_to?: Id;
  owner?: Id;
  watchers?: Id;
  tags?: string;
  role?: Id;
  status__is_closed?: boolean;
  [key: string]: unknown;
}
