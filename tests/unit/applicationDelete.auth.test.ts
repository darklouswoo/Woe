
















const mockDeleteApplication = jest.fn();

const mockDrizzle: any = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock("../../src/drizzle/index.ts", () => ({
  createDrizzle: jest.fn(() => mockDrizzle),
}));

jest.mock("../../src/handlers/applicationHandlers.ts", () => ({
  ApplicationHandlers: jest.fn().mockImplementation(() => ({
    getAllApplications: jest.fn(),
    createApplication: jest.fn(),
    getApplication: jest.fn(),
    updateApplication: jest.fn(),
    deleteApplication: mockDeleteApplication,
    regenerateApplicationToken: jest.fn(),
    updateApplicationSecurity: jest.fn(),
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

import { application } from "../../src/routes/application";
import { hashPassword } from "../../src/middleware/auth";
import { applications } from "../../src/models/index.ts";


let mockBasicUserRow: any = null;

let mockElevationRow: any = null;

let mockClientTokenRow: any = null;

let mockAppTokenRow: any = null;

let mockUserAdminRow: any = { admin: false };

let clientTokenQueryCount = 0;

let basicUserQueryCount = 0;

beforeAll(async () => {
  const pass = await hashPassword("correct-horse");
  mockBasicUserRow = { id: 7, name: "alice", pass, admin: false, disabled: false };
});

function basicAuthHeader(username: string, password: string): Record<string, string> {
  return { authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64") };
}

function deleteRequest(id: string, headers: Record<string, string> = basicAuthHeader("alice", "correct-horse")): Request {
  return new Request(`http://localhost/${id}`, { method: "DELETE", headers });
}

const UNAUTHORIZED_401_BODY = {
  error: "Unauthorized",
  errorCode: 401,
  errorDescription: "Client token or Basic auth required",
};

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
  clientTokenQueryCount = 0;
  basicUserQueryCount = 0;

  mockDeleteApplication.mockImplementation(
    () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
  );


  mockDrizzle.select.mockImplementation((selection: any) => ({
    from: (table: any) => ({
      where: () => ({
        get: () => {
          const keys = selection && typeof selection === "object" ? Object.keys(selection) : [];
          if (keys.includes("pass")) {
            basicUserQueryCount += 1;
            return Promise.resolve(mockBasicUserRow);
          }

          if (keys.includes("token") && !keys.includes("name")) {
            clientTokenQueryCount += 1;
            return Promise.resolve(mockClientTokenRow);
          }
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
});


async function expectZeroSideEffects() {
  expect(mockDeleteApplication).not.toHaveBeenCalled();
  expect(mockDrizzle.update).not.toHaveBeenCalled();
  expect(mockDrizzle.delete).not.toHaveBeenCalled();
  expect(mockDrizzle.insert).not.toHaveBeenCalled();
}

describe("DELETE /application/:id 未认证 → 401（401/403 语义分离）", () => {
  test.each([
    ["无凭据", {}],
    ["坏 Basic（错误口令）", basicAuthHeader("alice", "wrong-password")],
    ["坏 client token", { "x-gotify-key": "Cno-such-token" }],
  ])("%s → 401 Client token or Basic auth required，零副作用", async (_name, headers) => {
    if (_name === "坏 client token") mockClientTokenRow = null;

    const response = await application.fetch(deleteRequest("5", headers as Record<string, string>), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED_401_BODY);
    await expectZeroSideEffects();
  });

  test("闲置过期 client token → 401（validateToken 判过期，按未认证处理）", async () => {
    mockClientTokenRow = {
      id: 5,
      userId: 7,
      token: "Cclient-token",
      lastUsed: new Date(Date.now() - 120_000).toISOString(),
      expiresAfterInactivitySeconds: 60,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    };

    const response = await application.fetch(
      deleteRequest("5", { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED_401_BODY);
    await expectZeroSideEffects();
  });

  test("app token → 401（应用 token 不能作客户端身份删除应用）", async () => {
    mockAppTokenRow = { id: 3, userId: 7 };

    const response = await application.fetch(
      deleteRequest("5", { "x-gotify-key": "Aapp-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(UNAUTHORIZED_401_BODY);
    await expectZeroSideEffects();
  });
});

describe("DELETE /application/:id 已认证未提升 → 403", () => {
  test("有效未提升 client token → 403 gotify 精确消息，零副作用；token 查库仅一次（memo）", async () => {
    mockElevationRow = null;

    const response = await application.fetch(
      deleteRequest("5", { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    await expectZeroSideEffects();

    expect(clientTokenQueryCount).toBe(1);
  });

  test("提升已过期 client token → 403 gotify 精确消息，零副作用", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() - 60_000).toISOString() };

    const response = await application.fetch(
      deleteRequest("5", { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    await expectZeroSideEffects();
  });
});

describe("DELETE /application/:id 通过守卫 → 进入资源校验", () => {
  test("Basic auth → 分派 deleteApplication(7, \"5\")；Basic 用户查库仅一次（memo 单次 KDF）", async () => {
    const response = await application.fetch(deleteRequest("5"), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(200);
    expect(mockDeleteApplication).toHaveBeenCalledTimes(1);
    expect(mockDeleteApplication).toHaveBeenCalledWith(7, "5");
    expect(basicUserQueryCount).toBe(1);
  });

  test("有效提升 client token → 分派 deleteApplication(7, \"5\")", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await application.fetch(
      deleteRequest("5", { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockDeleteApplication).toHaveBeenCalledTimes(1);
    expect(mockDeleteApplication).toHaveBeenCalledWith(7, "5");
    expect(clientTokenQueryCount).toBe(1);
  });

  test("非属主/不存在 → 透传 handler 的 404（资源检查不可绕过）", async () => {
    mockDeleteApplication.mockImplementation(
      () => new Response(
        JSON.stringify({ error: "Not Found", errorCode: 404, errorDescription: "Application not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );

    const response = await application.fetch(deleteRequest("5"), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not Found",
      errorCode: 404,
      errorDescription: "Application not found",
    });
    expect(mockDeleteApplication).toHaveBeenCalledTimes(1);
  });

  test("非法 id → 400（参数校验前置，无需认证），零 handler 调用", async () => {
    const response = await application.fetch(deleteRequest("abc"), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.errorDescription).toBe("Invalid id parameter: must be a positive integer");
    expect(mockDeleteApplication).not.toHaveBeenCalled();
  });
});
