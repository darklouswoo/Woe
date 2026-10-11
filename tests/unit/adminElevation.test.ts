















const mockGetAllUsers = jest.fn();
const mockGetUser = jest.fn();
const mockCreateUser = jest.fn();
const mockUpdateUser = jest.fn();
const mockDeleteUser = jest.fn();

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
    getAllUsers: mockGetAllUsers,
    getUser: mockGetUser,
    createUser: mockCreateUser,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
  })),
}));

import { user } from "../../src/routes/user";
import { hashPassword, SESSION_NOT_ELEVATED_MESSAGE } from "../../src/middleware/auth";
import { applications } from "../../src/models/index.ts";


let mockBasicAdminRow: any = null;
let mockBasicNonAdminRow: any = null;

let mockClientTokenRow: any = { id: 5, userId: 7 };

let mockAppTokenRow: any = null;

let mockUserAdminRow: any = { admin: true };

let mockElevationRow: any = null;

let mockUserExistenceRow: any = { id: 7 };

beforeAll(async () => {
  const [adminPass, alicePass] = await Promise.all([
    hashPassword("root-pass"),
    hashPassword("alice-pass"),
  ]);
  mockBasicAdminRow = { id: 1, name: "root", pass: adminPass, admin: true, disabled: false };
  mockBasicNonAdminRow = { id: 2, name: "alice", pass: alicePass, admin: false, disabled: false };
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
  errorDescription: SESSION_NOT_ELEVATED_MESSAGE,
};

const mockEnv: any = { DB: {} };
const mockExecutionCtx: any = {};

function envWith(registration: string): any {
  return { DB: {}, REGISTRATION: registration };
}


const CLIENT_TOKEN_HEADERS = { "x-gotify-key": "Cclient-token" };

beforeEach(() => {
  jest.clearAllMocks();
  mockClientTokenRow = {
    id: 5,
    userId: 7,
    token: "Cclient-token",
    lastUsed: new Date().toISOString(),
    expiresAfterInactivitySeconds: 0,
    expiresAt: null,
  };
  mockAppTokenRow = null;
  mockUserAdminRow = { admin: true };
  mockElevationRow = null;
  mockUserExistenceRow = { id: 7 };
  mockBasicCurrentRow = null;

  const okResponse = () =>
    new Response(JSON.stringify({ id: 1, name: "n" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  mockGetAllUsers.mockImplementation(() =>
    new Response(JSON.stringify([{ id: 1, name: "n" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  mockGetUser.mockImplementation(okResponse);
  mockCreateUser.mockImplementation(okResponse);
  mockUpdateUser.mockImplementation(okResponse);
  mockDeleteUser.mockImplementation(okResponse);


  mockDrizzle.select.mockImplementation((selection: any) => ({
    from: (table: any) => ({
      where: () => ({
        get: () => {
          const keys = selection && typeof selection === "object" ? Object.keys(selection) : [];

          if (keys.includes("pass")) return Promise.resolve(mockBasicCurrentRow);



          if (keys.length === 1 && keys.includes("elevatedUntil")) return Promise.resolve(mockElevationRow);
          if (keys.includes("id") && keys.includes("userId")) {
            return Promise.resolve(table === applications ? mockAppTokenRow : mockClientTokenRow);
          }
          if (keys.length === 1 && keys.includes("admin")) return Promise.resolve(mockUserAdminRow);
          if (keys.length === 1 && keys.includes("id")) return Promise.resolve(mockUserExistenceRow);
          return Promise.resolve(null);
        },
        all: () => Promise.resolve([]),
      }),
    }),
  }));
});


let mockBasicCurrentRow: any = null;

describe("GET /user 提升守卫", () => {
  test("未提升 client token(admin) GET /user → 403 SESSION_NOT_ELEVATED", async () => {
    mockElevationRow = { elevatedUntil: null };

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });

  test("提升后 client token(admin) GET /user → 200", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockGetAllUsers).toHaveBeenCalledTimes(1);
  });

  test("Basic admin GET /user → 200（Basic 恒提升）", async () => {
    mockBasicCurrentRow = mockBasicAdminRow;

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: basicAuthHeader("root", "root-pass") }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockGetAllUsers).toHaveBeenCalledTimes(1);
  });

  test("非 admin 提升 token GET /user → 403", async () => {
    mockUserAdminRow = { admin: false };
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });

  test("非 admin Basic GET /user → 403", async () => {
    mockBasicCurrentRow = mockBasicNonAdminRow;

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: basicAuthHeader("alice", "alice-pass") }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });
});

describe("POST /user/:id 与 DELETE /user/:id 提升守卫（同上三态）", () => {
  const updateBody = JSON.stringify({ name: "bob", admin: false });

  test("POST /user/:id：未提升 admin client token → 403 SESSION_NOT_ELEVATED", async () => {
    mockElevationRow = { elevatedUntil: null };

    const response = await user.fetch(
      makeRequest("/5", {
        method: "POST",
        headers: { "content-type": "application/json", ...CLIENT_TOKEN_HEADERS },
        body: updateBody,
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test("POST /user/:id：提升后 admin client token → 200", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await user.fetch(
      makeRequest("/5", {
        method: "POST",
        headers: { "content-type": "application/json", ...CLIENT_TOKEN_HEADERS },
        body: updateBody,
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith("5", { name: "bob", admin: false });
  });

  test("POST /user/:id：Basic admin → 200（Basic 恒提升）", async () => {
    mockBasicCurrentRow = mockBasicAdminRow;

    const response = await user.fetch(
      makeRequest("/5", {
        method: "POST",
        headers: { "content-type": "application/json", ...basicAuthHeader("root", "root-pass") },
        body: updateBody,
      }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith("5", { name: "bob", admin: false });
  });

  test("DELETE /user/:id：未提升 admin client token → 403 SESSION_NOT_ELEVATED", async () => {
    mockElevationRow = { elevatedUntil: null };

    const response = await user.fetch(
      makeRequest("/5", { method: "DELETE", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  test("DELETE /user/:id：提升后 admin client token → 200", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await user.fetch(
      makeRequest("/5", { method: "DELETE", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith("5");
  });

  test("DELETE /user/:id：Basic admin → 200（Basic 恒提升）", async () => {
    mockBasicCurrentRow = mockBasicAdminRow;

    const response = await user.fetch(
      makeRequest("/5", { method: "DELETE", headers: basicAuthHeader("root", "root-pass") }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith("5");
  });
});

describe("GET /user/:id 自查路径（Woe 扩展：维持不提升）", () => {
  test("非 admin 自查（tokenInfo.userId === id）无需提升 → 200", async () => {
    mockUserAdminRow = { admin: false };
    mockElevationRow = { elevatedUntil: null };

    const response = await user.fetch(
      makeRequest("/7", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockGetUser).toHaveBeenCalledWith("7");
  });

  test("非 admin 查看他人 → 403", async () => {
    mockUserAdminRow = { admin: false };
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await user.fetch(
      makeRequest("/9", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test("admin client token 未提升时查看他人 → 403 SESSION_NOT_ELEVATED", async () => {
    mockElevationRow = { elevatedUntil: null };

    const response = await user.fetch(
      makeRequest("/9", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test("admin client token 提升后查看他人 → 200", async () => {
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const response = await user.fetch(
      makeRequest("/9", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockGetUser).toHaveBeenCalledWith("9");
  });
});

describe("POST /user 创建守卫（v3.1.1 OptionalAdmin 语义）", () => {
  const body = (admin: boolean) =>
    JSON.stringify({ name: "bob", pass: "secret", admin });

  test("admin client token 未提升时 POST /user（admin=false）→ 403 SESSION_NOT_ELEVATED", async () => {
    mockElevationRow = { elevatedUntil: null };

    const response = await user.fetch(
      makeRequest("/", {
        method: "POST",
        headers: { "content-type": "application/json", ...CLIENT_TOKEN_HEADERS },
        body: body(false),
      }),
      envWith("false"),
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(ELEVATION_403_BODY);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test.each([true, false])(
    "admin client token 提升后 POST /user（admin=%s）→ 200",
    async (adminFlag) => {
      mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

      const response = await user.fetch(
        makeRequest("/", {
          method: "POST",
          headers: { "content-type": "application/json", ...CLIENT_TOKEN_HEADERS },
          body: body(adminFlag),
        }),
        envWith("false"),
        mockExecutionCtx
      );

      expect(response.status).toBe(200);
      expect(mockCreateUser).toHaveBeenCalledWith(
        "bob",
        "secret",
        adminFlag,
        undefined,
        undefined,
        undefined
      );
    }
  );

  test.each(["true", "false"])(
    "非 admin Basic POST /user（REGISTRATION=%s）→ 403",
    async (registration) => {
      mockBasicCurrentRow = mockBasicNonAdminRow;

      const response = await user.fetch(
        makeRequest("/", {
          method: "POST",
          headers: { "content-type": "application/json", ...basicAuthHeader("alice", "alice-pass") },
          body: body(false),
        }),
        envWith(registration),
        mockExecutionCtx
      );

      expect(response.status).toBe(403);
      expect(mockCreateUser).not.toHaveBeenCalled();
    }
  );

  test.each(["true", "false"])(
    "非 admin 已提升 client token POST /user（REGISTRATION=%s）→ 403",
    async (registration) => {
      mockUserAdminRow = { admin: false };
      mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

      const response = await user.fetch(
        makeRequest("/", {
          method: "POST",
          headers: { "content-type": "application/json", ...CLIENT_TOKEN_HEADERS },
          body: body(false),
        }),
        envWith(registration),
        mockExecutionCtx
      );

      expect(response.status).toBe(403);
      expect(mockCreateUser).not.toHaveBeenCalled();
    }
  );

  test("POST /user 匿名注册关闭（admin=false）→ 401", async () => {
    const response = await user.fetch(
      makeRequest("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body(false),
      }),
      envWith("false"),
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test("POST /user 匿名注册（开放）admin=true → 401 固定文案（绝不静默钳制）", async () => {
    const response = await user.fetch(
      makeRequest("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body(true),
      }),
      envWith("true"),
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      errorCode: 401,
      errorDescription: "you are not allowed to create an admin user",
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test("POST /user 匿名注册（开放）admin=false → 200 创建普通用户", async () => {
    const response = await user.fetch(
      makeRequest("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body(false),
      }),
      envWith("true"),
      mockExecutionCtx
    );

    expect(response.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledWith(
      "bob",
      "secret",
      false,
      undefined,
      undefined,
      undefined
    );
  });
});

describe("孤儿 client（checkClientAdmin）", () => {
  test("孤儿 client token（用户已删除）GET /user → 403 而非 500", async () => {


    mockUserAdminRow = null;
    mockUserExistenceRow = null;

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    const json: any = await response.json();
    expect(json.errorCode).toBe(403);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });

  test("孤儿 client token POST /user（注册开放）→ 403 而非 500", async () => {
    mockUserAdminRow = null;
    mockUserExistenceRow = null;

    const response = await user.fetch(
      makeRequest("/", {
        method: "POST",
        headers: { "content-type": "application/json", ...CLIENT_TOKEN_HEADERS },
        body: JSON.stringify({ name: "bob", pass: "secret", admin: false }),
      }),
      envWith("true"),
      mockExecutionCtx
    );

    expect(response.status).toBe(403);
    const json: any = await response.json();
    expect(json.errorCode).toBe(403);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test("禁用用户的 client（用户行存在但 disabled）不是孤儿 → 401 保持既有拒绝", async () => {

    mockUserAdminRow = null;
    mockUserExistenceRow = { id: 7, disabled: true };

    const response = await user.fetch(
      makeRequest("/", { method: "GET", headers: CLIENT_TOKEN_HEADERS }),
      mockEnv,
      mockExecutionCtx
    );

    expect(response.status).toBe(401);
    expect(mockGetAllUsers).not.toHaveBeenCalled();
  });
});
