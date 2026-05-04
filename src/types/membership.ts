import type { Id, Timestamp } from "./common.js";

export interface Membership {
  id: Id;
  user: Id | null;
  project: Id;
  role: Id;
  is_admin: boolean;
  email: string;
  created_at: Timestamp;
  invited_by: Id | null;
  invitation_extra_text: string | null;
  user_order: number;
  role_name: string;
  full_name: string;
  user_email: string;
  is_user_active: boolean;
  color: string;
  photo: string | null;
  project_name: string;
  project_slug: string;
}

export interface CreateMembershipPayload {
  project: Id;
  role: Id;
  username: string;
  invitation_extra_text?: string;
}

export interface UpdateMembershipPayload {
  role?: Id;
  is_admin?: boolean;
}

export interface BulkCreateMembershipsPayload {
  project_id: Id;
  bulk_memberships: Array<{ role_id: Id; username: string }>;
  invitation_extra_text?: string;
}

export interface ListMembershipsParams {
  project?: Id;
  user?: Id;
  role?: Id;
  [key: string]: unknown;
}
