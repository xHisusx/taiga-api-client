import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type { ListUsersParams, UpdateUserPayload, User } from "../types/user.js";
import { BaseResource } from "./base.js";

/**
 * Users gateway. Available as `client.users`.
 *
 * Inherits CRUD from {@link BaseResource}, except for `create()` — which is intentionally
 * disabled since user registration uses dedicated endpoints (out of v0.1 scope).
 */
export class UsersResource extends BaseResource<User, never, UpdateUserPayload, ListUsersParams> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/users" });
  }

  /** `GET /users/me` — the currently authenticated user. */
  async me(): Promise<User> {
    const result = await this.http.get<User>("/users/me");
    return result.data;
  }

  /** Disabled — Taiga has no `POST /users`. Use `/auth/register/*` endpoints (not yet wrapped). */
  override async create(): Promise<never> {
    throw new Error("UsersResource.create is not supported. Use registration endpoints instead.");
  }

  /** Convenience shortcut: fetch `me`, then `PUT /users/:id` with the payload. */
  async updateMe(payload: UpdateUserPayload): Promise<User> {
    const me = await this.me();
    return this.update(me.id, payload);
  }

  /** `POST /users/change_password` — change the current user's password. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.http.post("/users/change_password", {
      body: { current_password: currentPassword, password: newPassword },
    });
  }

  /** `GET /users/:id/stats` — activity / contribution statistics. */
  async stats(id: Id): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>(`/users/${id}/stats`);
    return result.data;
  }
}
