import type { Id, Timestamp } from "./common.js";

export interface LoginPayload {
  username: string;
  password: string;
  type?: "normal";
}

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

export interface AuthResponse extends AuthUser {
  auth_token: string;
  refresh: string;
}

export interface RefreshPayload {
  refresh: string;
}

export interface RefreshResponse {
  auth_token: string;
  refresh: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string | null;
}

export type TokenChangeHandler = (tokens: AuthTokens | null) => void | Promise<void>;
