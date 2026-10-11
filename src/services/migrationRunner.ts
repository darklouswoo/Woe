import type { D1Database } from "@cloudflare/workers-types";
import { migrations } from "../migrations/index.ts";

export class MigrationRunner {
  constructor(private db: D1Database) {}




  private async ensureMigrationTable(): Promise<void> {
    await this.db.prepare(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  }




  private async getAppliedMigrations(): Promise<Set<string>> {
    const result = await this.db
      .prepare("SELECT name FROM _migrations")
      .all<{ name: string }>();

    return new Set((result.results || []).map(r => r.name));
  }





  private isIgnorableMigrationConflict(error: unknown): boolean {
    const errorMessage = error instanceof Error
      ? error.message
      : String(error ?? "");
    return /already exists|duplicate column name/i.test(errorMessage);
  }




  private async recordMigration(name: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, CURRENT_TIMESTAMP)")
      .bind(name)
      .run();
  }





  private async executeSqlStatements(sql: string): Promise<void> {

    const statements = sql
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await this.db.prepare(statement).run();
        } catch (error: unknown) {


          if (this.isIgnorableMigrationConflict(error)) {
            console.log(`[Migration] Object already exists, skipping: ${statement.split('\n')[0].substring(0, 50)}...`);
            continue;
          }
          throw error;
        }
      }
    }
  }




  async runPendingMigrations(): Promise<void> {

    await this.ensureMigrationTable();


    const appliedMigrations = await this.getAppliedMigrations();


    const sortedMigrationNames = Object.keys(migrations).sort();


    for (const migrationName of sortedMigrationNames) {
      if (!appliedMigrations.has(migrationName)) {
        console.log(`Running migration: ${migrationName}`);

        try {
          const sqlContent = migrations[migrationName];
          await this.executeSqlStatements(sqlContent);
          await this.recordMigration(migrationName);

          console.log(`Migration completed: ${migrationName}`);
        } catch (error) {
          console.error(`Migration failed: ${migrationName}`, error);
          throw error;
        }
      }
    }
  }




  async getMigrationStatus(): Promise<{
    total: number;
    applied: number;
    pending: string[];
  }> {
    await this.ensureMigrationTable();
    const appliedMigrations = await this.getAppliedMigrations();
    const allMigrations = Object.keys(migrations).sort();
    const pending = allMigrations.filter(name => !appliedMigrations.has(name));

    return {
      total: allMigrations.length,
      applied: appliedMigrations.size,
      pending,
    };
  }
}
