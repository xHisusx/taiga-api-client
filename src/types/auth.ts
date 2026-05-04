import type { Id, Timestamp } from "./common.js";

/** Body of `POST /auth` for the standard (`type: "normal"`) login flow. */
export interface LoginPayload {
  /** Username **or** email. Taiga accepts both in the same field. */
  username: string;
  password: string;
  /** Login type. Defaults to `"normal"` and can be omitted. */
  type?: "normal";
}

/** A user profile as embedded in {@link AuthResponse}. */
export interface AuthUser {
  id: Id;
  username: string;
  email: string;
  full_name: string;
  full_name_display: string;
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
}

/** Body returned by `POST /auth` — full user profile plus a token pair. */
export interface AuthResponse extends AuthUser {
  /** Bearer access token. Send as `Authorization: Bearer <auth_token>`. */
  auth_token: string;
  /** Refresh token. Use it to obtain a new access token via `POST /auth/refresh`. */
  refresh: string;
}

/** Body of `POST /auth/refresh`. */
export interface RefreshPayload {
  refresh: string;
}

/** Body returned by `POST /auth/refresh` — the new token pair. */
export interface RefreshResponse {
  auth_token: string;
  refresh: string;
}

/** A bearer token pair held in memory by {@link AuthManager}. */
export interface AuthTokens {
  /** Bearer access token. */
  token: string;
  /** Refresh token, or `null` if no refresh is possible. */
  refreshToken: string | null;
}

/**
 * Callback fired whenever the in-memory token pair changes.
 *
 * Invoked with:
 * - the new {@link AuthTokens} pair after a successful login or auto-refresh;
 * - `null` after `client.auth.logout()` (or any other token clear).
 *
 * The returned Promise is awaited before the original request is retried, so persistence
 * is guaranteed to complete before any subsequent call.
 */
export type TokenChangeHandler = (tokens: AuthTokens | null) => void | Promise<void>;
