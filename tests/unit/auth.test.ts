import { Authenticator } from "../../src/middleware/auth";

function createDrizzleMock(getResults: unknown[]) {
  const get = jest.fn();
  for (const result of getResults) {
    get.mockResolvedValueOnce(result);
  }

  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get
        }))
      }))
    })),
    __get: get
  };
}

describe("Authenticator", () => {
  describe("extractToken", () => {
    const auth = new Authenticator({} as any);

    test("should extract token from X-Gotify-Key header", () => {
      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "A123456789" }
      });
      const token = (auth as any).extractToken(request);
      expect(token).toBe("A123456789");
    });

    test("should extract token from Authorization Bearer", () => {
      const request = new Request("http://localhost", {
        headers: { Authorization: "Bearer C123456789" }
      });
      const token = (auth as any).extractToken(request);
      expect(token).toBe("C123456789");
    });

    test("should extract token from query parameter", () => {
      const request = new Request("http://localhost?token=querytoken");
      const token = (auth as any).extractToken(request);
      expect(token).toBe("querytoken");
    });

    test("should return null for no token", () => {
      const request = new Request("http://localhost");
      const token = (auth as any).extractToken(request);
      expect(token).toBeNull();
    });
  });

  describe("authenticate", () => {
    test("should authenticate application token", async () => {
      const drizzle = createDrizzleMock([
        { id: 10, userId: 1 },
        { admin: false }
      ]);
      const auth = new Authenticator(drizzle as any);

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "A123456789" }
      });

      const result = await auth.authenticate(request);

      expect(result).toEqual({
        userId: 1,
        isAdmin: false,
        tokenType: "app",
        resourceId: 10
      });
      expect(drizzle.__get).toHaveBeenCalledTimes(2);
    });

    test("should authenticate client token", async () => {
      const drizzle = createDrizzleMock([
        { id: 20, userId: 1, token: "C123456789" },
        { admin: false }
      ]);
      const auth = new Authenticator(drizzle as any);

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "C123456789" }
      });

      const result = await auth.authenticate(request);

      expect(result).toEqual({
        userId: 1,
        isAdmin: false,
        tokenType: "client",
        resourceId: 20,

        clientId: 20,
        elevatedUntil: null,

        clientTokenLookup: "C123456789"
      });
      expect(drizzle.__get).toHaveBeenCalledTimes(2);
    });

    test("should return null for invalid token", async () => {
      const drizzle = createDrizzleMock([null]);
      const auth = new Authenticator(drizzle as any);

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": "invalid" }
      });

      const result = await auth.authenticate(request);
      expect(result).toBeNull();
      expect(drizzle.__get).toHaveBeenCalledTimes(0);
    });

    test("token SELECT 失败（Drizzle 包装错误 message 内嵌绑定参数）→ 日志不含 token 且仍有输出", async () => {
      const token = "C" + Math.random().toString(36).slice(2, 24);
      const drizzle = createDrizzleMock([]);
      drizzle.__get.mockRejectedValueOnce(
        new Error(`Failed query: select ... where "token" = ?\nparams: ${token}`)
      );
      const auth = new Authenticator(drizzle as any);
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const request = new Request("http://localhost", {
        headers: { "X-Gotify-Key": token }
      });

      const result = await auth.authenticate(request);

      expect(result).toBeNull();
      const captured = errorSpy.mock.calls
        .map((args) => args.map((a: unknown) => String(a)).join(" "))
        .join("\n");
      errorSpy.mockRestore();
      expect(captured).not.toContain(token);
      expect(captured).toContain("Token validation error");
      expect(captured.length).toBeGreaterThan("Token validation error".length);
    });
  });

  describe("requireClient", () => {
    test("should accept basic auth as client-compatible authentication", async () => {
      const auth = new Authenticator({} as any);
      const basicUser = { id: 9, admin: true };
      jest.spyOn(auth, "authenticateBasic").mockResolvedValue(basicUser as any);

      const result = await auth.requireClient(
        new Request("http://localhost", {
          headers: { Authorization: "Basic Zm9vOmJhcg==" }
        }),
        {} as any
      );

      expect(result).toEqual({
        userId: 9,
        isAdmin: true,
        tokenType: "client"
      });
    });

    test("should accept client token", async () => {
      const auth = new Authenticator({} as any);
      jest.spyOn(auth, "authenticateBasic").mockResolvedValue(null);
      jest.spyOn(auth, "authenticate").mockResolvedValue({
        userId: 5,
        isAdmin: false,
        tokenType: "client",
        resourceId: 12
      });

      const result = await auth.requireClient(
        new Request("http://localhost", {
          headers: { "X-Gotify-Key": "C123456789" }
        }),
        {} as any
      );

      expect(result).toEqual({
        userId: 5,
        isAdmin: false,
        tokenType: "client",
        resourceId: 12
      });
    });

    test("should reject app token", async () => {
      const auth = new Authenticator({} as any);
      jest.spyOn(auth, "authenticateBasic").mockResolvedValue(null);
      jest.spyOn(auth, "authenticate").mockResolvedValue({
        userId: 5,
        isAdmin: true,
        tokenType: "app",
        resourceId: 7
      });

      const result = await auth.requireClient(
        new Request("http://localhost", {
          headers: { "X-Gotify-Key": "A123456789" }
        }),
        {} as any
      );

      expect(result).toBeNull();
    });
  });
});
