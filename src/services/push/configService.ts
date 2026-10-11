import { DrizzleDB } from "../../drizzle/index.ts";

export interface PushRuntimeConfig {
  maxRetries: number;
  retryBackoffMs: number;
}

export class PushConfigService {
  constructor(private drizzle: DrizzleDB) {}

  private async getStateValue(key: string): Promise<string | null> {
    try {
      const row = await this.drizzle.$client
        .prepare("SELECT value FROM system_state WHERE key = ? LIMIT 1")
        .bind(key)
        .first<{ value: string }>();
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  private async getIntState(key: string, fallback: number): Promise<number> {
    const value = await this.getStateValue(key);
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getRuntimeConfig(): Promise<PushRuntimeConfig> {
    return {
      maxRetries: await this.getIntState("push.max_retries", 3),
      retryBackoffMs: await this.getIntState("push.retry_backoff_ms", 2000)
    };
  }
}
