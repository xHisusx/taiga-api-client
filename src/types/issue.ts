import type { Id, Timestamp } from "./common.js";

export interface Issue {
  id: Id;
  ref: number;
  project: Id;
  subject: string;
  description: string;
  status: Id;
  type: Id;
  severity: Id;
  priority: Id;
  milestone: Id | null;
  is_blocked: boolean;
  blocked_note: string;
  is_closed: boolean;
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
  total_voters: number;
  total_watchers: number;
}

export interface CreateIssuePayload {
  project: Id;
  subject: string;
  description?: string;
  status?: Id;
  type?: Id;
  severity?: Id;
  priority?: Id;
  milestone?: Id;
  assigned_to?: Id;
  watchers?: Id[];
  is_blocked?: boolean;
  blocked_note?: string;
  tags?: Array<[string, string | null]>;
}

export type UpdateIssuePayload = Partial<CreateIssuePayload> & { version?: number };

export interface ListIssuesParams {
  project?: Id;
  status?: Id;
  severity?: Id;
  priority?: Id;
  type?: Id;
  owner?: Id;
  assigned_to?: Id;
  watchers?: Id;
  tags?: string;
  status__is_closed?: boolean;
  [key: string]: unknown;
}

export interface IssueVoter {
  id: Id;
  username: string;
  full_name: string;
}

export interface IssueWatcher {
  id: Id;
  username: string;
  full_name: string;
}
