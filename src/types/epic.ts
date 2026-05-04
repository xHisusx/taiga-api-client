import type { Id, Timestamp } from "./common.js";

/** A Taiga epic — top-level container that groups user stories across sprints. */
export interface Epic {
  id: Id;
  ref: number;
  project: Id;
  subject: string;
  description: string;
  /** Hex color string used as the epic's badge color in the UI, e.g. `"#abcdef"`. */
  color: string;
  epics_order: number;
  status: Id;
  is_closed: boolean;
  client_requirement: boolean;
  team_requirement: boolean;
  is_blocked: boolean;
  blocked_note: string;
  assigned_to: Id | null;
  owner: Id;
  watchers: Id[];
  tags: Array<[string, string | null]> | null;
  version: number;
  created_date: Timestamp;
  modified_date: Timestamp;
  total_voters: number;
  total_watchers: number;
}

/** Body of `POST /epics`. */
export interface CreateEpicPayload {
  project: Id;
  subject: string;
  description?: string;
  color?: string;
  status?: Id;
  assigned_to?: Id;
  client_requirement?: boolean;
  team_requirement?: boolean;
  is_blocked?: boolean;
  blocked_note?: string;
  watchers?: Id[];
  tags?: Array<[string, string | null]>;
}

/** Body of `PUT` / `PATCH /epics/:id`. `version` enables optimistic concurrency control. */
export type UpdateEpicPayload = Partial<CreateEpicPayload> & { version?: number };

/** Query params for `GET /epics`. */
export interface ListEpicsParams {
  project?: Id;
  assigned_to?: Id;
  status?: Id;
  tags?: string;
  status__is_closed?: boolean;
  [key: string]: unknown;
}

/** Body of `POST /epics/bulk_create` — newline-separated subjects, one epic per line. */
export interface BulkCreateEpicsPayload {
  project_id: Id;
  bulk_epics: string;
  status_id?: Id;
}

/** Body of `POST /epics/:id/related_userstories` — link an existing user story to the epic. */
export interface AddRelatedUserStoryPayload {
  user_story: Id;
}

/** Item in the response of `GET /epics/:id/related_userstories`. */
export interface EpicRelatedUserStory {
  epic: Id;
  user_story: Id;
  order: number;
}

/** Item in the response of `GET /epics/:id/voters`. */
export interface EpicVoter {
  id: Id;
  username: string;
  full_name: string;
}

/** Item in the response of `GET /epics/:id/watchers`. */
export interface EpicWatcher {
  id: Id;
  username: string;
  full_name: string;
}
