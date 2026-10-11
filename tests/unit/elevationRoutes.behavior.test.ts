



















const mockUpdateCurrentUserPassword = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockDeleteApplication = jest.fn();
const mockRegenerateApplicationToken = jest.fn();

const mockUpdateApplicationSecurity = jest.fn();

const mockDrizzle: any = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock("../../src/drizzle/index.ts", () => ({
  createDrizzle: jest.fn(() => mockDrizzle),
}));

jest.mock("../../src/handlers/userHandlers.ts", () => ({
  UserHandlers: jest.fn().mockImplementation(() => ({
    getCurrentUser: mockGetCurrentUser,
    updateCurrentUserPassword: mockUpdateCurrentUserPassword,
  })),
}));

jest.mock("../../src/handlers/applicationHandlers.ts", () => ({
  ApplicationHandlers: jest.fn().mockImplementation(() => ({
    getAllApplications: jest.fn(),
    createApplication: jest.fn(),
    getApplication: jest.fn(),
    updateApplication: jest.fn(),
    deleteApplication: mockDeleteApplication,
    regenerateApplicationToken: mockRegenerateApplicationToken,
    updateApplicationSecurity: mockUpdateApplicationSecurity,
    uploadApplicationImage: jest.fn(),
    deleteApplicationImage: jest.fn(),
  })),
}));

jest.mock("../../src/handlers/messageHandlers.ts", () => ({
  MessageHandlers: jest.fn().mockImplementation(() => ({
    getApplicationMessages: jest.fn(),
    deleteApplicationMessages: jest.fn(),
  })),
}));

import { current } from "../../src/routes/current";
import { client } from "../../src/routes/client";
import { application } from "../../src/routes/application";
import { hashPassword } from "../../src/middleware/auth";
import { applications } from "../../src/models/index.ts";


let mockBasicUserRow: any = null;

let mockElevationRow: any = null;


let mockClientTokenRow: any = { id: 5, userId: 7 };

let mockAppTokenRow: any = null;

let mockUserAdminRow: any = { admin: false };

let mockFullClientRow: any = null;

let mockUpdatePayloads: any[] = [];

beforeAll(async () => {
  const pass = await hashPassword("correct-horse");
  mockBasicUserRow = { id: 7, name: "alice", pass, admin: false, disabled: false };
});

function basicAuthHeader(username: string, password: string): Record<string, string> {
  return { authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64") };
}

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init);
}

const ELEVATION_403_BODY = {
  error: "Forbidden",
  errorCode: 403,

  errorDescription: "session not elevated, use basic auth or call /client:elevate",
};

const mockEnv: any = { DB: {} };
const mockExecutionCtx: any = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockElevationRow = null;
  mockClientTokenRow = { id: 5, userId: 7, token: "Cclient-token", lastUsed: new Date().toISOString(), expiresAfterInactivitySeconds: 0, expiresAt: null };
  mockAppTokenRow = null;
  mockUserAdminRow = { admin: false };
  mockFullClientRow = null;
  mockUpdatePayloads = [];

  const okResponse = () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  mockGetCurrentUser.mockImplementation(okResponse);
  mockUpdateCurrentUserPassword.mockImplementation(okResponse);
  mockDeleteApplication.mockImplementation(okResponse);
  mockRegenerateApplicationToken.mockImplementation(okResponse);
  mockUpdateApplicationSecurity.mockImplementation(okResponse);


  mockDrizzle.select.mockImplementation((selection: any) => ({
    from: (table: any) => ({
      where: () => ({
        get: () => {
          const keys = selection && typeof selection === "object" ? Object.keys(selection) : [];
          if (keys.includes("pass")) return Promise.resolve(mockBasicUserRow);


          if (keys.includes("token") && !keys.includes("name")) return Promise.resolve(mockClientTokenRow);
          if (keys.includes("token")) return Promise.resolve(mockFullClientRow);



          if (keys.length === 1 && keys.includes("elevatedUntil")) return Promise.resolve(mockElevationRow);
          if (keys.length === 1 && keys.includes("admin")) return Promise.resolve(mockUserAdminRow);
          if (keys.includes("id") && keys.includes("userId")) {
            return Promise.resolve(table === applications ? mockAppTokenRow : mockClientTokenRow);
          }
          return Promise.resolve(null);
        },
        all: () => Promise.resolve([]),
      }),
    }),
  }));

  mockDrizzle.update.mockImplementation(() => ({
    set: (payload: any) => {
      mockUpdatePayloads.push(payload);
      return { where: () => Promise.resolve(undefined) };
    },
  }));

  mockDrizzle.delete.mockImplementation(() => ({
    where: () => Promise.resolve({ meta: { changes: 1 } }),
  }));
});

describe("client elevation route behavior (gotify RequireElevatedClient)", () => {
  test("(a) Basic auth 通过危险端点守卫：POST /current/user/password 调用密码修改", async () => {
    const response = await current.fetch(
      makeRequest("/user/password", {
        method: "POST",
        headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
        body: JSON.stringify({ pass: "new-secret" }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateCurrentUserPassword).toHaveBeenCalledWith(7, "new-secret");
  });

  test("(a) Basic auth 通过危险端点守卫：DELETE /application/5 调用应用删除", async () => {
    const response = await application.fetch(
      makeRequest("/5", { method: "DELETE", headers: basicAuthHeader("alice", "correct-horse") }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockDeleteApplication).toHaveBeenCalledWith(7, "5");
  });

  test("(a) Basic auth 在 elevate 路由上可用：POST /client/5/elevate → 204 并写入未来 elevatedUntil", async () => {
    mockFullClientRow = { id: 5, userId: 7, token: "Ctoken", name: "phone", platform: "web" };
    const before = Date.now();

    const response = await client.fetch(
      makeRequest("/5/elevate", {
        method: "POST",
        headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
        body: JSON.stringify({ durationSeconds: 60 }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(204);
    expect(mockUpdatePayloads).toHaveLength(1);
    const elevatedUntil = new Date(mockUpdatePayloads[0].elevatedUntil).getTime();
    expect(elevatedUntil).toBeGreaterThanOrEqual(before + 60_000);
    expect(elevatedUntil).toBeLessThanOrEqual(Date.now() + 60_000 + 5_000);
  });

  test("(b) 未提升 client token：POST /current/user/password → 403 gotify 精确消息", async () => {
    mockElevationRow = { elevatedUntil: null };

    const response = await current.fetch(
      makeRequest("/user/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ pass: "new-secret" }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockUpdateCurrentUserPassword).not.toHaveBeenCalled();
  });

  test("(b) 已认证未提升 client token：DELETE /application/5 → 403，不触发删除", async () => {
    mockElevationRow = null;

    const response = await application.fetch(
      makeRequest("/5", { method: "DELETE", headers: { "x-gotify-key": "Cclient-token" } }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockDeleteApplication).not.toHaveBeenCalled();
  });

  test("无凭据：DELETE /application/5 → 401（未认证先于提权判定），不触发删除", async () => {
    const response = await application.fetch(
      makeRequest("/5", { method: "DELETE" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Client token or Basic auth required",
    });
    expect(mockDeleteApplication).not.toHaveBeenCalled();
  });

  test("坏 Basic：DELETE /application/5 → 401，不触发删除", async () => {
    const response = await application.fetch(
      makeRequest("/5", { method: "DELETE", headers: basicAuthHeader("alice", "wrong-password") }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Client token or Basic auth required",
    });
    expect(mockDeleteApplication).not.toHaveBeenCalled();
  });

  test("坏 client token：DELETE /application/5 → 401，不触发删除", async () => {
    mockClientTokenRow = null;

    const response = await application.fetch(
      makeRequest("/5", { method: "DELETE", headers: { "x-gotify-key": "Cno-such-token" } }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Client token or Basic auth required",
    });
    expect(mockDeleteApplication).not.toHaveBeenCalled();
  });

  test("(b) 未提升 client token：PUT /application/5/security → 403，不触发 token 重生成", async () => {
    mockElevationRow = null;

    const response = await application.fetch(
      makeRequest("/5/security", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ regenerateToken: true }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
  });

  test("(b) 未提升 client token：DELETE /client/5 → 403，不触发删除", async () => {
    mockElevationRow = null;

    const response = await client.fetch(
      makeRequest("/5", { method: "DELETE", headers: { "x-gotify-key": "Cclient-token" } }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockDrizzle.delete).not.toHaveBeenCalled();
  });

  test("(b) 未提升 client token 无法自我提升：POST /client/5/elevate → 403", async () => {
    mockElevationRow = null;

    const response = await client.fetch(
      makeRequest("/5/elevate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ durationSeconds: 60 }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockUpdatePayloads).toHaveLength(0);
  });

  test("(c) 已提升 client token：DELETE /client/5 → 200（真实 deleteClient 执行）", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await client.fetch(
      makeRequest("/5", { method: "DELETE", headers: { "x-gotify-key": "Cclient-token" } }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockDrizzle.delete).toHaveBeenCalledTimes(1);
  });

  test("(c) 已提升 client token：PUT /application/5/security → 放行至 token 重生成", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await application.fetch(
      makeRequest("/5/security", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ regenerateToken: true }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateApplicationSecurity).toHaveBeenCalledWith(7, "5", true);
  });

  test("(c) 已提升 client token：POST /current/user/password → 放行至密码修改", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await current.fetch(
      makeRequest("/user/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ pass: "new-secret" }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateCurrentUserPassword).toHaveBeenCalledWith(7, "new-secret");
  });

  test("(d) 已提升身份操作他人资源：POST /client/9/elevate（外户 client）→ 404，不写入", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };
    mockFullClientRow = null;

    const response = await client.fetch(
      makeRequest("/9/elevate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ durationSeconds: 60 }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not Found",
      errorCode: 404,
      errorDescription: "Client not found",
    });
    expect(mockUpdatePayloads).toHaveLength(0);
  });

  test("(e) 提升已过期：POST /current/user/password → 403 gotify 精确消息", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() - 60_000).toISOString() };

    const response = await current.fetch(
      makeRequest("/user/password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-gotify-key": "Cclient-token" },
        body: JSON.stringify({ pass: "new-secret" }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockUpdateCurrentUserPassword).not.toHaveBeenCalled();
  });

  test("elevate 路由参数校验前置：非法 id → 400（无需认证）", async () => {
    const response = await client.fetch(
      makeRequest("/abc/elevate", {
        method: "POST",
        headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
        body: JSON.stringify({ durationSeconds: 60 }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "Invalid id parameter: must be a positive integer",
    });
  });

  test("elevate 路由请求体校验：缺失 durationSeconds → 400", async () => {
    mockFullClientRow = { id: 5, userId: 7, token: "Ctoken", name: "phone", platform: "web" };

    const response = await client.fetch(
      makeRequest("/5/elevate", {
        method: "POST",
        headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
        body: JSON.stringify({}),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "durationSeconds must be a positive integer",
    });
    expect(mockUpdatePayloads).toHaveLength(0);
  });

  test.each([1e15, 86_400 * 365 + 1])(
    "elevate 时长上限：durationSeconds=%d → 400（防 Date 溢出 500），不写入",
    async (durationSeconds) => {
      mockFullClientRow = { id: 5, userId: 7, token: "Ctoken", name: "phone", platform: "web" };

      const response = await client.fetch(
        makeRequest("/5/elevate", {
          method: "POST",
          headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
          body: JSON.stringify({ durationSeconds }),
        }),
        mockEnv,
        mockExecutionCtx
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Bad Request",
        errorCode: 400,
        errorDescription: "durationSeconds must be a positive integer no greater than one year",
      });
      expect(mockUpdatePayloads).toHaveLength(0);
    }
  );

  test("elevate 时长上限边界：durationSeconds=3600（上限内）→ 204 正常写入", async () => {
    mockFullClientRow = { id: 5, userId: 7, token: "Ctoken", name: "phone", platform: "web" };
    const before = Date.now();

    const response = await client.fetch(
      makeRequest("/5/elevate", {
        method: "POST",
        headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
        body: JSON.stringify({ durationSeconds: 3600 }),
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(204);
    expect(mockUpdatePayloads).toHaveLength(1);
    const elevatedUntil = new Date(mockUpdatePayloads[0].elevatedUntil).getTime();
    expect(elevatedUntil).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(elevatedUntil).toBeLessThanOrEqual(Date.now() + 3_600_000 + 5_000);
  });
});
