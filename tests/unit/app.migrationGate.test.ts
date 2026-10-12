const mockRunPendingMigrations = jest.fn<Promise<void>, []>();

jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn(),
}), { virtual: true });

jest.mock("../../src/services/migrationRunner.ts", () => ({
  MigrationRunner: class {
    runPendingMigrations() {
      return mockRunPendingMigrations();
    }
  },
}));

import app from "../../src/app";

const env = { DB: {} } as any;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

describe("app migration gate", () => {
  test("migration failure returns 503, retries later, merges concurrent starts, and caches success", async () => {
    mockRunPendingMigrations
      .mockRejectedValueOnce(new Error("secret SQL detail"))
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

    const first = await app.fetch(
      new Request("https://woe.example/gotifyinfo"),
      env,
      ctx
    );
    expect(first.status).toBe(503);
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      error: "Database migration failed",
      code: "DATABASE_MIGRATION_FAILED",
    });
    expect(JSON.stringify(firstBody)).not.toContain("secret SQL detail");

    const [second, third] = await Promise.all([
      app.fetch(new Request("https://woe.example/gotifyinfo"), env, ctx),
      app.fetch(new Request("https://woe.example/gotifyinfo"), env, ctx),
    ]);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(mockRunPendingMigrations).toHaveBeenCalledTimes(2);

    const fourth = await app.fetch(
      new Request("https://woe.example/gotifyinfo"),
      env,
      ctx
    );
    expect(fourth.status).toBe(200);
    expect(mockRunPendingMigrations).toHaveBeenCalledTimes(2);
  });
});
