import { Authenticator, hashPassword, verifyPassword, isLegacyPasswordHash, needsIterationUpgrade } from "../../src/middleware/auth";


async function buildPbkdf2Hash(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 256);
  const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `$pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

describe("PBKDF2 口令哈希（对齐 gotify bcrypt 的 KDF 强度意图）", () => {
  test("新哈希为 $pbkdf2$ 格式且可校验通过", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^\$pbkdf2\$30000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPassword(stored, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(stored, "wrong")).toBe(false);
  });

  test("每个哈希盐值独立", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");
    expect(a).not.toBe(b);
  });

  test("遗留 $sha256$ 哈希仍可校验（迁移窗口）", async () => {
    const saltHex = "00112233445566778899aabbccddeeff";
    const data = new TextEncoder().encode("legacy-password" + saltHex);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const legacy = `$sha256$${saltHex}$${hashHex}`;
    expect(await verifyPassword(legacy, "legacy-password")).toBe(true);
    expect(await verifyPassword(legacy, "nope")).toBe(false);
  });

  test("跨迭代兼容：已存 600k 哈希仍可校验（格式自描述迭代数）", async () => {
    const stored = await buildPbkdf2Hash("pw", "00112233445566778899aabbccddeeff", 600_000);
    expect(stored).toMatch(/^\$pbkdf2\$600000\$/);
    expect(await verifyPassword(stored, "pw")).toBe(true);
    expect(await verifyPassword(stored, "wrong")).toBe(false);
  });

  test("畸形哈希按验证失败处理，不抛异常", async () => {
    const malformed = [
      "$pbkdf2$abc$00112233445566778899aabbccddeeff$" + "0".repeat(64),
      "$pbkdf2$60000x$00112233445566778899aabbccddeeff$" + "0".repeat(64),
      "$pbkdf2$9999$00112233445566778899aabbccddeeff$" + "0".repeat(64),
      "$pbkdf2$9999999$00112233445566778899aabbccddeeff$" + "0".repeat(64),
      "$pbkdf2$30000$nothexsalt$" + "0".repeat(64),
      "$pbkdf2$30000$00112233445566778899aabbccddeeff$zz",
      "$sha256$short$abc",
      "$sha256$00112233445566778899aabbccddeeff$short",
      "$weird$format",
    ];
    for (const m of malformed) {
      await expect(verifyPassword(m, "anything")).resolves.toBe(false);
    }
  });

  test("未知格式一律拒绝（含明文）", async () => {
    expect(await verifyPassword("plaintext", "plaintext")).toBe(false);
  });

  test("isLegacyPasswordHash 仅识别 $sha256$", async () => {
    expect(isLegacyPasswordHash("$sha256$a$b")).toBe(true);
    expect(isLegacyPasswordHash("$pbkdf2$30000$a$b")).toBe(false);
    expect(isLegacyPasswordHash("plaintext")).toBe(false);
  });

  test("needsIterationUpgrade 只升不降：仅低于当前默认迭代数时需要升级", () => {
    const saltHash = (iter: string) => `$pbkdf2$${iter}$00112233445566778899aabbccddeeff$` + "0".repeat(64);
    expect(needsIterationUpgrade(saltHash("600000"))).toBe(false);
    expect(needsIterationUpgrade(saltHash("30000"))).toBe(false);
    expect(needsIterationUpgrade(saltHash("10000"))).toBe(true);
    expect(needsIterationUpgrade(saltHash("9999"))).toBe(true);
    expect(needsIterationUpgrade("$sha256$00112233445566778899aabbccddeeff$" + "0".repeat(64))).toBe(false);
    expect(needsIterationUpgrade(saltHash("abc"))).toBe(false);
    expect(needsIterationUpgrade("plaintext")).toBe(false);
  });
});

describe("登录透明重哈希（authenticateBasic 内）", () => {



  test("遗留哈希登录成功后写入 PBKDF2 新哈希", async () => {

    const saltHex = "00112233445566778899aabbccddeeff";
    const data = new TextEncoder().encode("legacy-pass" + saltHex);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const legacyHash = `$sha256$${saltHex}$${hashHex}`;

    const setCapture: any[] = [];
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: legacyHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((payload: any) => {
          setCapture.push(payload);
          return { where: jest.fn(() => Promise.resolve({ meta: { changes: 1 } })) };
        }),
      })),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:legacy-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any);
    expect(user).not.toBeNull();
    expect(setCapture.length).toBe(1);
    expect(setCapture[0].pass).toMatch(/^\$pbkdf2\$30000\$/);
  });

  test("PBKDF2 哈希登录成功后不触发重哈希 update", async () => {
    const freshHash = await hashPassword("modern-pass");
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: freshHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:modern-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any);
    expect(user).not.toBeNull();
    expect(drizzle.update).not.toHaveBeenCalled();
  });

  test("600k 高迭代哈希登录成功后不触发重哈希（防降级）", async () => {
    const strongHash = await buildPbkdf2Hash("strong-pass", "00112233445566778899aabbccddeeff", 600_000);
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: strongHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:strong-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any);
    expect(user).not.toBeNull();
    expect(drizzle.update).not.toHaveBeenCalled();
  });

  test("10k 低迭代哈希登录成功后触发重哈希为 $pbkdf2$30000$（只升不降）", async () => {
    const weakHash = await buildPbkdf2Hash("weak-pass", "00112233445566778899aabbccddeeff", 10_000);
    const setCapture: any[] = [];
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: weakHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((payload: any) => {
          setCapture.push(payload);
          return { where: jest.fn(() => Promise.resolve({ meta: { changes: 1 } })) };
        }),
      })),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:weak-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any);
    expect(user).not.toBeNull();
    expect(setCapture.length).toBe(1);
    expect(setCapture[0].pass).toMatch(/^\$pbkdf2\$30000\$/);
  });

  test("skipRehash: true 时跳过登录重哈希（口令即将被路由覆写，省一次 KDF 派生）", async () => {
    const weakHash = await buildPbkdf2Hash("weak-pass", "00112233445566778899aabbccddeeff", 10_000);
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: weakHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:weak-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any, { skipRehash: true });
    expect(user).not.toBeNull();
    expect(user!.name).toBe("u");
    expect(drizzle.update).not.toHaveBeenCalled();
  });

  test("skipRehash: false 显式关闭时仍走默认重哈希路径", async () => {
    const weakHash = await buildPbkdf2Hash("weak-pass", "00112233445566778899aabbccddeeff", 10_000);
    const setCapture: any[] = [];
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: weakHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn((payload: any) => {
          setCapture.push(payload);
          return { where: jest.fn(() => Promise.resolve({ meta: { changes: 1 } })) };
        }),
      })),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:weak-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any, { skipRehash: false });
    expect(user).not.toBeNull();
    expect(setCapture.length).toBe(1);
    expect(setCapture[0].pass).toMatch(/^\$pbkdf2\$30000\$/);
  });

  test("重哈希失败不阻断登录（update 抛错仍返回用户）", async () => {
    const saltHex = "00112233445566778899aabbccddeeff";
    const data = new TextEncoder().encode("legacy-pass" + saltHex);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hashHex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const legacyHash = `$sha256$${saltHex}$${hashHex}`;
    const drizzle: any = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ id: 5, name: "u", pass: legacyHash, admin: false, disabled: false }),
          })),
        })),
      })),
      update: jest.fn(() => { throw new Error("D1 transient failure"); }),
    };
    const auth = new Authenticator(drizzle as any);
    const req = new Request("https://woe.example/client", {
      headers: { Authorization: `Basic ${btoa("u:legacy-pass")}` },
    });
    const user = await auth.authenticateBasic(req, {} as any);
    expect(user).not.toBeNull();
  });
});
