import type { AuthTokens, TokenChangeHandler } from "./types/auth.js";

export type AuthMode = "bearer" | "application" | "none";

export interface AuthManagerOptions {
  token?: string | null;
  refreshToken?: string | null;
  applicationToken?: string | null;
  onTokenChange?: TokenChangeHandler;
}

export class AuthManager {
  private token: string | null;
  private refreshToken: string | null;
  private readonly applicationToken: string | null;
  private onTokenChange?: TokenChangeHandler;
  private inflightRefresh: Promise<string> | null = null;
  private refreshFn: ((refresh: string) => Promise<{ token: string; refresh: string }>) | null = null;

  constructor(options: AuthManagerOptions = {}) {
    this.token = options.token ?? null;
    this.refreshToken = options.refreshToken ?? null;
    this.applicationToken = options.applicationToken ?? null;
    this.onTokenChange = options.onTokenChange;
  }

  setRefreshFn(fn: (refresh: string) => Promise<{ token: string; refresh: string }>): void {
    this.refreshFn = fn;
  }

  setOnTokenChange(handler: TokenChangeHandler | undefined): void {
    this.onTokenChange = handler;
  }

  getMode(): AuthMode {
    if (this.applicationToken) return "application";
    if (this.token) return "bearer";
    return "none";
  }

  getAuthHeader(): string | null {
    if (this.applicationToken) return `Application ${this.applicationToken}`;
    if (this.token) return `Bearer ${this.token}`;
    return null;
  }

  getTokens(): AuthTokens | null {
    if (!this.token) return null;
    return { token: this.token, refreshToken: this.refreshToken };
  }

  hasRefreshToken(): boolean {
    return this.refreshToken !== null && this.refreshToken !== "";
  }

  async setTokens(tokens: AuthTokens | null): Promise<void> {
    if (tokens === null) {
      this.token = null;
      this.refreshToken = null;
    } else {
      this.token = tokens.token;
      this.refreshToken = tokens.refreshToken;
    }
    if (this.onTokenChange) {
      await this.onTokenChange(this.getTokens());
    }
  }

  async clear(): Promise<void> {
    await this.setTokens(null);
  }

  async refresh(): Promise<string> {
    if (!this.refreshFn) {
      throw new Error("AuthManager: refresh function is not configured");
    }
    if (!this.refreshToken) {
      throw new Error("AuthManager: no refresh token available");
    }

    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    const refreshFn = this.refreshFn;
    const currentRefresh = this.refreshToken;

    this.inflightRefresh = (async () => {
      try {
        const result = await refreshFn(currentRefresh);
        await this.setTokens({ token: result.token, refreshToken: result.refresh });
        return result.token;
      } finally {
        this.inflightRefresh = null;
      }
    })();

    return this.inflightRefresh;
  }
}
