
















const mockUpdateApplicationSecurity = jest.fn();
const mockRegenerateApplicationToken = jest.fn();

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
    deleteApplication: jest.fn(),
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

import { application } from "../../src/routes/application";
import { hashPassword } from "../../src/middleware/auth";


let mockBasicUserRow: any = null;

let mockElevationRow: any = null;

let mockClientTokenRow: any = { id: 5, userId: 7 };

beforeAll(async () => {
  const pass = await hashPassword("correct-horse");
  mockBasicUserRow = { id: 7, name: "alice", pass, admin: false, disabled: false };
});

function basicAuthHeader(username: string, password: string): Record<string, string> {
  return { authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64") };
}

function securityRequest(body: string, headers: Record<string, string> = basicAuthHeader("alice", "correct-horse")): Request {
  return new Request("http://localhost/5/security", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
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


  mockUpdateApplicationSecurity.mockImplementation(
    () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
  );
  mockRegenerateApplicationToken.mockImplementation(
    () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
  );



  mockDrizzle.select.mockImplementation((selection: any) => ({
    from: () => ({
      where: () => ({
        get: () => {
          const keys = selection && typeof selection === "object" ? Object.keys(selection) : [];
          if (keys.includes("pass")) return Promise.resolve(mockBasicUserRow);
          if (keys.length === 1 && keys.includes("elevatedUntil")) return Promise.resolve(mockElevationRow);
          if (keys.length === 1 && keys.includes("admin")) return Promise.resolve({ admin: false });
          if (keys.includes("token") && !keys.includes("name")) return Promise.resolve(mockClientTokenRow);
          return Promise.resolve(null);
        },
        all: () => Promise.resolve([]),
      }),
    }),
  }));
});

describe("PUT /application/:id/security 动作解析与分派", () => {
  test.each([
    ["缺省", "{}"],
    ["false", '{"regenerateToken": false}'],
    ["null", '{"regenerateToken": null}'],
  ])("Basic + regenerateToken %s → 分派无操作 (7, \"5\", false)，透传 200 {}", async (_name, body) => {
    const response = await application.fetch(securityRequest(body), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
    expect(mockUpdateApplicationSecurity).toHaveBeenCalledTimes(1);
    expect(mockUpdateApplicationSecurity).toHaveBeenCalledWith(7, "5", false);
    expect(mockRegenerateApplicationToken).not.toHaveBeenCalled();
  });

  test("Basic + regenerateToken true → 分派轮换 (7, \"5\", true)", async () => {
    const response = await application.fetch(
      securityRequest('{"regenerateToken": true}'),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateApplicationSecurity).toHaveBeenCalledTimes(1);
    expect(mockUpdateApplicationSecurity).toHaveBeenCalledWith(7, "5", true);
  });

  test("已提升 client token + regenerateToken false → 分派无操作 (7, \"5\", false)", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await application.fetch(
      securityRequest('{"regenerateToken": false}', { "x-gotify-key": "Cclient-token" }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateApplicationSecurity).toHaveBeenCalledWith(7, "5", false);
  });

  test.each([
    ["字符串", '"true"'],
    ["数字", "1"],
    ["对象", "{}"],
    ["数组", "[]"],
  ])("regenerateToken 为%s → 400，不进入 handler", async (_name, value) => {
    const response = await application.fetch(
      securityRequest(`{"regenerateToken": ${value}}`),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(400);
    expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
  });

  test.each([
    ["顶层 null", "null"],
    ["顶层数组", "[1,2]"],
    ["顶层字符串", '"x"'],
    ["顶层数字", "42"],
    ["顶层布尔", "true"],
    ["非法 JSON", "{bad"],
  ])("%s → 400，不进入 handler", async (_name, body) => {
    const response = await application.fetch(securityRequest(body), mockEnv, mockExecutionCtx);

    expect(response.status).toBe(400);
    expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
  });
});

describe("PUT /application/:id/security 守卫（两种动作一致）", () => {
  test.each([["false", '{"regenerateToken": false}'], ["true", '{"regenerateToken": true}']])(
    "未提升 client token + regenerateToken %s → 403 gotify 精确消息，不分派",
    async (_name, body) => {
      mockElevationRow = null;

      const response = await application.fetch(
        securityRequest(body, { "x-gotify-key": "Cclient-token" }),
        mockEnv,
        mockExecutionCtx
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
      expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
    }
  );

  test.each([["false", '{"regenerateToken": false}'], ["true", '{"regenerateToken": true}']])(
    "无凭据 + regenerateToken %s → 401 Client token or Basic auth required（未认证先于提权判定），不分派",
    async (_name, body) => {
      const response = await application.fetch(securityRequest(body, {}), mockEnv, mockExecutionCtx);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized",
        errorCode: 401,
        errorDescription: "Client token or Basic auth required",
      });
      expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
    }
  );

  test.each([["false", '{"regenerateToken": false}'], ["true", '{"regenerateToken": true}']])(
    "坏 Basic + regenerateToken %s → 401，不分派",
    async (_name, body) => {
      const response = await application.fetch(
        securityRequest(body, basicAuthHeader("alice", "wrong-password")),
        mockEnv,
        mockExecutionCtx
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized",
        errorCode: 401,
        errorDescription: "Client token or Basic auth required",
      });
      expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["坏 client token", { "x-gotify-key": "Cno-such-token" }, "client-token-lookup-null"],
    ["app token", { "x-gotify-key": "Aapp-token" }, "app-token"],
  ])("%s + regenerateToken true → 401，不分派", async (_name, headers, mode) => {
    if (mode === "client-token-lookup-null") mockClientTokenRow = null;

    const response = await application.fetch(
      securityRequest('{"regenerateToken": true}', headers),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "Client token or Basic auth required",
    });
    expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
  });

  test.each([["false", '{"regenerateToken": false}'], ["true", '{"regenerateToken": true}']])(
    "非法 id + regenerateToken %s → 400（参数校验前置），不分派",
    async (_name, body) => {
      const response = await application.fetch(
        new Request("http://localhost/abc/security", {
          method: "PUT",
          headers: { "content-type": "application/json", ...basicAuthHeader("alice", "correct-horse") },
          body,
        }),
        mockEnv,
        mockExecutionCtx
      );

      expect(response.status).toBe(400);
      const body_ = await response.json() as any;
      expect(body_.errorDescription).toBe("Invalid id parameter: must be a positive integer");
      expect(mockUpdateApplicationSecurity).not.toHaveBeenCalled();
    }
  );

  test.each([["false", '{"regenerateToken": false}'], ["true", '{"regenerateToken": true}']])(
    "非属主/不存在 + regenerateToken %s → 透传 handler 的 404（资源检查不可绕过）",
    async (_name, body) => {
      mockUpdateApplicationSecurity.mockImplementation(
        () => new Response(JSON.stringify({ error: "Not Found", errorCode: 404, errorDescription: "Application not found or no permission" }), { status: 404, headers: { "Content-Type": "application/json" } })
      );

      const response = await application.fetch(securityRequest(body), mockEnv, mockExecutionCtx);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Not Found",
        errorCode: 404,
        errorDescription: "Application not found or no permission",
      });
      expect(mockUpdateApplicationSecurity).toHaveBeenCalledTimes(1);
    }
  );
});
