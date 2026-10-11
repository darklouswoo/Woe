









import { Authenticator } from "../../src/middleware/auth";
import { ClientHandlers } from "../../src/handlers/clientHandlers";


let mockElevationRow: any = null;

function createAuthDrizzleMock() {
  return {
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          get: () => Promise.resolve(mockElevationRow),
        }),
      }),
    })),
  };
}

const baseRequest = () => new Request("http://localhost/client/5/elevate");

function makeAuthenticator(drizzle: any) {
  const authenticator = new Authenticator(drizzle as any);
  return {
    authenticator,
    basicSpy: jest.spyOn(authenticator, "authenticateBasic"),
    authenticateSpy: jest.spyOn(authenticator, "authenticate"),
  };
}

describe("Authenticator.requireElevatedClient（gotify RequireElevatedClient 语义）", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockElevationRow = null;
  });

  test("Basic 认证：直接视为已提升身份，不做 token/elevated_until 查询", async () => {
    const drizzle = createAuthDrizzleMock();
    const { authenticator, basicSpy, authenticateSpy } = makeAuthenticator(drizzle);
    basicSpy.mockResolvedValue({ id: 7, name: "alice", pass: "x", admin: true } as any);
    authenticateSpy.mockResolvedValue(null as any);

    const result = await authenticator.requireElevatedClient(baseRequest(), {} as any);

    expect(result).toEqual({ userId: 7, isAdmin: true, tokenType: "client" });
    expect(basicSpy).toHaveBeenCalledTimes(1);
    expect(authenticateSpy).not.toHaveBeenCalled();
    expect(drizzle.select).not.toHaveBeenCalled();
  });

  test("client token + 未过期 elevatedUntil：返回原 tokenInfo", async () => {
    const drizzle = createAuthDrizzleMock();
    const { authenticator, basicSpy, authenticateSpy } = makeAuthenticator(drizzle);
    basicSpy.mockResolvedValue(null as any);
    const tokenInfo = { userId: 7, isAdmin: false, tokenType: "client" as const, resourceId: 5 };
    authenticateSpy.mockResolvedValue(tokenInfo as any);
    mockElevationRow = { elevatedUntil: new Date(Date.now() + 60_000).toISOString() };

    const result = await authenticator.requireElevatedClient(baseRequest(), {} as any);

    expect(result).toBe(tokenInfo);
    expect(drizzle.select).toHaveBeenCalledTimes(1);
  });

  test("client token + 无提升记录（行缺失或 elevatedUntil 为 null）：null", async () => {
    const drizzle = createAuthDrizzleMock();
    const { authenticator, basicSpy, authenticateSpy } = makeAuthenticator(drizzle);
    basicSpy.mockResolvedValue(null as any);
    authenticateSpy.mockResolvedValue({
      userId: 7,
      isAdmin: false,
      tokenType: "client",
      resourceId: 5,
    } as any);
    mockElevationRow = null;

    expect(await authenticator.requireElevatedClient(baseRequest(), {} as any)).toBeNull();

    mockElevationRow = { elevatedUntil: null };
    expect(await authenticator.requireElevatedClient(baseRequest(), {} as any)).toBeNull();
  });

  test("client token + 已过期 elevatedUntil：null", async () => {
    const drizzle = createAuthDrizzleMock();
    const { authenticator, basicSpy, authenticateSpy } = makeAuthenticator(drizzle);
    basicSpy.mockResolvedValue(null as any);
    authenticateSpy.mockResolvedValue({
      userId: 7,
      isAdmin: false,
      tokenType: "client",
      resourceId: 5,
    } as any);
    mockElevationRow = { elevatedUntil: new Date(Date.now() - 60_000).toISOString() };

    expect(await authenticator.requireElevatedClient(baseRequest(), {} as any)).toBeNull();
  });

  test("非 client token（app token / 无认证）：null，不查 elevated_until", async () => {
    const drizzle = createAuthDrizzleMock();
    const { authenticator, basicSpy, authenticateSpy } = makeAuthenticator(drizzle);
    basicSpy.mockResolvedValue(null as any);
    authenticateSpy.mockResolvedValue({
      userId: 7,
      isAdmin: false,
      tokenType: "app",
      resourceId: 5,
    } as any);

    expect(await authenticator.requireElevatedClient(baseRequest(), {} as any)).toBeNull();

    authenticateSpy.mockResolvedValue(null as any);
    expect(await authenticator.requireElevatedClient(baseRequest(), {} as any)).toBeNull();
    expect(drizzle.select).not.toHaveBeenCalled();
  });
});


function createHandlerDrizzleMock(existingClient: any | null) {
  const state = { updatePayload: null as any, updateCalls: 0 };
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  return {
    __state: state,
    __errorSpy: errorSpy,
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          get: () => Promise.resolve(existingClient),
        }),
      }),
    })),
    update: jest.fn(() => ({
      set: (payload: any) => {
        state.updatePayload = payload;
        return {
          where: () => {
            state.updateCalls += 1;
            return Promise.resolve(undefined);
          },
        };
      },
    })),
  };
}

const ownClientRow = {
  id: 5,
  userId: 7,
  token: "Ctoken",
  name: "phone",
  platform: "web",
};

describe("ClientHandlers.elevateClient（gotify POST /client/{id}/elevate）", () => {
  test.each([0, -5, 1.5, NaN])("非法 durationSeconds=%p → 400", async (duration) => {
    const drizzle = createHandlerDrizzleMock(ownClientRow);
    const handlers = new ClientHandlers(drizzle as any);

    const res = await handlers.elevateClient(7, "5", duration);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Bad Request",
      errorCode: 400,
      errorDescription: "durationSeconds must be a positive integer",
    });
    expect(drizzle.__state.updateCalls).toBe(0);
    drizzle.__errorSpy.mockRestore();
  });

  test("非属主/不存在的 client → 404，不写 elevatedUntil", async () => {
    const drizzle = createHandlerDrizzleMock(null);
    const handlers = new ClientHandlers(drizzle as any);

    const res = await handlers.elevateClient(7, "9", 60);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Not Found",
      errorCode: 404,
      errorDescription: "Client not found",
    });
    expect(drizzle.__state.updateCalls).toBe(0);
    drizzle.__errorSpy.mockRestore();
  });

  test("属主 client + durationSeconds=60 → 204，elevatedUntil ≈ now+60s（ISO）", async () => {
    const drizzle = createHandlerDrizzleMock(ownClientRow);
    const handlers = new ClientHandlers(drizzle as any);
    const before = Date.now();

    const res = await handlers.elevateClient(7, "5", 60);

    expect(res.status).toBe(204);
    expect(res.bodyUsed).toBe(false);
    expect(drizzle.__state.updateCalls).toBe(1);
    const elevatedUntil = new Date(drizzle.__state.updatePayload.elevatedUntil).getTime();
    expect(elevatedUntil).toBeGreaterThanOrEqual(before + 60_000);
    expect(elevatedUntil).toBeLessThanOrEqual(Date.now() + 60_000 + 5_000);
    drizzle.__errorSpy.mockRestore();
  });

  test("数据库异常 → 500 通用错误", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const drizzle: any = {
      select: jest.fn(() => ({
        from: () => ({
          where: () => ({
            get: () => Promise.reject(new Error("d1-down")),
          }),
        }),
      })),
    };
    const handlers = new ClientHandlers(drizzle as any);

    const res = await handlers.elevateClient(7, "5", 60);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Database error",
      errorCode: 500,
      errorDescription: "Failed to elevate client",
    });
    errorSpy.mockRestore();
  });
});
