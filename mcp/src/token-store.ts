import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** A bearer token with its (optional) refresh companion. */
export interface StoredTokens {
  token: string;
  refreshToken: string | null;
}

/** Pluggable persistence for the token pair. */
export interface TokenStore {
  load(key: string): Promise<StoredTokens | null>;
  save(key: string, tokens: StoredTokens | null): Promise<void>;
}

interface TokenFile {
  version: 1;
  entries: Record<string, { token: string; refreshToken: string | null; updated_at: string }>;
}

/** Cache key for one account on one instance, so several configs can share a file. */
export function tokenCacheKey(baseUrl: string, account?: string): string {
  return `${baseUrl}#${account ?? "default"}`;
}

/** Keeps tokens for the lifetime of the process only. Used when caching is disabled. */
export class MemoryTokenStore implements TokenStore {
  private readonly entries = new Map<string, StoredTokens>();

  async load(key: string): Promise<StoredTokens | null> {
    return this.entries.get(key) ?? null;
  }

  async save(key: string, tokens: StoredTokens | null): Promise<void> {
    if (tokens) this.entries.set(key, tokens);
    else this.entries.delete(key);
  }
}

/**
 * Persists tokens to a JSON file with `0600` permissions so a restarted server does not
 * have to log in again.
 *
 * Every failure is non-fatal: a read-only or missing home directory degrades to
 * in-memory behaviour with one warning on stderr.
 */
export class FileTokenStore implements TokenStore {
  private warned = false;

  constructor(private readonly filePath: string) {}

  async load(key: string): Promise<StoredTokens | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TokenFile;
      const entry = parsed.entries?.[key];
      if (!entry?.token) return null;
      return { token: entry.token, refreshToken: entry.refreshToken ?? null };
    } catch {
      return null;
    }
  }

  async save(key: string, tokens: StoredTokens | null): Promise<void> {
    try {
      const current = await this.readFileOrEmpty();
      if (tokens) {
        current.entries[key] = {
          token: tokens.token,
          refreshToken: tokens.refreshToken,
          updated_at: new Date().toISOString(),
        };
      } else {
        delete current.entries[key];
      }
      await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      await writeFile(this.filePath, `${JSON.stringify(current, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      // `mode` only applies when the file is created, so an existing file keeps whatever
      // permissions it had — tighten it explicitly. A no-op on Windows.
      await chmod(this.filePath, 0o600).catch(() => undefined);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[taiga-mcp] could not persist tokens to ${this.filePath}: ${reason}\n` +
            "[taiga-mcp] continuing with in-memory tokens only\n",
        );
      }
    }
  }

  private async readFileOrEmpty(): Promise<TokenFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TokenFile;
      if (parsed && typeof parsed === "object" && parsed.entries) return parsed;
    } catch {
      // Missing or corrupt file — start a fresh one.
    }
    return { version: 1, entries: {} };
  }
}
