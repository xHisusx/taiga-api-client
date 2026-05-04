import type { AuthManager } from "../auth.js";
import type { HttpClient } from "../http.js";
import type {
  AuthResponse,
  AuthTokens,
  AuthUser,
  LoginPayload,
  RefreshResponse,
  TokenChangeHandler,
} from "../types/auth.js";

export interface AuthResourceOptions {
  http: HttpClient;
  auth: AuthManager;
}

export class AuthResource {
  private readonly http: HttpClient;
  private readonly auth: AuthManager;
  private currentUser: AuthUser | null = null;

  constructor(options: AuthResourceOptions) {
    this.http = options.http;
    this.auth = options.auth;

    this.auth.setRefreshFn(async (refresh) => {
      const result = await this.http.post<RefreshResponse>("/auth/refresh", {
        body: { refresh },
        skipAuth: true,
      });
      return { token: result.data.auth_token, refresh: result.data.refresh };
    });
  }

  async login(payload: Omit<LoginPayload, "type">): Promise<AuthResponse> {
    const result = await this.http.post<AuthResponse>("/auth", {
      body: { type: "normal", ...payload },
      skipAuth: true,
    });
    const data = result.data;
    await this.auth.setTokens({ token: data.auth_token, refreshToken: data.refresh });
    this.currentUser = data;
    return data;
  }

  async refresh(): Promise<string> {
    return this.auth.refresh();
  }

  async logout(): Promise<void> {
    this.currentUser = null;
    await this.auth.clear();
  }

  setTokens(tokens: AuthTokens | null): Promise<void> {
    return this.auth.setTokens(tokens);
  }

  onTokenChange(handler: TokenChangeHandler | undefined): void {
    this.auth.setOnTokenChange(handler);
  }

  getTokens(): AuthTokens | null {
    return this.auth.getTokens();
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }
}
