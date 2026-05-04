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

export class MembershipsResource extends BaseResource<
  Membership,
  CreateMembershipPayload,
  UpdateMembershipPayload,
  ListMembershipsParams
> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/memberships" });
  }

  async bulkCreate(payload: BulkCreateMembershipsPayload): Promise<Membership[]> {
    const result = await this.http.post<Membership[]>("/memberships/bulk_create", { body: payload });
    return result.data;
  }

  async resendInvitation(id: Id): Promise<void> {
    await this.http.post(`/memberships/${id}/resend_invitation`);
  }
}
