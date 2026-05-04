import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type { ListUsersParams, UpdateUserPayload, User } from "../types/user.js";
import { BaseResource } from "./base.js";

export class UsersResource extends BaseResource<User, never, UpdateUserPayload, ListUsersParams> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/users" });
  }

  async me(): Promise<User> {
    const result = await this.http.get<User>("/users/me");
    return result.data;
  }

  override async create(): Promise<never> {
    throw new Error("UsersResource.create is not supported. Use registration endpoints instead.");
  }

  async updateMe(payload: UpdateUserPayload): Promise<User> {
    const me = await this.me();
    return this.update(me.id, payload);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.http.post("/users/change_password", {
      body: { current_password: currentPassword, password: newPassword },
    });
  }

  async stats(id: Id): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>(`/users/${id}/stats`);
    return result.data;
  }
}
