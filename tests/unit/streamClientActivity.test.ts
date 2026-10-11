























import { fireAlarm } from "../helpers/durableAlarm";
import { MessageStreamHubObject } from "../../src/durable/messageStreamHub";
import { DurableObjectMessageStreamHub } from "../../src/services/messageStreamHub";
import {
  refreshBoundStreamClient,
  loadStreamClientBindingState,
  streamClientRefreshIntervalMs,
  streamClientRetryAfterMs,
  StreamClientRenewalError,
  STREAM_HEADER_USER_ID,
  STREAM_HEADER_CLIENT_ID,
  STREAM_HEADER_TOKEN_LOOKUP,
  type StreamClientBinding,
} from "../../src/services/streamClientActivity";
import { createTestDb, asDrizzle, seedClient, type TestDb } from "../helpers/testDb";
import { makeD1Sqlite } from "../helpers/d1Sqlite";
import { clients, users } from "../../src/models";
import { eq } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";

const T0 = new Date("2026-10-08T00:00:00.000Z");
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;


function makeFakeSocket() {
  const ws: any = {
    readyState: WS_OPEN,
    sent: [] as string[],
    closeCode: undefined as number | undefined,
    closeReason: undefined as string | undefined,
    __attachment: null as unknown,
    __tags: [] as string[],
  };
  ws.send = jest.fn((m: string) => {
    if (ws.readyState !== WS_OPEN) throw new Error("send on non-open socket");
    ws.sent.push(m);
  });
  ws.close = jest.fn((code?: number, reason?: string) => {
    if (ws.readyState === WS_CLOSED) return;
    ws.readyState = WS_CLOSED;
    ws.closeCode = code;
    ws.closeReason = reason;
  });
  ws.serializeAttachment = jest.fn((a: unknown) => {
    ws.__attachment = a;
  });
  ws.deserializeAttachment = jest.fn(() => ws.__attachment ?? null);
  return ws;
}

(globalThis as any).WebSocketPair = class {
  0: any;
  1: any;
  constructor() {
    this[0] = makeFakeSocket();
    this[1] = makeFakeSocket();
  }
};

const OriginalResponse = globalThis.Response;
class Response101Allowed extends OriginalResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    if (init && init.status === 101) {
      super(null, { ...init, status: 200 });
      Object.defineProperty(this, "status", { value: 101 });
    } else {
      super(body, init);
    }
  }
}
(globalThis as any).Response = Response101Allowed;


function makeFakeState() {
  const sockets: any[] = [];
  let alarm: number | null = null;
  return {
    __sockets: sockets,
    acceptWebSocket: jest.fn((ws: any, tags?: string[]) => {
      ws.__tags = tags ?? [];
      sockets.push(ws);
    }),
    getWebSockets: jest.fn((tag?: string) =>
      tag ? sockets.filter((s) => (s.__tags ?? []).includes(tag)) : [...sockets]
    ),
    getTags: jest.fn((ws: any) => ws.__tags ?? []),
    storage: {
      getAlarm: jest.fn(async () => alarm),
      setAlarm: jest.fn(async (t: number | Date) => {
        alarm = typeof t === "number" ? t : t.getTime();
      }),
      deleteAlarm: jest.fn(async () => {
        alarm = null;
      }),
    },
    __getAlarm: () => alarm,
    __setAlarm: (t: number | null) => {
      alarm = t;
    },
  } as any;
}

function seedUser(testDb: TestDb, id = 7, disabled = 0) {
  testDb.sqlite
    .prepare("INSERT INTO users (id, name, admin, disabled) VALUES (?, ?, ?, ?)")
    .run(id, `user${id}`, 0, disabled);
}

function getRow(testDb: TestDb, id: number) {
  return testDb.db.select().from(clients).where(eq(clients.id, id)).all()[0];
}

function bindingHeaders(b: StreamClientBinding) {
  return {
    Upgrade: "websocket",
    [STREAM_HEADER_USER_ID]: String(b.userId),
    [STREAM_HEADER_CLIENT_ID]: String(b.clientId),
    [STREAM_HEADER_TOKEN_LOOKUP]: b.tokenLookup,
  };
}


function countClientUpdates(testDb: TestDb) {
  const base = makeD1Sqlite(testDb);
  let updates = 0;
  const db = {
    ...base,
    prepare(sql: string) {
      if (/^\s*update\s+[`"]?clients[`"]?/i.test(sql)) updates++;
      return base.prepare(sql);
    },
  } as unknown as D1Database;
  return { db, getUpdates: () => updates };
}


function withFailureSwitch(testDb: TestDb) {
  const base = makeD1Sqlite(testDb);
  let failing = false;
  const db = {
    ...base,
    prepare(sql: string) {
      if (failing) throw new Error("injected D1 failure");
      return base.prepare(sql);
    },
  } as unknown as D1Database;
  return { db, setFailing: (v: boolean) => (failing = v) };
}


async function connectBound(
  dobj: MessageStreamHubObject,
  state: ReturnType<typeof makeFakeState>,
  binding: StreamClientBinding
) {
  const res = await dobj.fetch(
    new Request(`https://hub.internal/connect?clientId=${binding.clientId}`, {
      headers: bindingHeaders(binding),
    })
  );
  return res;
}

afterEach(() => {
  jest.useRealTimers();
});

describe("调度算法：刷新间隔与重试间隔", () => {
  test("刷新间隔 min(300000, seconds*1000/2)：600/3600 秒周期均取 300 秒节流", () => {
    expect(streamClientRefreshIntervalMs(600)).toBe(300_000);
    expect(streamClientRefreshIntervalMs(3600)).toBe(300_000);
  });

  test("60 秒短周期采用 30 秒刷新；1 秒周期下限 500ms", () => {
    expect(streamClientRefreshIntervalMs(60)).toBe(30_000);
    expect(streamClientRefreshIntervalMs(1)).toBe(500);
  });

  test("0 周期（永不过期）按 300000ms 节流核验有效性", () => {
    expect(streamClientRefreshIntervalMs(0)).toBe(300_000);
  });

  test("重试间隔 min(10000, seconds*1000/2)：60 秒 10 秒后重试；0 周期 10000ms；1 秒 500ms", () => {
    expect(streamClientRetryAfterMs(60)).toBe(10_000);
    expect(streamClientRetryAfterMs(0)).toBe(10_000);
    expect(streamClientRetryAfterMs(1)).toBe(500);
    expect(streamClientRetryAfterMs(10)).toBe(5_000);
  });
});

describe("refreshBoundStreamClient（真库）", () => {
  function seedBoundClient(overrides: Parameters<typeof seedClient>[1]) {
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cbound-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, { token, ...overrides });
    const binding: StreamClientBinding = { userId: 7, clientId: seed.id, tokenLookup: token };
    return { testDb, drizzle: asDrizzle(testDb), seed, binding, token };
  }

  test("到点续期：lastUsed 与 expiresAt 同一次刷新（600 秒周期）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 300_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 300_000).toISOString(),
    });

    const result = await refreshBoundStreamClient(drizzle, binding);

    expect(result).toEqual({ status: "active", refreshDueAtMs: T0.getTime() + 300_000, currentSeconds: 600 });
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(T0.toISOString());
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 600_000).toISOString());
  });

  test("0 周期：按节流刷新 lastUsed，expiresAt 保持 null", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 0,
      expiresAt: null,
    });

    const result = await refreshBoundStreamClient(drizzle, binding);

    expect(result).toEqual({ status: "active", refreshDueAtMs: T0.getTime() + 300_000, currentSeconds: 0 });
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(T0.toISOString());
    expect(row.expiresAt).toBeNull();
  });

  test("节流窗口内不刷新：返回剩余应刷新时刻，不写库", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const lastUsed = new Date(T0.getTime() - 100_000).toISOString();
    const expiresAt = new Date(T0.getTime() + 500_000).toISOString();
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed,
      expiresAfterInactivitySeconds: 600,
      expiresAt,
    });

    const result = await refreshBoundStreamClient(drizzle, binding);

    expect(result).toEqual({ status: "active", refreshDueAtMs: T0.getTime() + 200_000, currentSeconds: 600 });
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(lastUsed);
    expect(row.expiresAt).toBe(expiresAt);
  });

  test("now == expiresAt 边界判过期：返回 invalid，绝不复活（不写库）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const lastUsed = new Date(T0.getTime() - 600_000).toISOString();
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed,
      expiresAfterInactivitySeconds: 600,
      expiresAt: T0.toISOString(),
    });

    const result = await refreshBoundStreamClient(drizzle, binding);

    expect(result).toEqual({ status: "invalid" });
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(lastUsed);
    expect(row.expiresAt).toBe(T0.toISOString());
  });

  test("已过期（now > expiresAt）：invalid 且不写库", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 700_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() - 1000).toISOString(),
    });

    expect(await refreshBoundStreamClient(drizzle, binding)).toEqual({ status: "invalid" });
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() - 700_000).toISOString());
  });

  test("同 id 换 token：旧绑定 invalid，且不刷新新凭据（新 token 行不动）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });

    const newToken = "Crotated-" + Math.random().toString(36).slice(2, 20);
    const rotatedLastUsed = new Date(T0.getTime() - 400_000).toISOString();
    testDb.db.update(clients).set({ token: newToken }).where(eq(clients.id, seed.id)).run();

    const result = await refreshBoundStreamClient(drizzle, binding);

    expect(result).toEqual({ status: "invalid" });
    const row = getRow(testDb, seed.id);
    expect(row.token).toBe(newToken);
    expect(row.lastUsed).toBe(rotatedLastUsed);
  });

  test("属主不符（userId 不匹配）：invalid 且不写库", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, token } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });

    const result = await refreshBoundStreamClient(drizzle, {
      userId: 999,
      clientId: seed.id,
      tokenLookup: token,
    });

    expect(result).toEqual({ status: "invalid" });
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() - 400_000).toISOString());
  });

  test("client 已删除：invalid", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { drizzle, binding } = seedBoundClient({ expiresAfterInactivitySeconds: 600 });

    expect(await refreshBoundStreamClient(drizzle, { ...binding, clientId: 987654 })).toEqual({
      status: "invalid",
    });
  });

  test("用户被禁用：invalid 且不续期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });
    testDb.sqlite.prepare("UPDATE users SET disabled = 1 WHERE id = 7").run();

    expect(await refreshBoundStreamClient(drizzle, binding)).toEqual({ status: "invalid" });
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() - 400_000).toISOString());
  });

  test("DB 错误包装为 StreamClientRenewalError 抛出：固定 message（不含凭据），cause 保留原始错误不吞错", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const broken = {
      select() {
        throw new Error("D1 down");
      },
    };

    const rejection: unknown = await refreshBoundStreamClient(
      broken as any,
      { userId: 7, clientId: 1, tokenLookup: "Cx" }
    ).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(rejection).toBeInstanceOf(StreamClientRenewalError);
    const renewalError = rejection as StreamClientRenewalError;
    expect(renewalError.message).toBe("stream client renewal failed");
    expect(renewalError.currentSeconds).toBeUndefined();
    expect((renewalError.cause as Error).message).toBe("D1 down");
  });

  test("成功读到当前策略后 UPDATE 失败：StreamClientRenewalError 携带当前周期（非 attachment 陈旧快照）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 10,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });

    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === "update") {
          return () => {
            throw new Error("D1 write failed");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const rejection: unknown = await refreshBoundStreamClient(interleaved as any, binding).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(rejection).toBeInstanceOf(StreamClientRenewalError);
    const renewalError = rejection as StreamClientRenewalError;
    expect(renewalError.currentSeconds).toBe(10);
    expect(renewalError.message).not.toContain(seed.token);
    expect((renewalError.cause as Error).message).toBe("D1 write failed");
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() - 400_000).toISOString());
  });



  test("clients 行验证后 users 查询失败：StreamClientRenewalError 仍携带已读到的当前周期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { drizzle, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 10,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });


    const usersIdColumn = users.id;
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop !== "select") return Reflect.get(target, prop, receiver);
        return (fields: any) => {
          if (Object.values(fields).includes(usersIdColumn)) {
            throw new Error("D1 users read failed");
          }
          return target.select(fields);
        };
      },
    });

    const rejection: unknown = await refreshBoundStreamClient(interleaved as any, binding).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(rejection).toBeInstanceOf(StreamClientRenewalError);
    const renewalError = rejection as StreamClientRenewalError;
    expect(renewalError.currentSeconds).toBe(10);
    expect(renewalError.message).toBe("stream client renewal failed");
    expect((renewalError.cause as Error).message).toBe("D1 users read failed");

    expect(streamClientRetryAfterMs(renewalError.currentSeconds ?? 600)).toBe(5_000);
  });



  test("clients SELECT 本身失败（行未读到/未验证）：currentSeconds 仍为 undefined", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const broken = {
      select() {
        throw new Error("D1 clients read failed");
      },
    };

    const rejection: unknown = await refreshBoundStreamClient(
      broken as any,
      { userId: 7, clientId: 1, tokenLookup: "Cx" }
    ).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(rejection).toBeInstanceOf(StreamClientRenewalError);
    expect((rejection as StreamClientRenewalError).currentSeconds).toBeUndefined();
  });

  test("预检通过后用户被禁用（交错）：UPDATE 原子 EXISTS 守卫拒绝，invalid 且不写库", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });

    const realUpdate = drizzle.update.bind(drizzle);
    let injected = false;
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === "update" && !injected) {
          return (table: unknown) => {
            injected = true;
            testDb.sqlite.prepare("UPDATE users SET disabled = 1 WHERE id = 7").run();
            return realUpdate(table as any);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await refreshBoundStreamClient(interleaved as any, binding);

    expect(injected).toBe(true);
    expect(result).toEqual({ status: "invalid" });
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() - 400_000).toISOString());
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 200_000).toISOString());
  });

  test("策略并发改变：守卫未命中后重新读取，不用旧值覆盖新策略", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });

    const realUpdate = drizzle.update.bind(drizzle);
    let injected = false;
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === "update" && !injected) {
          return (table: unknown) => {
            injected = true;
            testDb.db
              .update(clients)
              .set({ expiresAfterInactivitySeconds: 3600 })
              .where(eq(clients.id, seed.id))
              .run();
            return realUpdate(table as any);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await refreshBoundStreamClient(interleaved as any, binding);

    expect(result.status).toBe("active");
    const row = getRow(testDb, seed.id);
    expect(row.expiresAfterInactivitySeconds).toBe(3600);
    expect(row.lastUsed).toBe(T0.toISOString());

    expect(row.expiresAt).toBe(new Date(T0.getTime() + 3_600_000).toISOString());
  });

  test("并发续期交错：他方已刷新时守卫未命中，重读后不再重复写", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });
    const concurrentLastUsed = T0.toISOString();
    const concurrentExpiresAt = new Date(T0.getTime() + 600_000).toISOString();
    const realUpdate = drizzle.update.bind(drizzle);
    let injected = false;
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === "update" && !injected) {
          return (table: unknown) => {
            injected = true;
            testDb.db
              .update(clients)
              .set({ lastUsed: concurrentLastUsed, expiresAt: concurrentExpiresAt })
              .where(eq(clients.id, seed.id))
              .run();
            return realUpdate(table as any);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await refreshBoundStreamClient(interleaved as any, binding);

    expect(result.status).toBe("active");
    const row = getRow(testDb, seed.id);

    expect(row.lastUsed).toBe(concurrentLastUsed);
    expect(row.expiresAt).toBe(concurrentExpiresAt);
  });





  test("连续两次守卫未命中（策略持续变更）：回退按最后一次重读 lastUsed + 新策略间隔返回绝对 dueAt，非 now + 完整半周期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const { testDb, drizzle, seed, binding } = seedBoundClient({
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });



    const realUpdate = drizzle.update.bind(drizzle);
    let calls = 0;
    const interleaved = new Proxy(drizzle, {
      get(target, prop, receiver) {
        if (prop === "update") {
          return (table: unknown) => {
            calls++;
            if (calls === 1) {
              testDb.db
                .update(clients)
                .set({
                  expiresAfterInactivitySeconds: 7,
                  lastUsed: new Date(T0.getTime() - 5_000).toISOString(),
                  expiresAt: new Date(T0.getTime() + 2_000).toISOString(),
                })
                .where(eq(clients.id, seed.id))
                .run();
            } else if (calls === 2) {
              testDb.db
                .update(clients)
                .set({ expiresAfterInactivitySeconds: 8 })
                .where(eq(clients.id, seed.id))
                .run();
            }
            return realUpdate(table as any);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const result = await refreshBoundStreamClient(interleaved as any, binding);

    expect(result.status).toBe("active");
    expect(result.currentSeconds).toBe(8);

    expect(result.refreshDueAtMs).toBe(T0.getTime() - 1_000);

    expect(result.refreshDueAtMs).not.toBe(T0.getTime() + 4_000);
    expect(result.refreshDueAtMs).toBeLessThanOrEqual(T0.getTime() + 2_000);

    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() - 5_000).toISOString());
    expect(row.expiresAfterInactivitySeconds).toBe(8);
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 2_000).toISOString());
  });
});

describe("loadStreamClientBindingState（connect 校验，真库）", () => {
  test("三元组 + 用户可用 + 未过期：active 并带回调度所需状态", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cload-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 60,
      expiresAt: new Date(T0.getTime() + 60_000).toISOString(),
    });

    const result = await loadStreamClientBindingState(asDrizzle(testDb), {
      userId: 7,
      clientId: seed.id,
      tokenLookup: token,
    });

    expect(result).toEqual({
      status: "active",
      state: {
        lastUsed: T0.toISOString(),
        expiresAfterInactivitySeconds: 60,
        expiresAt: new Date(T0.getTime() + 60_000).toISOString(),
      },
    });
  });

  test("绑定非法（token 不符/行缺失/已过期/用户禁用）一律 invalid", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    seedUser(testDb, 8, 1);
    const token = "Cload-" + Math.random().toString(36).slice(2, 20);
    const expired = seedClient(testDb, {
      token,
      deviceUid: "uid-expired",
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() - 1000).toISOString(),
    });
    const disabledUserClient = seedClient(testDb, {
      userId: 8,
      deviceUid: "uid-disabled",
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const drizzle = asDrizzle(testDb);

    expect(
      (await loadStreamClientBindingState(drizzle, { userId: 7, clientId: expired.id, tokenLookup: "Cwrong" }))
        .status
    ).toBe("invalid");
    expect(
      (await loadStreamClientBindingState(drizzle, { userId: 7, clientId: 424242, tokenLookup: token })).status
    ).toBe("invalid");
    expect(
      (await loadStreamClientBindingState(drizzle, { userId: 7, clientId: expired.id, tokenLookup: token })).status
    ).toBe("invalid");
    expect(
      (
        await loadStreamClientBindingState(drizzle, {
          userId: 8,
          clientId: disabledUserClient.id,
          tokenLookup: disabledUserClient.token,
        })
      ).status
    ).toBe("invalid");
  });
});

describe("DO alarm 服务端续期（假 state + 真库）", () => {
  function makeHub(testDb: TestDb, db?: D1Database) {
    const state = makeFakeState();
    const env = { DB: db ?? makeD1Sqlite(testDb) };
    const dobj = new MessageStreamHubObject(state, env);
    return { state, env, dobj };
  }

  test("慢查询期间新连接的 alarm 到期：保留并立即续期，凭据不因被旧组排程覆盖而过期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const old = seedClient(testDb, {
      token: "Cold-alarm-race",
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const base = makeD1Sqlite(testDb);
    let holdNextRead = false;
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    const db = {
      ...base,
      prepare(sql: string) {
        const prepared = base.prepare(sql);
        return {
          bind(...args: unknown[]) {
            const statement = prepared.bind(...args);
            if (!holdNextRead || !sql.includes('from "clients"')) return statement;
            holdNextRead = false;
            const raw = statement.raw.bind(statement);
            return {
              ...statement,
              async raw() {
                markReadStarted();
                await gate;
                return raw();
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const { state, dobj } = makeHub(testDb, db);
    let pendingAlarm: Promise<void> | undefined;
    try {
      expect((await connectBound(dobj, state, {
        userId: 7, clientId: old.id, tokenLookup: old.token,
      })).status).toBe(101);
      jest.setSystemTime(new Date(T0.getTime() + 300_000));
      holdNextRead = true;
      pendingAlarm = fireAlarm(dobj, state);
      await readStarted;
      jest.setSystemTime(new Date(T0.getTime() + 301_000));
      const fresh = seedClient(testDb, {
        token: "Cnew-alarm-race",
        deviceUid: "new-alarm-race",
        lastUsed: new Date(Date.now()).toISOString(),
        expiresAfterInactivitySeconds: 10,
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      });
      expect((await connectBound(dobj, state, {
        userId: 7, clientId: fresh.id, tokenLookup: fresh.token,
      })).status).toBe(101);
      expect(state.__getAlarm()).toBe(T0.getTime() + 306_000);

      jest.setSystemTime(new Date(T0.getTime() + 308_000));
      releaseRead();
      await pendingAlarm;
      expect(state.__getAlarm()).toBe(T0.getTime() + 306_000);


      await fireAlarm(dobj, state);
      expect(getRow(testDb, fresh.id).lastUsed).toBe(new Date(Date.now()).toISOString());
      expect(getRow(testDb, fresh.id).expiresAt).toBe(new Date(Date.now() + 10_000).toISOString());
      jest.setSystemTime(new Date(T0.getTime() + 311_000));
      await dobj.webSocketMessage(state.__sockets[1], "ping");
      expect(state.__sockets[1].readyState).toBe(1);
      expect(state.__sockets[1].close).not.toHaveBeenCalled();
    } finally {
      releaseRead();
      await pendingAlarm;
      testDb.sqlite.close();
    }
  });

  test("renews_last_used_and_expiry_in_same_update", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Calarm-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    const binding: StreamClientBinding = { userId: 7, clientId: seed.id, tokenLookup: token };

    const res = await connectBound(dobj, state, binding);
    expect(res.status).toBe(101);

    expect(state.__getAlarm()).toBe(T0.getTime() + 300_000);


    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);


    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 300_000 + 600_000).toISOString());

    expect(state.__getAlarm()).toBe(T0.getTime() + 600_000);
  });

  test("0 周期连接：alarm 按 300000ms 节流刷新 lastUsed，expiresAt 保持 null", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Czero-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 0,
      expiresAt: null,
    });
    const { state, dobj } = makeHub(testDb);

    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    expect(state.__getAlarm()).toBe(T0.getTime() + 300_000);

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);

    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());
    expect(row.expiresAt).toBeNull();
    expect(state.__getAlarm()).toBe(T0.getTime() + 600_000);
  });

  test("retries_sixty_second_expiry_after_ten_seconds", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cretry-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 60,
      expiresAt: new Date(T0.getTime() + 60_000).toISOString(),
    });
    const { db, setFailing } = withFailureSwitch(testDb);
    const { state, dobj } = makeHub(testDb, db);

    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });

    expect(state.__getAlarm()).toBe(T0.getTime() + 30_000);


    jest.setSystemTime(new Date(T0.getTime() + 30_000));
    setFailing(true);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await fireAlarm(dobj, state);
    errorSpy.mockRestore();
    expect(state.__getAlarm()).toBe(T0.getTime() + 40_000);

    expect(state.__getAlarm()).not.toBe(T0.getTime() + 60_000);
    expect(getRow(testDb, seed.id).lastUsed).toBe(T0.toISOString());


    setFailing(false);
    jest.setSystemTime(new Date(T0.getTime() + 40_000));
    await fireAlarm(dobj, state);
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() + 40_000).toISOString());
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 100_000).toISOString());
    expect(state.__getAlarm()).toBe(T0.getTime() + 70_000);
  });

  test("策略缩短后重试按当前策略：成功读取同步 attachment 提示，D1 失败重试 5000ms 而非陈旧 10000ms", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cshort-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 10,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });
    const { db, setFailing } = withFailureSwitch(testDb);
    const { state, dobj } = makeHub(testDb, db);

    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });

    state.__sockets[0].serializeAttachment({
      v: 1,
      userId: 7,
      clientId: seed.id,
      tokenLookup: token,
      expiresAfterInactivitySeconds: 600,
    });


    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await fireAlarm(dobj, state);
    expect(state.__sockets[0].__attachment).toMatchObject({ expiresAfterInactivitySeconds: 10 });
    expect(state.__getAlarm()).toBe(T0.getTime() + 5_000);


    jest.setSystemTime(new Date(T0.getTime() + 5_000));
    setFailing(true);
    await fireAlarm(dobj, state);
    setFailing(false);
    errorSpy.mockRestore();
    expect(state.__getAlarm()).toBe(T0.getTime() + 10_000);
    expect(getRow(testDb, seed.id).lastUsed).toBe(T0.toISOString());
  });






  test("connect 统一同组策略：旧连接 600 提示在新连接（策略已改 10）接入时同步为 10；随后 alarm 遇 D1 完全不可读重试 +5000ms 非 +10000ms", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cunify-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { db, setFailing } = withFailureSwitch(testDb);
    const { state, dobj } = makeHub(testDb, db);


    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    expect(state.__sockets[0].__attachment).toMatchObject({ expiresAfterInactivitySeconds: 600 });


    testDb.db
      .update(clients)
      .set({ expiresAfterInactivitySeconds: 10 })
      .where(eq(clients.id, seed.id))
      .run();
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });


    expect(state.__sockets[0].__attachment).toMatchObject({ expiresAfterInactivitySeconds: 10 });
    expect(state.__sockets[1].__attachment).toMatchObject({ expiresAfterInactivitySeconds: 10 });

    expect(state.__getAlarm()).toBe(T0.getTime() + 5_000);



    jest.setSystemTime(new Date(T0.getTime() + 5_000));
    setFailing(true);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await fireAlarm(dobj, state);
    errorSpy.mockRestore();
    setFailing(false);
    expect(state.__getAlarm()).toBe(T0.getTime() + 10_000);
    expect(state.__getAlarm()).not.toBe(T0.getTime() + 15_000);
  });






  test("部分查询成功后失败：attachment 同步当前策略，下一轮完全不可读仍按 5s 重试", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cpartial-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: new Date(T0.getTime() - 400_000).toISOString(),
      expiresAfterInactivitySeconds: 10,
      expiresAt: new Date(T0.getTime() + 200_000).toISOString(),
    });

    const base = makeD1Sqlite(testDb);
    let mode: "none" | "users" | "all" = "none";
    const db = {
      ...base,
      prepare(sql: string) {
        if (mode === "all") throw new Error("injected D1 total failure");
        if (mode === "users" && /from "users"/i.test(sql)) throw new Error("injected users-read failure");
        return base.prepare(sql);
      },
    } as unknown as D1Database;
    const state = makeFakeState();
    const dobj = new MessageStreamHubObject(state, { DB: db });
    const ws = makeFakeSocket();
    state.acceptWebSocket(ws, [`client:${seed.id}`]);

    ws.serializeAttachment({
      v: 1,
      userId: 7,
      clientId: seed.id,
      tokenLookup: token,
      expiresAfterInactivitySeconds: 600,
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});


    mode = "users";
    await fireAlarm(dobj, state);
    expect(ws.__attachment).toMatchObject({ expiresAfterInactivitySeconds: 10 });
    expect(state.__getAlarm()).toBe(T0.getTime() + 5_000);
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() - 400_000).toISOString());


    jest.setSystemTime(new Date(T0.getTime() + 5_000));
    mode = "all";
    await fireAlarm(dobj, state);
    errorSpy.mockRestore();
    mode = "none";
    expect(state.__getAlarm()).toBe(T0.getTime() + 10_000);
    expect(state.__getAlarm()).not.toBe(T0.getTime() + 15_000);
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() - 400_000).toISOString());
  });

  test("1 秒周期：刷新间隔与重试间隔均为 500ms（仅验证调度算法，非真实平台窗口）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cone-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 1,
      expiresAt: new Date(T0.getTime() + 1000).toISOString(),
    });
    const { db, setFailing } = withFailureSwitch(testDb);
    const { state, dobj } = makeHub(testDb, db);

    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    expect(state.__getAlarm()).toBe(T0.getTime() + 500);

    jest.setSystemTime(new Date(T0.getTime() + 500));
    setFailing(true);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await fireAlarm(dobj, state);
    errorSpy.mockRestore();
    expect(state.__getAlarm()).toBe(T0.getTime() + 1000);
  });

  test("同 client 多个 socket 仅刷新一行一次（按三元组去重）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cdup-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { db, getUpdates } = countClientUpdates(testDb);
    const { state, dobj } = makeHub(testDb, db);
    const binding: StreamClientBinding = { userId: 7, clientId: seed.id, tokenLookup: token };

    await connectBound(dobj, state, binding);
    await connectBound(dobj, state, binding);
    expect(state.__sockets).toHaveLength(2);
    const updatesAtConnect = getUpdates();

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);

    expect(getUpdates() - updatesAtConnect).toBe(1);
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());

    expect(state.__sockets.every((s: any) => s.readyState === WS_OPEN)).toBe(true);
  });

  test("重建 DO 实例后 attachments 仍可恢复并续期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cwake-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, env, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });


    const revived = new MessageStreamHubObject(state, env);
    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(revived, state);

    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 900_000).toISOString());
  });

  test("closed/closing socket 不续期；无 OPEN 绑定连接时删除 alarm", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cclosed-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    const ws = state.__sockets[0];
    ws.readyState = WS_CLOSING;

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);

    expect(getRow(testDb, seed.id).lastUsed).toBe(T0.toISOString());
    expect(state.__getAlarm()).toBeNull();
  });

  test("无绑定（Basic）连接：不参与续期、不被关闭、不调度 alarm", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const { state, dobj } = makeHub(testDb);
    const res = await dobj.fetch(
      new Request("https://hub.internal/connect", { headers: { Upgrade: "websocket" } })
    );
    expect(res.status).toBe(101);
    expect(state.__getAlarm()).toBeNull();

    await fireAlarm(dobj, state);
    expect(state.__sockets[0].readyState).toBe(WS_OPEN);
    expect(state.__getAlarm()).toBeNull();
  });

  test("旧部署连接（只有 client tag、没有 attachment）：不按当前 DB 行补绑定，关闭并要求重认证", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Clegacy-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);

    const res = await dobj.fetch(
      new Request(`https://hub.internal/connect?clientId=${seed.id}`, {
        headers: { Upgrade: "websocket" },
      })
    );
    expect(res.status).toBe(101);
    const legacy = state.__sockets[0];
    expect(legacy.__tags).toEqual([`client:${seed.id}`]);
    expect(legacy.__attachment ?? null).toBeNull();

    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);

    expect(legacy.readyState).toBe(WS_CLOSED);
    expect(legacy.closeCode).toBe(4003);

    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());
    expect(state.__sockets[1].readyState).toBe(WS_OPEN);
  });

  test("token 更换后旧 socket 失效：关闭旧连接，不给新凭据续期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const oldToken = "Cold-" + Math.random().toString(36).slice(2, 20);
    const newToken = "Cnew-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token: oldToken,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: oldToken });
    const oldSocket = state.__sockets[0];


    testDb.db.update(clients).set({ token: newToken }).where(eq(clients.id, seed.id)).run();

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);

    expect(oldSocket.readyState).toBe(WS_CLOSED);
    expect(oldSocket.closeCode).toBe(4002);
    const row = getRow(testDb, seed.id);
    expect(row.token).toBe(newToken);
    expect(row.lastUsed).toBe(T0.toISOString());
    expect(state.__getAlarm()).toBeNull();
  });

  test("client 删除后旧 socket 失效并关闭", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cdel-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    const ws = state.__sockets[0];

    testDb.db.delete(clients).where(eq(clients.id, seed.id)).run();

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);

    expect(ws.readyState).toBe(WS_CLOSED);
    expect(ws.closeCode).toBe(4002);
    expect(state.__getAlarm()).toBeNull();
  });

  test("logout 断流后不续期：行删除 + /disconnect 关流，alarm 取消", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Clogout-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    const ws = state.__sockets[0];
    expect(state.__getAlarm()).not.toBeNull();


    testDb.db.delete(clients).where(eq(clients.id, seed.id)).run();
    const res = await dobj.fetch(
      new Request(`https://hub.internal/disconnect?clientId=${seed.id}`, { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(ws.readyState).toBe(WS_CLOSED);
    expect(ws.closeCode).toBe(4001);


    expect(state.__getAlarm()).toBeNull();
    await fireAlarm(dobj, state);
    expect(state.__getAlarm()).toBeNull();
  });

  test("alarm 重复触发幂等：第二次空转不写库，调度保持正确", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cidem-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { db, getUpdates } = countClientUpdates(testDb);
    const { state, dobj } = makeHub(testDb, db);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await fireAlarm(dobj, state);
    expect(getRow(testDb, seed.id).lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());
    const updatesAfterFirst = getUpdates();


    await fireAlarm(dobj, state);
    expect(getUpdates()).toBe(updatesAfterFirst);
    expect(state.__getAlarm()).toBe(T0.getTime() + 600_000);
  });

  test("全部绑定连接关闭后取消 alarm（webSocketClose）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cclose-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    const ws = state.__sockets[0];
    expect(state.__getAlarm()).not.toBeNull();

    await dobj.webSocketClose(ws, 1000, "client bye", true);

    expect(state.__getAlarm()).toBeNull();
  });

  test("connect 时校验绑定：行已删除 → 401，不接受连接", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const { state, dobj } = makeHub(testDb);

    const res = await connectBound(dobj, state, { userId: 7, clientId: 31337, tokenLookup: "Cghost" });

    expect(res.status).toBe(401);
    expect(state.__sockets).toHaveLength(0);
    expect(state.__getAlarm()).toBeNull();
  });

  test("connect 调度不覆盖更早的既有 alarm", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const tokenA = "Cea-" + Math.random().toString(36).slice(2, 20);
    const tokenB = "Ceb-" + Math.random().toString(36).slice(2, 20);
    const a = seedClient(testDb, {
      token: tokenA,
      deviceUid: "uid-a",
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const b = seedClient(testDb, {
      token: tokenB,
      deviceUid: "uid-b",
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 60,
      expiresAt: new Date(T0.getTime() + 60_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);

    await connectBound(dobj, state, { userId: 7, clientId: a.id, tokenLookup: tokenA });
    expect(state.__getAlarm()).toBe(T0.getTime() + 300_000);


    await connectBound(dobj, state, { userId: 7, clientId: b.id, tokenLookup: tokenB });
    expect(state.__getAlarm()).toBe(T0.getTime() + 30_000);


    const tokenC = "Cec-" + Math.random().toString(36).slice(2, 20);
    const c = seedClient(testDb, {
      token: tokenC,
      deviceUid: "uid-c",
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 3600,
      expiresAt: new Date(T0.getTime() + 3_600_000).toISOString(),
    });
    await connectBound(dobj, state, { userId: 7, clientId: c.id, tokenLookup: tokenC });
    expect(state.__getAlarm()).toBe(T0.getTime() + 30_000);
  });

  test("文本 ping 走同一绑定服务续期并保留 pong", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cping-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);
    await connectBound(dobj, state, { userId: 7, clientId: seed.id, tokenLookup: token });
    const ws = state.__sockets[0];

    jest.setSystemTime(new Date(T0.getTime() + 300_000));
    await dobj.webSocketMessage(ws, "ping");

    expect(ws.sent).toContain("pong");
    const row = getRow(testDb, seed.id);
    expect(row.lastUsed).toBe(new Date(T0.getTime() + 300_000).toISOString());
    expect(row.expiresAt).toBe(new Date(T0.getTime() + 900_000).toISOString());
  });

  test("旧部署连接的文本 ping：回 pong 后关闭重认证（4003），不按当前 DB 行续期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Clegping-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, dobj } = makeHub(testDb);

    await dobj.fetch(
      new Request(`https://hub.internal/connect?clientId=${seed.id}`, {
        headers: { Upgrade: "websocket" },
      })
    );
    const legacy = state.__sockets[0];

    await dobj.webSocketMessage(legacy, "ping");

    expect(legacy.sent).toContain("pong");
    expect(legacy.closeCode).toBe(4003);

    expect(getRow(testDb, seed.id).lastUsed).toBe(T0.toISOString());
  });
});

describe("hub→DO 连接契约（真实 hub + 真实 DO + 真库；回归无绑定不得 400）", () => {
  function makeHubToRealDo(testDb: TestDb) {
    const state = makeFakeState();
    const dobj = new MessageStreamHubObject(state, { DB: makeD1Sqlite(testDb) });
    const namespace = {
      idFromName: () => ({}),
      get: () => ({ fetch: (req: Request) => dobj.fetch(req) }),
    };
    return { state, hub: new DurableObjectMessageStreamHub(namespace as any) };
  }

  test("无绑定（Basic）连接：hub 不带内部 header，DO 接受 101，不参与续期", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const { state, hub } = makeHubToRealDo(testDb);

    const res = await hub.connect(
      7,
      undefined,
      new Request("https://notice.example/stream", {
        headers: { Upgrade: "websocket", Authorization: "Basic dXNlcjpwYXNz" },
      })
    );

    expect(res.status).toBe(101);
    expect(state.__sockets).toHaveLength(1);
    expect(state.__sockets[0].__attachment ?? null).toBeNull();
    expect(state.__getAlarm()).toBeNull();
  });

  test("带绑定连接：hub 内部 header 被 DO 校验接受（101 + attachment + 首个 alarm）", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Ccontract-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, {
      token,
      lastUsed: T0.toISOString(),
      expiresAfterInactivitySeconds: 600,
      expiresAt: new Date(T0.getTime() + 600_000).toISOString(),
    });
    const { state, hub } = makeHubToRealDo(testDb);

    const res = await hub.connect(
      7,
      seed.id,
      new Request(`https://notice.example/stream?token=${encodeURIComponent(token)}`, {
        headers: { Upgrade: "websocket", "X-Gotify-Key": token },
      }),
      { userId: 7, clientId: seed.id, tokenLookup: token }
    );

    expect(res.status).toBe(101);
    const ws = state.__sockets[0];
    expect(ws.__tags).toEqual([`client:${seed.id}`]);
    expect(ws.__attachment).toMatchObject({ v: 1, userId: 7, clientId: seed.id, tokenLookup: token });
    expect(state.__getAlarm()).toBe(T0.getTime() + 300_000);
  });
});

describe("凭据安全：D1/Drizzle 包装错误不得把 tokenLookup 带入日志/响应", () => {

  function withTokenLeakingFailure(testDb: TestDb, token: string) {
    const base = makeD1Sqlite(testDb);
    const db = {
      ...base,
      prepare(sql: string) {
        throw new Error(`Failed query: ${sql}\nparams: ${token}`);
      },
    } as unknown as D1Database;
    return db;
  }

  function capturedOutput(spy: jest.SpyInstance): string {
    return spy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(" ")).join("\n");
  }

  test("alarm 续期失败：日志只含固定类别与错误名，不含 tokenLookup，且仍记录了内容", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cleak-alarm-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, { token, deviceUid: "uid-leak-alarm" });
    const state = makeFakeState();
    const dobj = new MessageStreamHubObject(state, { DB: withTokenLeakingFailure(testDb, token) });
    const ws = makeFakeSocket();
    state.acceptWebSocket(ws, [`client:${seed.id}`]);
    ws.serializeAttachment({
      v: 1,
      userId: 7,
      clientId: seed.id,
      tokenLookup: token,
      expiresAfterInactivitySeconds: 60,
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await fireAlarm(dobj, state);

    const captured = capturedOutput(errorSpy);
    errorSpy.mockRestore();
    expect(captured).not.toContain(token);
    expect(captured).toContain("Bound stream client renewal failed");
    expect(captured.length).toBeGreaterThan("Bound stream client renewal failed".length);

    expect(ws.readyState).toBe(WS_OPEN);
  });

  test("文本 ping 续期失败：pong 照发，日志不含 tokenLookup，且仍记录了内容", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cleak-ping-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, { token, deviceUid: "uid-leak-ping" });
    const state = makeFakeState();
    const dobj = new MessageStreamHubObject(state, { DB: withTokenLeakingFailure(testDb, token) });
    const ws = makeFakeSocket();
    state.acceptWebSocket(ws, [`client:${seed.id}`]);
    ws.serializeAttachment({
      v: 1,
      userId: 7,
      clientId: seed.id,
      tokenLookup: token,
      expiresAfterInactivitySeconds: 60,
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(ws, "ping");

    const captured = capturedOutput(errorSpy);
    errorSpy.mockRestore();
    expect(ws.sent).toContain("pong");
    expect(captured).not.toContain(token);
    expect(captured).toContain("Failed to renew bound stream client on ping");
    expect(captured.length).toBeGreaterThan("Failed to renew bound stream client on ping".length);
  });

  test("connect 绑定校验失败（未包装的原始驱动错误）：日志与响应均为固定文案，不含 tokenLookup", async () => {
    jest.useFakeTimers().setSystemTime(T0);
    const testDb = createTestDb();
    seedUser(testDb);
    const token = "Cleak-conn-" + Math.random().toString(36).slice(2, 20);
    const seed = seedClient(testDb, { token, deviceUid: "uid-leak-conn" });
    const state = makeFakeState();
    const dobj = new MessageStreamHubObject(state, { DB: withTokenLeakingFailure(testDb, token) });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await dobj.fetch(
      new Request(`https://hub.internal/connect?clientId=${seed.id}`, {
        headers: bindingHeaders({ userId: 7, clientId: seed.id, tokenLookup: token }),
      })
    );

    const captured = capturedOutput(errorSpy);
    errorSpy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Stream binding validation failed");
    expect(captured).not.toContain(token);
    expect(captured).toContain("Stream connect binding validation failed");
    expect(captured.length).toBeGreaterThan("Stream connect binding validation failed".length);
    expect(state.__sockets).toHaveLength(0);
  });
});
