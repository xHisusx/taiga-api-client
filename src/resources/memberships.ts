import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type {
  BulkCreateMembershipsPayload,
  CreateMembershipPayload,
  ListMembershipsParams,
  Membership,
  UpdateMembershipPayload,
} from "../types/membership.js";
import { BaseResource } from "./base.js";

/**
 * Project memberships gateway. Available as `client.memberships`.
 *
 * Inherits CRUD from {@link BaseResource} and adds bulk-invite + invitation re-send.
 */
export class MembershipsResource extends BaseResource<
  Membership,
  CreateMembershipPayload,
  UpdateMembershipPayload,
  ListMembershipsParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/memberships" });
  }

  /**
   * `POST /memberships/bulk_create` — invite multiple users in a single call.
   *
   * @example
   * ```ts
   * await client.memberships.bulkCreate({
   *   project_id: 1,
   *   bulk_memberships: [
   *     { role_id: 2, username: "alice@example.com" },
   *     { role_id: 2, username: "bob@example.com" },
   *   ],
   * });
   * ```
   */
  async bulkCreate(payload: BulkCreateMembershipsPayload): Promise<Membership[]> {
    const result = await this.http.post<Membership[]>("/memberships/bulk_create", { body: payload });
    return result.data;
  }

  /** `POST /memberships/:id/resend_invitation` — re-send the invitation email. */
  async resendInvitation(id: Id): Promise<void> {
    await this.http.post(`/memberships/${id}/resend_invitation`);
  }
}
