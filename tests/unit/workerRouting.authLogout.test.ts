












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





function createEnvStub(withAssets: boolean) {
  const env: Record<string, unknown> = {
    DB: { prepare: () => createStatementStub() }
  };
  if (withAssets) {
    env.ASSETS = { fetch: jest.fn() };
  }
  return env as any;
}

const ctxStub = { waitUntil: () => {}, passThroughOnException: () => {} } as any;


function logoutRequest(path: string) {
  return new Request(`https://woe.example${path}`, { method: "POST" });
}

async function expectReachesBackendAuthRoute(res: Response) {
  const text = await res.text();


  expect(text).not.toContain("Frontend asset not found");

  expect(text).not.toContain("Endpoint not found");


  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(JSON.parse(text)).toEqual({
    error: "Unauthorized",
    errorCode: 401,
    errorDescription:
      "you need to provide a valid access token or user credentials to access this api"
  });
}

describe("worker entry routing for POST /auth/logout", () => {
  test("root-path POST /auth/logout without ASSETS binding reaches the backend auth route", async () => {
    const res = await worker.fetch(
      logoutRequest("/auth/logout"),
      createEnvStub(false),
      ctxStub
    );
    await expectReachesBackendAuthRoute(res);
  });

  test("POST /api/v1/auth/logout without ASSETS binding reaches the backend auth route", async () => {
    const res = await worker.fetch(
      logoutRequest("/api/v1/auth/logout"),
      createEnvStub(false),
      ctxStub
    );
    await expectReachesBackendAuthRoute(res);
  });

  test("with ASSETS binding, root-path POST /auth/logout never calls ASSETS.fetch", async () => {
    const env = createEnvStub(true);
    const res = await worker.fetch(logoutRequest("/auth/logout"), env, ctxStub);

    await expectReachesBackendAuthRoute(res);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  test("with ASSETS binding, POST /api/v1/auth/logout never calls ASSETS.fetch", async () => {
    const env = createEnvStub(true);
    const res = await worker.fetch(logoutRequest("/api/v1/auth/logout"), env, ctxStub);

    await expectReachesBackendAuthRoute(res);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
