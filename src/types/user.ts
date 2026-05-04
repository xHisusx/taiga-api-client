import type { Id, Timestamp } from "./common.js";

export interface User {
  id: Id;
  username: string;
  full_name: string;
  full_name_display: string;
  email?: string;
  bio: string;
  lang: string;
  theme: string;
  timezone: string;
  is_active: boolean;
  photo: string | null;
  big_photo: string | null;
  gravatar_id: string | null;
  roles: string[];
  date_joined: Timestamp;
  total_private_projects?: number;
  total_public_projects?: number;
  max_private_projects?: number | null;
  max_public_projects?: number | null;
}

export interface UpdateUserPayload {
  username?: string;
  full_name?: string;
  email?: string;
  bio?: string;
  lang?: string;
  theme?: string;
  timezone?: string;
}

export interface ListUsersParams {
  project?: Id;
  [key: string]: unknown;
}
