





















import type { D1Database } from "@cloudflare/workers-types";
import type Database from "better-sqlite3";
import type { TestDb } from "./testDb";


interface CapturedStatement {
  sql: string;
  args: unknown[];
}


interface D1StatementResult {
  success: true;
  meta: Record<string, unknown>;
  results: Record<string, unknown>[];
}

const RETURNING_RE = /\bRETURNING\b/i;


function runSingleStatement(
  sqlite: Database.Database,
  sql: string,
  args: unknown[]
): D1StatementResult {
  const stmt = sqlite.prepare(sql);
  if (RETURNING_RE.test(sql)) {
    const rows = stmt.all(...args) as Record<string, unknown>[];
    return { success: true, meta: { changes: rows.length }, results: rows };
  }
  const info = stmt.run(...args);
  return {
    success: true,
    meta: { changes: info.changes, last_insert_rowid: info.lastInsertRowid },
    results: []
  };
}










export function makeD1Sqlite(testDb: TestDb): D1Database {
  const sqlite = testDb.sqlite;
  const adapter = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async run() {
              return runSingleStatement(sqlite, sql, args);
            },
            async all() {
              const rows = sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
              return { success: true as const, meta: { changes: rows.length }, results: rows };
            },
            async first() {
              const row = sqlite.prepare(sql).get(...args) as Record<string, unknown> | undefined;
              return row ?? null;
            },
            async raw() {
              const stmt = sqlite.prepare(sql);
              stmt.raw(true);
              return stmt.all(...args) as unknown[][];
            }
          };
        }
      };
    },
    async batch(statements: CapturedStatement[]): Promise<D1StatementResult[]> {

      const runAll = sqlite.transaction((): D1StatementResult[] =>
        statements.map((statement) => {
          const prepared = sqlite.prepare(statement.sql);
          if (RETURNING_RE.test(statement.sql)) {
            const rows = prepared.all(...statement.args) as Record<string, unknown>[];
            return { success: true, meta: { changes: rows.length }, results: rows };
          }
          const info = prepared.run(...statement.args);
          return {
            success: true,
            meta: { changes: info.changes, last_insert_rowid: info.lastInsertRowid },
            results: []
          };
        })
      );
      return runAll();
    }
  };
  return adapter as unknown as D1Database;
}
