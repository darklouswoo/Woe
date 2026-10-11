







import type { D1Database } from "@cloudflare/workers-types";
import { createDrizzle } from "../drizzle/index.ts";
import { users, systemState } from "../models/index.ts";
import { eq, count, sql } from "drizzle-orm";
import { MigrationRunner } from "./migrationRunner.ts";

export interface InitializationResult {
  success: boolean;
  adminUserId?: number;
  error?: string;
}


export class InitService {
  private drizzle;

  constructor(private db: D1Database) {
    this.drizzle = createDrizzle(db);
  }


  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .bind(tableName)
        .first<{ name: string }>();
      return !!result;
    } catch (_) {
      return false;
    }
  }


  async isSystemInitialized(): Promise<boolean> {
    try {
      const exists = await this.tableExists("system_state");
      if (!exists) return false;
      const result = await this.drizzle
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, "is_initialized"))
        .get();
      return !!result && result.value === "true";
    } catch (_) {
      return false;
    }
  }


  async isInitializationLocked(): Promise<boolean> {
    try {
      const exists = await this.tableExists("system_state");
      if (!exists) return false;
      const result = await this.drizzle
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, "init_locked"))
        .get();
      return !!result && (result.value === "true" || result.value === "1");
    } catch (_) {
      return false;
    }
  }


  async hasAdminUser(): Promise<boolean> {
    try {
      const exists = await this.tableExists("users");
      if (!exists) return false;
      const result = await this.drizzle
        .select({ count: count() })
        .from(users)
        .where(sql`${users.admin} = 1 AND ${users.disabled} = 0`)
        .get();
      return (result?.count || 0) > 0;
    } catch (_) {
      return false;
    }
  }













  async sweepStaleInitializationClaims(): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM system_state WHERE key = 'is_initializing' AND datetime(created_at) < datetime('now', '-10 minutes')`
      )
      .run();
  }


















  async claimInitialization(): Promise<string | null> {

    await this.sweepStaleInitializationClaims();
    const owner = crypto.randomUUID();
    const result = await this.db
      .prepare(
        `INSERT INTO system_state (key, value, created_at, updated_at)
         SELECT 'is_initializing', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (SELECT 1 FROM system_state WHERE key = 'is_initialized')
           AND NOT EXISTS (SELECT 1 FROM system_state WHERE key = 'is_initializing')`
      )
      .bind(owner)
      .run();
    return result.meta?.changes && result.meta.changes > 0 ? owner : null;
  }








  async releaseInitializationClaim(owner: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM system_state WHERE key = 'is_initializing' AND value = ?`)
      .bind(owner)
      .run();
  }








  async assertClaimOwnership(owner: string): Promise<boolean> {
    const exists = await this.tableExists("system_state");
    if (!exists) return false;
    const result = await this.drizzle
      .select({ value: systemState.value })
      .from(systemState)
      .where(eq(systemState.key, "is_initializing"))
      .get();
    return !!result && result.value === owner;
  }






  async isInitializationInProgress(): Promise<boolean> {
    try {
      const exists = await this.tableExists("system_state");
      if (!exists) return false;
      const result = await this.drizzle
        .select({ value: systemState.value })
        .from(systemState)
        .where(eq(systemState.key, "is_initializing"))
        .get();
      return !!result;
    } catch {
      return false;
    }
  }


  async markAsInitialized(): Promise<void> {
    await this.drizzle
      .insert(systemState)
      .values({ key: "is_initialized", value: "true", createdAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .onConflictDoUpdate({ target: systemState.key, set: { value: "true", updatedAt: sql`CURRENT_TIMESTAMP` } });
  }


  async lockInitialization(): Promise<void> {
    await this.drizzle
      .insert(systemState)
      .values({ key: "init_locked", value: "true", createdAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .onConflictDoUpdate({ target: systemState.key, set: { value: "true", updatedAt: sql`CURRENT_TIMESTAMP` } });
  }


  async createAdminUser(username: string, password: string): Promise<number | null> {
    const existing = await this.drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.name, username))
      .get();
    if (existing) return null;

    const { hashPassword } = await import("../middleware/auth.ts");
    const hashedassword = await hashPassword(password);

    const inserted = await this.drizzle
      .insert(users)
      .values({
        name: username,
        nickname: username,
        email: 'needupdate@example.com',
        pass: hashedassword,
        admin: true,
        disabled: false,
        createdAt: sql`CURRENT_TIMESTAMP`
      })
      .returning({ id: users.id });
    return inserted && inserted.length > 0 ? inserted[0].id : null;
  }


  async getInitStatus(): Promise<{ initialized: boolean; hasAdmin: boolean; locked: boolean; initializing: boolean; canInitialize: boolean }> {
    const initialized = await this.isSystemInitialized();
    const hasAdmin = await this.hasAdminUser();
    const locked = await this.isInitializationLocked();
    const initializing = await this.isInitializationInProgress();
    return { initialized, hasAdmin, locked, initializing, canInitialize: !initialized && !locked && !initializing };
  }


  async ensureSchema(): Promise<void> {
    const migrationRunner = new MigrationRunner(this.db);
    await migrationRunner.runPendingMigrations();
  }


  async validateDatabase(): Promise<boolean> {
    try {
      await this.db.prepare("SELECT 1 as test").first();
      const requiredTables = ['users', 'applications', 'clients', 'messages', 'system_state'];
      for (const table of requiredTables) {
        const exists = await this.tableExists(table);
        if (!exists) return false;
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}
