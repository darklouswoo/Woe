







import { MigrationRunner } from "../../src/services/migrationRunner";
import * as fs from "fs";
import * as path from "path";

function makeDb(statementBehaviors: Array<(sql: string) => { run: () => Promise<any> } | null>) {
  let call = 0;
  const preparedSqls: string[] = [];
  const bindArgs: any[] = [];
  const db: any = {
    prepare: jest.fn((sql: string) => {
      preparedSqls.push(sql);
      const behavior =
        statementBehaviors[Math.min(call, statementBehaviors.length - 1)]?.(sql) ??
        { run: jest.fn().mockResolvedValue({}) };
      call++;
      return {
        run: behavior.run,
        all: jest.fn().mockResolvedValue({ results: [] }),
        first: jest.fn().mockResolvedValue(null),
        bind: jest.fn((...args: any[]) => {
          bindArgs.push(args);
          return { run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        }),
      };
    }),
  };
  return { db, preparedSqls, bindArgs };
}

describe("executeSqlStatements 容错", () => {
  test("duplicate column name 错误被容忍：跳过该语句、继续执行后续语句", async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error("duplicate column name: sort_key"));
    const { db, preparedSqls } = makeDb([
      (sql) => (sql.includes("ALTER TABLE") ? { run } : null),
    ]);
    const runner = new MigrationRunner(db);

    await expect(
      (runner as any).executeSqlStatements(
        "ALTER TABLE `applications` ADD `sort_key` text;--> statement-breakpoint\nCREATE INDEX idx_x ON t(c);"
      )
    ).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(1);
    expect(preparedSqls.filter((sql) => sql.includes("CREATE INDEX")).length).toBe(1);
  });

  test("非容错错误（语法错误）向上抛出", async () => {
    const { db } = makeDb([
      () => ({ run: jest.fn().mockRejectedValue(new Error('near "FROM": syntax error')) }),
    ]);
    const runner = new MigrationRunner(db);

    await expect(
      (runner as any).executeSqlStatements("SELECT FROM broken;")
    ).rejects.toThrow('syntax error');
  });

  test("no such table/index 不被 SQLITE_ERROR 宽泛规则吞掉", async () => {
    for (const message of [
      "SQLITE_ERROR: no such table: missing_table",
      "SQLITE_ERROR: no such index: missing_index",
      "SQLITE_ERROR: UNIQUE constraint failed: users.name",
    ]) {
      const { db } = makeDb([
        () => ({ run: jest.fn().mockRejectedValue(new Error(message)) }),
      ]);
      const runner = new MigrationRunner(db);

      await expect(
        (runner as any).executeSqlStatements("CREATE TABLE missing_table (id INTEGER);")
      ).rejects.toThrow(message);
    }
  });

  test("_migrations 读取失败向上抛出，不当作空集合重放", async () => {
    const db: any = {
      prepare: jest.fn((sql: string) => ({
        run: jest.fn().mockResolvedValue({}),
        all: jest.fn().mockRejectedValue(new Error("D1 unavailable")),
        bind: jest.fn(() => ({ run: jest.fn().mockResolvedValue({}) })),
      })),
    };
    const runner = new MigrationRunner(db);

    await expect((runner as any).getAppliedMigrations()).rejects.toThrow("D1 unavailable");
  });
});

describe("runPendingMigrations 端到端（真实迁移索引 + 注入重复列错误）", () => {
  test("首条 ALTER 撞重复列仍被容忍，全部迁移被记录", async () => {
    let duplicateInjected = false;
    const { db, preparedSqls, bindArgs } = makeDb([
      (sql) => {
        if (!duplicateInjected && sql.trimStart().startsWith("ALTER")) {
          duplicateInjected = true;
          return { run: jest.fn().mockRejectedValue(new Error("duplicate column name: nickname")) };
        }
        return null;
      },
    ]);

    await expect(new MigrationRunner(db).runPendingMigrations()).resolves.toBeUndefined();

    const { migrations } = await import("../../src/migrations/index.ts");
    const inserts = preparedSqls.filter((s) => s.includes("INSERT INTO _migrations"));
    expect(inserts.length).toBe(Object.keys(migrations).length);
    expect(bindArgs.flat()).toContain("0008_client_elevated_until");
  });
});

describe("runPendingMigrations 端到端（0009 索引重建撞 already exists）", () => {





  const MIGRATION_0009 = "0009_unusual_human_cannonball";
  const isClientsUniqueIndex = (sql: string) =>
    sql.includes("CREATE UNIQUE INDEX") && sql.includes("clients_user_id_device_uid_unique");


  async function withReal0009<T>(fn: () => Promise<T>): Promise<T> {
    const { migrations } = await import("../../src/migrations/index.ts");
    const original = migrations[MIGRATION_0009];
    const real = fs.readFileSync(
      path.join(__dirname, "../../src/migrations/sql/0009_unusual_human_cannonball.sql"),
      "utf8"
    );

    if (!real.split("--> statement-breakpoint").some((s) => isClientsUniqueIndex(s))) {
      throw new Error("0009 no longer contains the clients unique index statement under test");
    }
    migrations[MIGRATION_0009] = real;
    try {
      return await fn();
    } finally {
      migrations[MIGRATION_0009] = original;
    }
  }

  test("CREATE UNIQUE INDEX already exists 被容忍：跳过该语句、后续语句执行、迁移照常记录", async () => {
    const indexRun = jest
      .fn()
      .mockRejectedValue(new Error("index clients_user_id_device_uid_unique already exists"));
    const { db, preparedSqls, bindArgs } = makeDb([
      (sql) => (isClientsUniqueIndex(sql) ? { run: indexRun } : null),
    ]);

    await withReal0009(() =>
      expect(new MigrationRunner(db).runPendingMigrations()).resolves.toBeUndefined()
    );


    expect(indexRun).toHaveBeenCalledTimes(1);

    expect(preparedSqls.filter((s) => s.includes("push_outbox_status_next_retry_idx")).length).toBe(1);

    const { migrations } = await import("../../src/migrations/index.ts");
    const inserts = preparedSqls.filter((s) => s.includes("INSERT INTO _migrations"));
    expect(inserts.length).toBe(Object.keys(migrations).length);
    expect(bindArgs.flat()).toContain("0009_unusual_human_cannonball");
  });

  test("UNIQUE constraint failed（数据冲突）不被容忍：向上抛出", async () => {
    const { db } = makeDb([
      (sql) =>
        isClientsUniqueIndex(sql)
          ? { run: jest.fn().mockRejectedValue(new Error("UNIQUE constraint failed: clients.user_id, clients.device_uid")) }
          : null,
    ]);

    await withReal0009(() =>
      expect(new MigrationRunner(db).runPendingMigrations()).rejects.toThrow(
        "UNIQUE constraint failed: clients.user_id, clients.device_uid"
      )
    );
  });
});

describe("迁移索引完整性（双 0007 清理后）", () => {
  test("无 0007_big_fabian_cortez、含 0008-0012、键唯一", async () => {
    const { migrations } = await import("../../src/migrations/index.ts");
    const keys = Object.keys(migrations);
    expect(keys).not.toContain("0007_big_fabian_cortez");
    expect(keys).toContain("0007_application_sort_key");
    expect(keys).toContain("0008_client_elevated_until");
    expect(keys).toContain("0009_unusual_human_cannonball");
    expect(keys).toContain("0010_same_firestar");
    expect(keys).toContain("0011_active_device_token_unique");

    expect(keys).toContain("0012_wonderful_random");
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(12);
  });
});
