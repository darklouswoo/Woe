








jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true });

import worker from "../../src/index";




jest.mock("../../src/services/migrationRunner.ts", () => ({
  MigrationRunner: class {
    async runPendingMigrations() {}
  },
}));


function createStatementStub() {
  const stmt: Record<string, unknown> = {};
  stmt.run = () => Promise.resolve({ results: [], success: true });
  stmt.all = () => Promise.resolve({ results: [] });
  stmt.first = () => Promise.resolve(null);
  stmt.bind = () => stmt;
  return stmt;
}

function createEnvStub() {
  return {

    DB: { prepare: () => createStatementStub() },
  } as any;
}

const ctxStub = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

describe("worker entry routing for /gotifyinfo", () => {
  test("root-path /gotifyinfo is dispatched to the backend Hono app, not the SPA fallback", async () => {
    const res = await worker.fetch(
      new Request("https://woe.example/gotifyinfo"),
      createEnvStub(),
      ctxStub
    );

    const text = await res.text();


    expect(text).not.toContain("Frontend asset not found");


    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(text);
    expect(typeof body.version).toBe("string");
  });
});
