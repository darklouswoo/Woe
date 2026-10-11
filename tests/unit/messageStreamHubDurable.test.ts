















import { fireAlarm } from "../helpers/durableAlarm";
import { MessageStreamHubObject } from "../../src/durable/messageStreamHub";
import { StreamClientRenewalError } from "../../src/services/streamClientActivity.ts";

const mockRefreshBoundStreamClient = jest.fn();
const mockLoadStreamClientBindingState = jest.fn();

jest.mock("../../src/services/streamClientActivity.ts", () => {
  const actual = jest.requireActual("../../src/services/streamClientActivity.ts");
  return {
    ...actual,
    refreshBoundStreamClient: (...args: any[]) => mockRefreshBoundStreamClient(...args),
    loadStreamClientBindingState: (...args: any[]) => mockLoadStreamClientBindingState(...args),
  };
});


function makeFakeSocket() {
  const ws: any = {
    readyState: 1,
    sent: [] as string[],
    closeCode: undefined as number | undefined,
    closeReason: undefined as string | undefined,
    __attachment: null as unknown,
    __tags: [] as string[],
  };
  ws.send = jest.fn((m: string) => {
    if (ws.readyState !== 1) throw new Error("send on non-open socket");
    ws.sent.push(m);
  });
  ws.close = jest.fn((code?: number, reason?: string) => {
    if (ws.readyState === 3) return;
    ws.readyState = 3;
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
  const autoResponseCalls: any[] = [];
  const acceptTags: any[] = [];
  const socketTags = new Map<any, string[]>();
  let alarm: number | null = null;
  return {
    __sockets: sockets,
    acceptWebSocket: jest.fn((ws: any, tags?: string[]) => {
      sockets.push(ws);
      acceptTags.push(tags);
      ws.__tags = tags ?? [];
      socketTags.set(ws, tags ?? []);
    }),
    getWebSockets: jest.fn((tag?: string) =>
      tag ? sockets.filter((s) => (socketTags.get(s) ?? []).includes(tag)) : [...sockets]
    ),
    setWebSocketAutoResponse: jest.fn((pair: any) => autoResponseCalls.push(pair)),
    getTags: jest.fn((ws: any) => socketTags.get(ws) ?? ws.__tags ?? []),
    storage: {
      getAlarm: jest.fn(async () => alarm),
      setAlarm: jest.fn(async (t: number | Date) => {
        alarm = typeof t === "number" ? t : t.getTime();
      }),
      deleteAlarm: jest.fn(async () => {
        alarm = null;
      }),
    },
    __autoResponseCalls: autoResponseCalls,
    __acceptTags: acceptTags,
    __socketTags: socketTags,
    __getAlarm: () => alarm,
    __setAlarm: (t: number | null) => {
      alarm = t;
    },
  };
}


function makeAttachment(overrides: Record<string, unknown> = {}) {
  return { v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 600, ...overrides };
}

describe("MessageStreamHubObject hibernation", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockRefreshBoundStreamClient.mockReset();
    mockLoadStreamClientBindingState.mockReset();
  });

  test("构造不再注册 setWebSocketAutoResponse（自动应答会绕过 webSocketMessage 业务处理器）", () => {
    const state = makeFakeState() as any;
    new MessageStreamHubObject(state, {});
    expect(state.setWebSocketAutoResponse).not.toHaveBeenCalled();
  });

  test("webSocketMessage 对文本 ping 回复 pong，并按连接 attachment 绑定触发续期", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: Date.now() + 300_000 });

    await dobj.webSocketMessage(ws as any, "ping");

    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(mockRefreshBoundStreamClient).toHaveBeenCalledTimes(1);
    expect(mockRefreshBoundStreamClient.mock.calls[0][1]).toEqual({
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
    });
  });

  test("绑定失效（invalid）的 ping：先回 pong，再按凭据失效关闭连接", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "invalid" });

    await dobj.webSocketMessage(ws as any, "ping");

    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(ws.close).toHaveBeenCalledWith(4002, expect.any(String));
  });

  test("旧形态连接（只有 client tag、没有 attachment）收到 ping：回 pong 后关闭并要求重认证（4003），不续期", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    state.__socketTags.set(ws, ["client:7"]);

    await dobj.webSocketMessage(ws as any, "ping");

    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(ws.close).toHaveBeenCalledWith(4003, expect.any(String));
    expect(mockRefreshBoundStreamClient).not.toHaveBeenCalled();
  });

  test("无 client tag 的连接收到 ping：回复 pong 但不触发刷新、不关闭（Basic 保持连接功能）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();

    await dobj.webSocketMessage(ws as any, "ping");

    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(ws.close).not.toHaveBeenCalled();
    expect(mockRefreshBoundStreamClient).not.toHaveBeenCalled();
  });

  test("env 缺少 D1 绑定时 ping 仍回复 pong、不触发刷新、不抛错", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, {});
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());

    await expect(dobj.webSocketMessage(ws as any, "ping")).resolves.toBeUndefined();

    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(mockRefreshBoundStreamClient).not.toHaveBeenCalled();
  });

  test("非 ping 文本消息忽略：不回复、不刷新", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());

    await dobj.webSocketMessage(ws as any, "hello");

    expect(ws.send).not.toHaveBeenCalled();
    expect(mockRefreshBoundStreamClient).not.toHaveBeenCalled();
  });

  test("刷新失败不阻断 pong 应答也不抛出（静默降级）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());
    mockRefreshBoundStreamClient.mockRejectedValueOnce(new Error("D1 down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(dobj.webSocketMessage(ws as any, "ping")).resolves.toBeUndefined();

    expect(ws.send).toHaveBeenCalledWith("pong");
    errorSpy.mockRestore();
  });

  test("broadcast 向 getWebSockets 的所有连接发送", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, {});
    const sender = { send: jest.fn() };
    state.__sockets.push(sender);
    const res = await dobj.fetch(
      new Request("https://hub.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { id: 1 } }),
      })
    );
    expect(res.status).toBe(200);
    expect(sender.send).toHaveBeenCalledWith(JSON.stringify({ id: 1 }));
    expect(state.getWebSockets).toHaveBeenCalled();
  });

  test("发送失败的连接被关闭并计入 failed，其余照发", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, {});
    const dead = { send: jest.fn(() => { throw new Error("closed"); }), close: jest.fn() };
    const alive = { send: jest.fn() };
    state.__sockets.push(dead, alive);
    const res = await dobj.fetch(
      new Request("https://hub.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { id: 2 } }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ delivered: 1, failed: 1 });
    expect(dead.close).toHaveBeenCalledWith(1011, "broadcast send failed");
    expect(alive.send).toHaveBeenCalledWith(JSON.stringify({ id: 2 }));
  });

  test("connect 使用 state.acceptWebSocket 托管连接（hibernation）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, {});
    const res = await dobj.fetch(
      new Request("https://hub.internal/connect", {
        headers: { Upgrade: "websocket" },
      })
    );
    expect(res.status).toBe(101);
    expect(state.acceptWebSocket).toHaveBeenCalledTimes(1);
    expect(state.__acceptTags[0]).toBeUndefined();
    expect(state.__sockets).toHaveLength(1);
  });

  test("connect 为客户端连接绑定 client 标签", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, {});
    await dobj.fetch(new Request("https://hub.internal/connect?clientId=7", {
      headers: { Upgrade: "websocket" },
    }));
    expect(state.__acceptTags[0]).toEqual(["client:7"]);
  });

  test("disconnect 按客户端标签关闭连接并返回关闭统计", async () => {
    const state = makeFakeState() as any;
    const target = { close: jest.fn() };
    const other = { close: jest.fn() };
    state.__sockets.push(target, other);
    state.getWebSockets = jest.fn((tag?: string) => tag === "client:7" ? [target] : state.__sockets);
    const dobj = new MessageStreamHubObject(state, {});
    const response = await dobj.fetch(new Request("https://hub.internal/disconnect?clientId=7", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(target.close).toHaveBeenCalledWith(4001, "client deleted");
    expect(other.close).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ closed: 1, failed: 0 });
  });

  test("单条连接关闭失败时继续处理其余连接并计数", async () => {
    const state = makeFakeState() as any;
    const failed = { close: jest.fn(() => { throw new Error("already closed"); }) };
    const closed = { close: jest.fn() };
    state.getWebSockets = jest.fn(() => [failed, closed]);
    const dobj = new MessageStreamHubObject(state, {});

    const response = await dobj.fetch(new Request("https://hub.internal/disconnect?clientId=7", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(closed.close).toHaveBeenCalledWith(4001, "client deleted");
    expect(await response.json()).toEqual({ closed: 1, failed: 1 });
  });

  test("非 websocket 升级请求 → 426；未知路径 → 404；畸形 broadcast body → 400", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, {});
    const notWs = await dobj.fetch(new Request("https://hub.internal/connect"));
    expect(notWs.status).toBe(426);
    const unknown = await dobj.fetch(new Request("https://hub.internal/other"));
    expect(unknown.status).toBe(404);
    const badBody = await dobj.fetch(
      new Request("https://hub.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid",
      })
    );
    expect(badBody.status).toBe(400);
    const noMessage = await dobj.fetch(
      new Request("https://hub.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(noMessage.status).toBe(400);
  });
});

describe("MessageStreamHubObject 连接绑定续期（alarm / close / connect 校验，mock 绑定服务）", () => {
  const T0 = new Date("2026-10-08T00:00:00.000Z").getTime();

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(T0));
    mockRefreshBoundStreamClient.mockReset();
    mockLoadStreamClientBindingState.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function bindingHeaders(b: { userId: number; clientId: number; tokenLookup: string }) {
    return {
      Upgrade: "websocket",
      "X-Woe-Stream-User-Id": String(b.userId),
      "X-Woe-Stream-Client-Id": String(b.clientId),
      "X-Woe-Stream-Token-Lookup": b.tokenLookup,
    };
  }

  test("connect 带绑定：校验通过后写入 attachment、保留 client tag，并按应刷新时刻调度 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    mockLoadStreamClientBindingState.mockResolvedValue({
      status: "active",
      state: {
        lastUsed: new Date(T0).toISOString(),
        expiresAfterInactivitySeconds: 600,
        expiresAt: new Date(T0 + 600_000).toISOString(),
      },
    });

    const res = await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=7", {
        headers: bindingHeaders({ userId: 9, clientId: 7, tokenLookup: "Clookup-1" }),
      })
    );

    expect(res.status).toBe(101);
    expect(mockLoadStreamClientBindingState).toHaveBeenCalledTimes(1);
    expect(mockLoadStreamClientBindingState.mock.calls[0][1]).toEqual({
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
    });
    const ws = state.__sockets[0];
    expect(state.__acceptTags[0]).toEqual(["client:7"]);
    expect(ws.__attachment).toEqual({
      v: 1,
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
      expiresAfterInactivitySeconds: 600,
    });

    expect(state.__getAlarm()).toBe(T0 + 300_000);
  });

  test("connect 带绑定但校验 invalid → 401，不接受连接、不调度 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    mockLoadStreamClientBindingState.mockResolvedValue({ status: "invalid" });

    const res = await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=7", {
        headers: bindingHeaders({ userId: 9, clientId: 7, tokenLookup: "Cstale" }),
      })
    );

    expect(res.status).toBe(401);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
    expect(state.__getAlarm()).toBeNull();
  });

  test("connect 校验抛错（D1 故障）→ 500，不接受连接", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    mockLoadStreamClientBindingState.mockRejectedValue(new Error("D1 down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=7", {
        headers: bindingHeaders({ userId: 9, clientId: 7, tokenLookup: "Clookup-1" }),
      })
    );

    expect(res.status).toBe(500);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("connect 绑定头不完整或与 query clientId 不一致 → 400", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });

    const partial = await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=7", {
        headers: { Upgrade: "websocket", "X-Woe-Stream-Client-Id": "7" },
      })
    );
    expect(partial.status).toBe(400);



    const userIdOnly = await dobj.fetch(
      new Request("https://hub.internal/connect", {
        headers: { Upgrade: "websocket", "X-Woe-Stream-User-Id": "9" },
      })
    );
    expect(userIdOnly.status).toBe(400);

    const mismatch = await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=8", {
        headers: bindingHeaders({ userId: 9, clientId: 7, tokenLookup: "Clookup-1" }),
      })
    );
    expect(mismatch.status).toBe(400);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
    expect(mockLoadStreamClientBindingState).not.toHaveBeenCalled();
  });

  test("alarm 尾段与并发 connect 的更早 alarm 取最小（不被覆盖为更晚）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());
    state.__sockets.push(ws);

    mockRefreshBoundStreamClient.mockImplementation(async () => {
      state.__setAlarm(T0 + 30_000);
      return { status: "active", refreshDueAtMs: T0 + 300_000 };
    });

    await fireAlarm(dobj, state);


    expect(state.__getAlarm()).toBe(T0 + 30_000);
  });

  test.each([
    ["等待期间到期", 301_000, 308_000],
    ["接入时已经到期", 293_000, 302_000],
  ])("alarm 慢查询期间 connect 的排程%s：保留已到期的绝对时刻", async (_label, lastUsedOffset, tailOffset) => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const existing = makeFakeSocket();
    existing.serializeAttachment(makeAttachment());
    state.__sockets.push(existing);
    jest.setSystemTime(new Date(T0 + 300_000));
    mockRefreshBoundStreamClient.mockImplementationOnce(async () => {
      expect(await state.storage.getAlarm()).toBeNull();
      jest.setSystemTime(new Date(T0 + 301_000));
      mockLoadStreamClientBindingState.mockResolvedValueOnce({
        status: "active",
        state: {
          lastUsed: new Date(T0 + lastUsedOffset).toISOString(),
          expiresAfterInactivitySeconds: 10,
          expiresAt: new Date(T0 + lastUsedOffset + 10_000).toISOString(),
        },
      });
      const response = await dobj.fetch(new Request("https://hub.internal/connect?clientId=8", {
        headers: bindingHeaders({ userId: 9, clientId: 8, tokenLookup: "Cnew" }),
      }));
      expect(response.status).toBe(101);
      expect(state.__getAlarm()).toBe(T0 + lastUsedOffset + 5_000);
      jest.setSystemTime(new Date(T0 + tailOffset));
      return { status: "active", currentSeconds: 600, refreshDueAtMs: T0 + 600_000 };
    });

    await fireAlarm(dobj, state);

    expect(mockRefreshBoundStreamClient).toHaveBeenCalledTimes(1);
    expect(state.__getAlarm()).toBe(T0 + lastUsedOffset + 5_000);
    expect(state.__getAlarm()).toBeLessThan(Date.now());
  });

  test("alarm 尾段删除前复查：并发接入的绑定连接阻止 deleteAlarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const stale = makeFakeSocket();
    stale.serializeAttachment(makeAttachment({ clientId: 7, tokenLookup: "Cold" }));
    state.__sockets.push(stale);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockImplementation(async () => {

      const fresh = makeFakeSocket();
      fresh.serializeAttachment(makeAttachment({ clientId: 8, tokenLookup: "Cnew" }));
      state.__sockets.push(fresh);
      state.__setAlarm(T0 + 30_000);
      return { status: "invalid" };
    });

    await fireAlarm(dobj, state);

    expect(stale.close).toHaveBeenCalledWith(4002, expect.any(String));
    expect(state.storage.deleteAlarm).not.toHaveBeenCalled();
    expect(state.__getAlarm()).toBe(T0 + 30_000);
  });

  test("connect 不因新连接覆盖更早的既有 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    state.__setAlarm(T0 + 30_000);
    mockLoadStreamClientBindingState.mockResolvedValue({
      status: "active",
      state: {
        lastUsed: new Date(T0).toISOString(),
        expiresAfterInactivitySeconds: 600,
        expiresAt: new Date(T0 + 600_000).toISOString(),
      },
    });

    await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=7", {
        headers: bindingHeaders({ userId: 9, clientId: 7, tokenLookup: "Clookup-1" }),
      })
    );

    expect(state.__getAlarm()).toBe(T0 + 30_000);
  });

  test("alarm 只遍历 OPEN 连接，按三元组去重，下一 alarm 取最早应刷新时刻", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const a1 = makeFakeSocket();
    a1.serializeAttachment(makeAttachment());
    const a2 = makeFakeSocket();
    a2.serializeAttachment(makeAttachment());
    const b = makeFakeSocket();
    b.serializeAttachment(makeAttachment({ clientId: 8, tokenLookup: "Clookup-2", expiresAfterInactivitySeconds: 60 }));
    const closed = makeFakeSocket();
    closed.serializeAttachment(makeAttachment({ clientId: 9, tokenLookup: "Clookup-3" }));
    closed.readyState = 3;
    const basic = makeFakeSocket();
    state.__sockets.push(a1, a2, b, closed, basic);
    mockRefreshBoundStreamClient.mockImplementation(async (_db: any, binding: any) =>
      binding.clientId === 7
        ? { status: "active", refreshDueAtMs: T0 + 300_000 }
        : { status: "active", refreshDueAtMs: T0 + 30_000 }
    );

    await fireAlarm(dobj, state);

    expect(mockRefreshBoundStreamClient).toHaveBeenCalledTimes(2);
    const seen = mockRefreshBoundStreamClient.mock.calls.map((c) => c[1]);
    expect(seen).toContainEqual({ userId: 9, clientId: 7, tokenLookup: "Clookup-1" });
    expect(seen).toContainEqual({ userId: 9, clientId: 8, tokenLookup: "Clookup-2" });
    expect(closed.close).not.toHaveBeenCalled();
    expect(basic.close).not.toHaveBeenCalled();
    expect(state.__getAlarm()).toBe(T0 + 30_000);
  });

  test("alarm 对 invalid 绑定关闭连接（4002），剩余有效绑定继续调度", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const stale = makeFakeSocket();
    stale.serializeAttachment(makeAttachment({ clientId: 7, tokenLookup: "Cold" }));
    const live = makeFakeSocket();
    live.serializeAttachment(makeAttachment({ clientId: 8, tokenLookup: "Cnew", expiresAfterInactivitySeconds: 60 }));
    state.__sockets.push(stale, live);
    mockRefreshBoundStreamClient.mockImplementation(async (_db: any, binding: any) =>
      binding.clientId === 7 ? { status: "invalid" } : { status: "active", refreshDueAtMs: T0 + 30_000 }
    );

    await fireAlarm(dobj, state);

    expect(stale.close).toHaveBeenCalledWith(4002, expect.any(String));
    expect(live.close).not.toHaveBeenCalled();
    expect(state.__getAlarm()).toBe(T0 + 30_000);
  });

  test("alarm 对旧形态连接（tag、无 attachment）关闭并要求重认证（4003）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const legacy = makeFakeSocket();
    state.acceptWebSocket(legacy, ["client:7"]);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 300_000 });

    await fireAlarm(dobj, state);

    expect(legacy.close).toHaveBeenCalledWith(4003, expect.any(String));
    expect(mockRefreshBoundStreamClient).not.toHaveBeenCalled();
    expect(state.__getAlarm()).toBeNull();
  });

  test("alarm 续期遇 D1 失败按 min(10000, 半周期) 重试（attachment 秒数 60 → 10s）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 60 }));
    state.__sockets.push(ws);
    mockRefreshBoundStreamClient.mockRejectedValue(new Error("D1 down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await fireAlarm(dobj, state);

    expect(state.__getAlarm()).toBe(T0 + 10_000);
    errorSpy.mockRestore();
  });

  test("失败路径携带当前策略（StreamClientRenewalError.currentSeconds=10）：重试按当前半周期 5s，而非陈旧 attachment 600s 的 10s", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    mockRefreshBoundStreamClient.mockRejectedValue(new StreamClientRenewalError(10, new Error("D1 down")));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await fireAlarm(dobj, state);

    expect(state.__getAlarm()).toBe(T0 + 5_000);
    errorSpy.mockRestore();
  });



  test("失败携带可信当前策略：attachment 同步为 10，下一轮 D1 完全不可读仍按 5s 重试（不是 10s）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);

    mockRefreshBoundStreamClient.mockRejectedValueOnce(
      new StreamClientRenewalError(10, new Error("D1 write failed"))
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await fireAlarm(dobj, state);


    expect(state.__getAlarm()).toBe(T0 + 5_000);

    expect(ws.__attachment).toEqual({
      v: 1,
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
      expiresAfterInactivitySeconds: 10,
    });



    jest.setSystemTime(new Date(T0 + 5_000));
    mockRefreshBoundStreamClient.mockRejectedValueOnce(new Error("D1 completely down"));
    await fireAlarm(dobj, state);
    errorSpy.mockRestore();

    expect(state.__getAlarm()).toBe(T0 + 10_000);
    expect(state.__getAlarm()).not.toBe(T0 + 15_000);
  });

  test("alarm 成功读到与快照不同的当前策略：attachment 调度提示被同步为当前值", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await fireAlarm(dobj, state);

    expect(ws.__attachment).toEqual({
      v: 1,
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
      expiresAfterInactivitySeconds: 10,
    });
    expect(state.__getAlarm()).toBe(T0 + 5_000);
  });

  test("alarm 续期失败日志不含 tokenLookup（包装 message 内嵌凭据，只记录错误类别）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ tokenLookup: "Cleak-alarm-zzz" }));
    state.__sockets.push(ws);
    mockRefreshBoundStreamClient.mockRejectedValue(
      new Error('Failed query: update "clients" ...\nparams: Cleak-alarm-zzz')
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await fireAlarm(dobj, state);

    const captured = errorSpy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(" ")).join("\n");
    errorSpy.mockRestore();
    expect(captured).not.toContain("Cleak-alarm-zzz");
    expect(captured).toContain("Bound stream client renewal failed");
    expect(captured.length).toBeGreaterThan("Bound stream client renewal failed".length);
  });

  test("ping 续期失败日志不含 tokenLookup（包装 message 内嵌凭据，只记录错误类别）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ tokenLookup: "Cleak-ping-zzz" }));
    mockRefreshBoundStreamClient.mockRejectedValue(
      new Error('Failed query: select ... where "token" = ?\nparams: Cleak-ping-zzz')
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(ws as any, "ping");

    const captured = errorSpy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(" ")).join("\n");
    errorSpy.mockRestore();
    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(captured).not.toContain("Cleak-ping-zzz");
    expect(captured).toContain("Failed to renew bound stream client on ping");
    expect(captured.length).toBeGreaterThan("Failed to renew bound stream client on ping".length);
  });





  test("ping 成功且 currentSeconds 与 attachment 不同：attachment 同步为当前策略，alarm 前移到绝对应刷新时刻（不晚于既有值）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await dobj.webSocketMessage(ws as any, "ping");

    expect(ws.send).toHaveBeenCalledWith("pong");

    expect(ws.__attachment).toEqual({
      v: 1,
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
      expiresAfterInactivitySeconds: 10,
    });

    expect(state.__getAlarm()).toBe(T0 + 5_000);
    expect(state.__getAlarm()).toBeLessThanOrEqual(T0 + 300_000);
  });

  test("ping 失败携带可信当前策略（StreamClientRenewalError.currentSeconds=10）：attachment 同步为 10，alarm 安排 now+streamClientRetryAfterMs(10)=5s", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockRejectedValue(new StreamClientRenewalError(10, new Error("D1 down")));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(ws as any, "ping");

    expect(ws.send).toHaveBeenCalledWith("pong");
    expect(ws.__attachment).toEqual({
      v: 1,
      userId: 9,
      clientId: 7,
      tokenLookup: "Clookup-1",
      expiresAfterInactivitySeconds: 10,
    });
    expect(state.__getAlarm()).toBe(T0 + 5_000);
    errorSpy.mockRestore();
  });

  test("ping 普通失败（无可信策略，含 currentSeconds=undefined 的包装错误）：attachment 与既有 alarm 均不变", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockRejectedValueOnce(new StreamClientRenewalError(undefined, new Error("D1 completely down")));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(ws as any, "ping");
    await dobj.webSocketMessage(ws as any, "ping");


    expect(ws.serializeAttachment).toHaveBeenCalledTimes(1);
    expect(ws.__attachment).toEqual(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    expect(state.__getAlarm()).toBe(T0 + 300_000);
    errorSpy.mockRestore();
  });

  test("ping 成功且 currentSeconds 与 attachment 相同：不重写 attachment，但 alarm 仍按绝对 due 前移", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 120_000, currentSeconds: 600 });

    await dobj.webSocketMessage(ws as any, "ping");


    expect(ws.serializeAttachment).toHaveBeenCalledTimes(1);
    expect(ws.__attachment).toEqual(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    expect(state.__getAlarm()).toBe(T0 + 120_000);
  });





  test("ping 成功携带可信策略：同一三元组的所有 OPEN 连接提示均同步为当前值（不只发送者）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const a = makeFakeSocket();
    a.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    const b = makeFakeSocket();
    b.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(a, b);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await dobj.webSocketMessage(b as any, "ping");

    expect(b.send).toHaveBeenCalledWith("pong");
    const synced = { v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10 };
    expect(b.__attachment).toEqual(synced);
    expect(a.__attachment).toEqual(synced);
  });

  test("ping 失败携带可信策略：同一三元组的所有 OPEN 连接提示均同步，重试 alarm=now+5000", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const a = makeFakeSocket();
    a.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    const b = makeFakeSocket();
    b.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(a, b);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockRejectedValue(new StreamClientRenewalError(10, new Error("D1 down")));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(b as any, "ping");

    const synced = { v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10 };
    expect(a.__attachment).toEqual(synced);
    expect(b.__attachment).toEqual(synced);
    expect(state.__getAlarm()).toBe(T0 + 5_000);
    errorSpy.mockRestore();
  });





  test.each([
    ["stale-first", true],
    ["sender-first", false],
  ])("枚举顺序回归（%s）：ping 同步后 D1 完全不可读的 alarm 重试 +5000ms（不因首个枚举连接的陈旧提示 +10000ms）", async (_label: string, staleFirst: boolean) => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const stale = makeFakeSocket();
    stale.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    const sender = makeFakeSocket();
    sender.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(...(staleFirst ? [stale, sender] : [sender, stale]));
    mockRefreshBoundStreamClient.mockResolvedValueOnce({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(sender as any, "ping");
    expect(state.__getAlarm()).toBe(T0 + 5_000);




    jest.setSystemTime(new Date(T0 + 5_000));
    mockRefreshBoundStreamClient.mockRejectedValueOnce(new Error("D1 completely down"));
    await fireAlarm(dobj, state);
    errorSpy.mockRestore();

    expect(state.__getAlarm()).toBe(T0 + 10_000);
    expect(state.__getAlarm()).not.toBe(T0 + 15_000);
  });

  test("三元组不匹配守卫：同 clientId 不同 tokenLookup（轮换凭据）、不同 userId/clientId 的 OPEN 连接不被同步", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const sender = makeFakeSocket();
    sender.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    const rotated = makeFakeSocket();
    rotated.serializeAttachment(makeAttachment({ clientId: 7, tokenLookup: "Crotated-2", expiresAfterInactivitySeconds: 600 }));
    const foreign = makeFakeSocket();
    foreign.serializeAttachment(makeAttachment({ userId: 10, clientId: 11, tokenLookup: "Cother-3", expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(sender, rotated, foreign);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await dobj.webSocketMessage(sender as any, "ping");

    expect(sender.__attachment).toEqual({
      v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10,
    });

    expect(rotated.__attachment).toEqual(makeAttachment({ clientId: 7, tokenLookup: "Crotated-2", expiresAfterInactivitySeconds: 600 }));
    expect(foreign.__attachment).toEqual(makeAttachment({ userId: 10, clientId: 11, tokenLookup: "Cother-3", expiresAfterInactivitySeconds: 600 }));
  });

  test("多连接 same-seconds 守卫：同三元组连接均已等于 currentSeconds 时均不重写（每连接仅 setup 一次序列化）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const a = makeFakeSocket();
    a.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 10 }));
    const b = makeFakeSocket();
    b.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 10 }));
    state.__sockets.push(a, b);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await dobj.webSocketMessage(b as any, "ping");

    expect(a.serializeAttachment).toHaveBeenCalledTimes(1);
    expect(b.serializeAttachment).toHaveBeenCalledTimes(1);
    expect(state.__getAlarm()).toBe(T0 + 5_000);
  });

  test("发送者提示已等于 currentSeconds 但同三元组其余连接陈旧：陈旧连接仍被同步（逐连接判定，非仅按发送者）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const current = makeFakeSocket();
    current.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 10 }));
    const stale = makeFakeSocket();
    stale.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(current, stale);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await dobj.webSocketMessage(current as any, "ping");

    expect(current.serializeAttachment).toHaveBeenCalledTimes(1);
    expect(stale.__attachment).toEqual({
      v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10,
    });
  });






  test("发送者等待期间关闭、同凭据另一连接仍 OPEN：提示同步发生、alarm 仍按绝对 due 前移", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const a = makeFakeSocket();
    a.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    const b = makeFakeSocket();
    b.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(a, b);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockImplementation(async () => {
      b.readyState = 3;
      return { status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 };
    });

    await dobj.webSocketMessage(b as any, "ping");

    expect(b.send).toHaveBeenCalledWith("pong");
    const synced = { v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10 };
    expect(a.__attachment).toEqual(synced);
    expect(state.__getAlarm()).toBe(T0 + 5_000);
  });

  test("发送者等待期间关闭（失败路径）、同凭据另一连接仍 OPEN：提示同步 + 短周期重试 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const a = makeFakeSocket();
    a.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    const b = makeFakeSocket();
    b.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(a, b);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockImplementation(async () => {
      b.readyState = 3;
      throw new StreamClientRenewalError(10, new Error("D1 down"));
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketMessage(b as any, "ping");

    const synced = { v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10 };
    expect(a.__attachment).toEqual(synced);
    expect(state.__getAlarm()).toBe(T0 + 5_000);
    errorSpy.mockRestore();
  });

  test("发送者等待期间关闭且无同组存活连接：不调度（alarm 清理由 webSocketClose 负责）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    mockRefreshBoundStreamClient.mockImplementation(async () => {
      ws.readyState = 3;
      return { status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 };
    });

    await dobj.webSocketMessage(ws as any, "ping");


    expect(state.__getAlarm()).toBe(T0 + 300_000);
    expect(state.storage.setAlarm).not.toHaveBeenCalled();
  });




  test("alarm 提示同步逐连接校正：首条已等于当前策略、同组其余陈旧仍被同步（不只比较首条 group.seconds）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const current = makeFakeSocket();
    current.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 10 }));
    const stale = makeFakeSocket();
    stale.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(current, stale);
    mockRefreshBoundStreamClient.mockResolvedValue({ status: "active", refreshDueAtMs: T0 + 5_000, currentSeconds: 10 });

    await fireAlarm(dobj, state);

    expect(current.serializeAttachment).toHaveBeenCalledTimes(1);
    expect(stale.__attachment).toEqual({
      v: 1, userId: 9, clientId: 7, tokenLookup: "Clookup-1", expiresAfterInactivitySeconds: 10,
    });
  });




  test("慢查询：ping 于 t=2 发起、服务 t=8 返回锚定起始 nowMs 的绝对 due=t=7 → alarm 得 t=7（立即触发语义）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    jest.setSystemTime(new Date(T0 + 2_000));
    mockRefreshBoundStreamClient.mockImplementation(async () => {
      jest.setSystemTime(new Date(T0 + 8_000));
      return { status: "active", refreshDueAtMs: T0 + 7_000, currentSeconds: 10 };
    });

    await dobj.webSocketMessage(ws as any, "ping");

    expect(state.__getAlarm()).toBe(T0 + 7_000);
    expect(state.__getAlarm()).not.toBe(T0 + 13_000);
  });

  test("慢查询（alarm 路径）：due 锚定服务起始 nowMs 的绝对值，alarm 收到后原样调度（不与 await 后时钟相加）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment({ expiresAfterInactivitySeconds: 600 }));
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    jest.setSystemTime(new Date(T0 + 2_000));
    mockRefreshBoundStreamClient.mockImplementation(async () => {
      jest.setSystemTime(new Date(T0 + 8_000));

      return { status: "active", refreshDueAtMs: T0 + 6_000, currentSeconds: 10 };
    });

    await fireAlarm(dobj, state);

    expect(state.__getAlarm()).toBe(T0 + 6_000);
    expect(state.__getAlarm()).not.toBe(T0 + 13_000);
  });

  test("connect 绑定校验失败日志不含 tokenLookup（校验 SELECT 的 WHERE 含 tokenLookup）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    mockLoadStreamClientBindingState.mockRejectedValue(
      new Error('Failed query: select ... where "token" = ?\nparams: Cleak-conn-zzz')
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await dobj.fetch(
      new Request("https://hub.internal/connect?clientId=7", {
        headers: bindingHeaders({ userId: 9, clientId: 7, tokenLookup: "Cleak-conn-zzz" }),
      })
    );

    const captured = errorSpy.mock.calls.map((args) => args.map((a: unknown) => String(a)).join(" ")).join("\n");
    errorSpy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Stream binding validation failed");
    expect(captured).not.toContain("Cleak-conn-zzz");
    expect(captured).toContain("Stream connect binding validation failed");
    expect(captured.length).toBeGreaterThan("Stream connect binding validation failed".length);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  test("alarm 无可用绑定连接时删除 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    state.__setAlarm(T0 + 300_000);

    await fireAlarm(dobj, state);

    expect(state.storage.deleteAlarm).toHaveBeenCalled();
    expect(state.__getAlarm()).toBeNull();
  });

  test("webSocketClose 显式回应 close 帧（compat 2025-11-28），最后一条绑定连接关闭后取消 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    ws.readyState = 3;

    await dobj.webSocketClose(ws as any, 1000, "client bye", true);

    expect(ws.close).toHaveBeenCalledWith(1000, "client bye");
    expect(state.__getAlarm()).toBeNull();
  });

  test("webSocketClose 仍有其他绑定连接时保留 alarm", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const closing = makeFakeSocket();
    closing.serializeAttachment(makeAttachment());
    closing.readyState = 3;
    const remaining = makeFakeSocket();
    remaining.serializeAttachment(makeAttachment({ clientId: 8, tokenLookup: "Cother" }));
    state.__sockets.push(closing, remaining);
    state.__setAlarm(T0 + 300_000);

    await dobj.webSocketClose(closing as any, 1000, "bye", true);

    expect(state.__getAlarm()).toBe(T0 + 300_000);
  });

  test("webSocketError 记录并关闭连接（不携带绑定信息）", async () => {
    const state = makeFakeState() as any;
    const dobj = new MessageStreamHubObject(state, { DB: {} });
    const ws = makeFakeSocket();
    ws.serializeAttachment(makeAttachment());
    state.__sockets.push(ws);
    state.__setAlarm(T0 + 300_000);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await dobj.webSocketError(ws as any, new Error("reset"));

    expect(ws.close).toHaveBeenCalled();
    expect(state.__getAlarm()).toBeNull();
    errorSpy.mockRestore();
  });
});
