


















import { ed25519, ed25519ph } from "@noble/curves/ed25519.js";

jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true });

import {
  generateEnhancedToken,
  resolveTokenForLookup,
  base64UrlEncode,
  base64UrlDecode
} from "../../src/utils/enhancedToken";
import { Authenticator } from "../../src/middleware/auth";
import { ApplicationHandlers } from "../../src/handlers/applicationHandlers";
import { ClientHandlers } from "../../src/handlers/clientHandlers";
import { createTestDb, asDrizzle, seedClient } from "../helpers/testDb";
import { clients } from "../../src/models";
import { eq } from "drizzle-orm";

const PUBLIC_OR_PRIVATE_RE = /^gtfy[ac]\.[A-Za-z0-9\-_]{43}$/;


function signFourFieldToken(privateForm: string, iat: number): string {
  const dot = privateForm.indexOf(".");
  const prefix = privateForm.slice(0, dot);
  const seed = base64UrlDecode(privateForm.slice(dot + 1));
  if (!seed) throw new Error("test setup: privateForm seed 不可解码");
  const publicKey = ed25519.getPublicKey(seed);
  const sig = ed25519ph.sign(new TextEncoder().encode(`iat=${iat}`), seed);
  return `${prefix}.${base64UrlEncode(publicKey)}.${iat}.${base64UrlEncode(sig)}`;
}


function makeAuthFixture() {
  const testDb = createTestDb();
  testDb.sqlite
    .prepare("INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)")
    .run(7, "user7", 0, 0);
  testDb.sqlite.exec(
    "CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, user_id INTEGER NOT NULL, token TEXT NOT NULL, name TEXT NOT NULL DEFAULT '')"
  );
  return testDb;
}

function seedApplication(testDb: ReturnType<typeof createTestDb>, userId: number, token: string): number {
  const row = testDb.sqlite
    .prepare("INSERT INTO applications (user_id, token, name) VALUES (?, ?, ?)")
    .run(userId, token, "app");
  return Number(row.lastInsertRowid);
}

afterEach(() => {
  jest.useRealTimers();
});

describe("generateEnhancedToken / resolveTokenForLookup", () => {
  test("生成格式：public/private form 分别为 ^gtfy[a|c]\\.[A-Za-z0-9-_]{43}$", () => {
    for (const [kind, ident] of [["app", "a"], ["client", "c"]] as const) {
      const { publicForm, privateForm } = generateEnhancedToken(kind);
      expect(publicForm).toMatch(PUBLIC_OR_PRIVATE_RE);
      expect(privateForm).toMatch(PUBLIC_OR_PRIVATE_RE);
      expect(publicForm.startsWith(`gtfy${ident}.`)).toBe(true);
      expect(privateForm.startsWith(`gtfy${ident}.`)).toBe(true);

      expect(publicForm).not.toBe(privateForm);
    }
  });

  test("privateForm 解析派生的 publicForm 与生成时一致", async () => {
    for (const kind of ["app", "client"] as const) {
      const { publicForm, privateForm } = generateEnhancedToken(kind);
      await expect(resolveTokenForLookup(privateForm)).resolves.toBe(publicForm);
    }
  });

  test("旧 C…/A… token 原样透传", async () => {
    await expect(resolveTokenForLookup("Alegacytoken123")).resolves.toBe("Alegacytoken123");
    await expect(resolveTokenForLookup("Clegacytoken456")).resolves.toBe("Clegacytoken456");
    await expect(resolveTokenForLookup("Pplugintoken789")).resolves.toBe("Pplugintoken789");
  });

  test("gtfya 与 gtfyc 四段式合法签名（iat=now）解析成功", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const kind of ["app", "client"] as const) {
      const { publicForm, privateForm } = generateEnhancedToken(kind);
      const fourField = signFourFieldToken(privateForm, nowSec);
      expect(fourField.split(".")).toHaveLength(4);
      await expect(resolveTokenForLookup(fourField)).resolves.toBe(publicForm);
    }
  });

  test("publicForm 作为两段式凭据不应被误接受", async () => {
    const testDb = makeAuthFixture();
    const { publicForm } = generateEnhancedToken("client");
    const seeded = seedClient(testDb, { userId: 7, token: publicForm });


    const resolved = await resolveTokenForLookup(publicForm);
    expect(resolved).not.toBeNull();
    expect(resolved).not.toBe(publicForm);


    const auth = new Authenticator(asDrizzle(testDb));
    const request = new Request("http://localhost/message", {
      headers: { "X-Gotify-Key": publicForm }
    });
    await expect(auth.authenticate(request)).resolves.toBeNull();
    expect(seeded.token).toBe(publicForm);
  });

  test("4 段式签名被篡改 → null", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { privateForm } = generateEnhancedToken("app");
    const valid = signFourFieldToken(privateForm, nowSec);


    const fields = valid.split(".");
    const sigBytes = base64UrlDecode(fields[3])!;
    sigBytes[0] ^= 1;
    await expect(
      resolveTokenForLookup(`${fields[0]}.${fields[1]}.${fields[2]}.${base64UrlEncode(sigBytes)}`)
    ).resolves.toBeNull();


    const other = generateEnhancedToken("app");
    const otherFourField = signFourFieldToken(other.privateForm, nowSec);
    const swapped = `${valid.split(".").slice(0, 3).join(".")}.${otherFourField.split(".")[3]}`;
    await expect(resolveTokenForLookup(swapped)).resolves.toBeNull();
  });

  test("4 段式 iat 超出 ±900s → null", async () => {

    jest.useFakeTimers().setSystemTime(1_760_000_000_000);
    const nowSec = 1_760_000_000;
    const { publicForm, privateForm } = generateEnhancedToken("client");

    await expect(resolveTokenForLookup(signFourFieldToken(privateForm, nowSec - 900))).resolves.toBe(publicForm);
    await expect(resolveTokenForLookup(signFourFieldToken(privateForm, nowSec + 900))).resolves.toBe(publicForm);
    await expect(resolveTokenForLookup(signFourFieldToken(privateForm, nowSec - 901))).resolves.toBeNull();
    await expect(resolveTokenForLookup(signFourFieldToken(privateForm, nowSec + 901))).resolves.toBeNull();
  });

  test("畸形 gtfy token 一律 null（字段数/键长/iat/签名长度）", async () => {
    const { publicForm, privateForm } = generateEnhancedToken("app");
    const nowSec = Math.floor(Date.now() / 1000);
    const valid = signFourFieldToken(privateForm, nowSec);
    const [prefix, pubB64, iat, sigB64] = valid.split(".");

    const cases: Array<[string, string]> = [
      ["仅前缀无字段", "gtfy"],
      ["3 段式", `${prefix}.${pubB64}.${iat}`],
      ["5 段式", `${valid}.extra`],
      ["非法 base64url 字符", `${prefix}.${pubB64.slice(0, -1)}=`],
      ["2 段式键长错误（截断）", privateForm.slice(0, -2)],
      ["4 段式 pubkey 长度错误", `${prefix}.${pubB64.slice(0, -2)}.${iat}.${sigB64}`],
      ["iat 非整数", `${prefix}.${pubB64}.notanumber.${sigB64}`],
      ["iat 浮点", `${prefix}.${pubB64}.12.5.${sigB64}`],
      ["签名长度错误", `${prefix}.${pubB64}.${iat}.${sigB64.slice(0, -4)}`]
    ];
    for (const [, token] of cases) {
      await expect(resolveTokenForLookup(token)).resolves.toBeNull();
    }

    await expect(resolveTokenForLookup(privateForm)).resolves.toBe(publicForm);
  });

  test("RFC 8032 TEST 1 (ph) 官方向量：noble ed25519ph 与 Go crypto/ed25519 ph 模式互操作", () => {


    const hex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const secretKey = hex("833fe62409237b9d62ec77587520911e9a759cec1d19755b7da901b96dca3d42");
    const publicKey = hex("ec172b93ad5e563bf4932c70e1245034c35467ef2efd4d64ebf819683467e2bf");
    const message = hex("616263");
    const signature = hex(
      "98a70222f0b8121aa9d30f813d683f809e462b469c7ff87639499bb94e6dae41" +
      "31f85042463c2a355a2003d062adf5aaa10b8c61e636062aaad11c2a26083406"
    );

    expect(base64UrlEncode(ed25519.getPublicKey(secretKey))).toBe(base64UrlEncode(publicKey));
    expect(base64UrlEncode(ed25519ph.sign(message, secretKey))).toBe(base64UrlEncode(signature));
    expect(ed25519ph.verify(signature, message, publicKey)).toBe(true);
  });
});

describe("认证中间件全链路（真库）", () => {
  test("?token=<4段式含.> 查询参数认证成功（走 extractToken 全链路）", async () => {
    const testDb = makeAuthFixture();
    const { publicForm, privateForm } = generateEnhancedToken("client");
    const seeded = seedClient(testDb, { userId: 7, token: publicForm });
    const nowSec = Math.floor(Date.now() / 1000);
    const fourField = signFourFieldToken(privateForm, nowSec);

    const auth = new Authenticator(asDrizzle(testDb));

    const request = new Request(`http://localhost/message?token=${fourField}`);
    const tokenInfo = await auth.authenticate(request);

    expect(tokenInfo).toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: "client",
      resourceId: seeded.id,

      clientId: seeded.id,
      elevatedUntil: null,

      clientTokenLookup: publicForm
    });
  });

  test("privateForm（2 段式）经认证中间件命中库中 publicForm", async () => {
    const testDb = makeAuthFixture();
    const { publicForm, privateForm } = generateEnhancedToken("client");
    const seeded = seedClient(testDb, { userId: 7, token: publicForm });

    const auth = new Authenticator(asDrizzle(testDb));
    const request = new Request("http://localhost/message", {
      headers: { "X-Gotify-Key": privateForm }
    });
    await expect(auth.authenticate(request)).resolves.toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: "client",
      resourceId: seeded.id,

      clientId: seeded.id,
      elevatedUntil: null,

      clientTokenLookup: publicForm
    });
  });

  test("gtfya 4 段式命中 applications 表 → tokenType=app（不与 client 混淆）", async () => {
    const testDb = makeAuthFixture();
    const { publicForm, privateForm } = generateEnhancedToken("app");
    const appId = seedApplication(testDb, 7, publicForm);
    const nowSec = Math.floor(Date.now() / 1000);
    const fourField = signFourFieldToken(privateForm, nowSec);

    const auth = new Authenticator(asDrizzle(testDb));
    const request = new Request("http://localhost/message", {
      headers: { "X-Gotify-Key": fourField }
    });
    await expect(auth.authenticate(request)).resolves.toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: "app",
      resourceId: appId
    });
  });

  test("A…/C… 旧 token 经认证中间件仍可 200（向后兼容）", async () => {
    const testDb = makeAuthFixture();
    const appId = seedApplication(testDb, 7, "Alegacytoken123");
    const client = seedClient(testDb, { userId: 7, token: "Clegacytoken456" });

    const auth = new Authenticator(asDrizzle(testDb));
    await expect(
      auth.authenticate(new Request("http://localhost/message", { headers: { "X-Gotify-Key": "Alegacytoken123" } }))
    ).resolves.toEqual({ userId: 7, isAdmin: false, tokenType: "app", resourceId: appId });

    const auth2 = new Authenticator(asDrizzle(testDb));
    await expect(
      auth2.authenticate(new Request("http://localhost/message", { headers: { "X-Gotify-Key": "Clegacytoken456" } }))
    ).resolves.toEqual({
      userId: 7,
      isAdmin: false,
      tokenType: "client",
      resourceId: client.id,

      clientId: client.id,
      elevatedUntil: null,

      clientTokenLookup: "Clegacytoken456"
    });
  });

  test("孤儿 gtfyc client（用户行缺失）isOrphanClientToken → true（对齐上游 403 语义）", async () => {
    const testDb = createTestDb();
    const { publicForm, privateForm } = generateEnhancedToken("client");
    seedClient(testDb, { userId: 7, token: publicForm });

    const auth = new Authenticator(asDrizzle(testDb));
    const request = new Request("http://localhost/user", {
      headers: { "X-Gotify-Key": privateForm }
    });
    await expect(auth.authenticate(request)).resolves.toBeNull();
    await expect(auth.isOrphanClientToken(request)).resolves.toBe(true);
  });
});

describe("签发点：DB 写 publicForm、响应回 privateForm", () => {

  function createAppInsertMock() {
    const state = { insertedToken: null as string | null };
    const drizzle = {
      insert: jest.fn(() => ({
        values: jest.fn((vals: { token: string }) => {
          state.insertedToken = vals.token;
          return {
            returning: jest.fn().mockResolvedValue([{
              id: 1,
              userId: 7,
              token: vals.token,
              name: "App A",
              sortKey: "k",
              description: "",
              defaultPriority: 0,
              image: "",
              internal: false,
              lastUsed: null,
              createdAt: "2026-10-05 08:30:00"
            }])
          };
        })
      }))
    };
    return { drizzle, state };
  }

  test("POST /application：DB 存 publicForm，响应回 privateForm，且 privateForm 可解析回库中值", async () => {
    const { drizzle, state } = createAppInsertMock();
    const handlers = new ApplicationHandlers(drizzle as any);

    const res = await handlers.createApplication(7, "App A");
    const body = await res.json() as { token: string };

    expect(res.status).toBe(200);
    expect(body.token).toMatch(PUBLIC_OR_PRIVATE_RE);
    expect(body.token.startsWith("gtfya.")).toBe(true);
    expect(state.insertedToken).toMatch(PUBLIC_OR_PRIVATE_RE);
    expect(state.insertedToken).not.toBe(body.token);
    await expect(resolveTokenForLookup(body.token)).resolves.toBe(state.insertedToken);
  });

  test("PUT /application/:id/security：DB 更新为 publicForm，响应回 privateForm", async () => {
    const state = { updatedToken: null as string | null };
    const drizzle = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ id: 9 }) }))
        }))
      })),
      update: jest.fn(() => ({
        set: jest.fn((payload: { token: string }) => {
          state.updatedToken = payload.token;
          return { where: jest.fn().mockResolvedValue({ meta: { changes: 1 } }) };
        })
      }))
    };
    const handlers = new ApplicationHandlers(drizzle as any);

    const res = await handlers.regenerateApplicationToken(7, "9");
    const body = await res.json() as { regenerateToken: { token: string } };

    expect(res.status).toBe(200);
    expect(body.regenerateToken.token).toMatch(PUBLIC_OR_PRIVATE_RE);
    expect(body.regenerateToken.token.startsWith("gtfya.")).toBe(true);
    expect(state.updatedToken).toMatch(PUBLIC_OR_PRIVATE_RE);
    expect(state.updatedToken).not.toBe(body.regenerateToken.token);
    await expect(resolveTokenForLookup(body.regenerateToken.token)).resolves.toBe(state.updatedToken);
  });

  test("POST /client：DB 存 publicForm，响应回 privateForm（真库）", async () => {
    const testDb = createTestDb();
    const handlers = new ClientHandlers(asDrizzle(testDb));

    const res = await handlers.createClient(7, { name: "Phone" });
    const body = await res.json() as { id: number; token: string };

    expect(res.status).toBe(200);
    expect(body.token).toMatch(PUBLIC_OR_PRIVATE_RE);
    expect(body.token.startsWith("gtfyc.")).toBe(true);

    const row = testDb.db.select().from(clients).where(eq(clients.id, body.id)).all()[0];
    expect(row.token).toMatch(PUBLIC_OR_PRIVATE_RE);
    expect(row.token).not.toBe(body.token);
    await expect(resolveTokenForLookup(body.token)).resolves.toBe(row.token);
  });
});
