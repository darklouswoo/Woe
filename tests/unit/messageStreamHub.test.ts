import { DurableObjectMessageStreamHub } from "../../src/services/messageStreamHub";

describe("DurableObjectMessageStreamHub", () => {
  test("connect should forward websocket upgrade request to user durable object", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const namespace = {
      idFromName: jest.fn().mockReturnValue({ toString: () => "user-do-id" }),
      get: jest.fn().mockReturnValue({ fetch: fetchMock })
    };

    const hub = new DurableObjectMessageStreamHub(namespace as any);
    const req = new Request("https://notice.example/stream?token=Cxxx", {
      headers: { Upgrade: "websocket" }
    });

    const res = await hub.connect(99, 12, req);

    expect(res.status).toBe(200);
    expect(namespace.idFromName).toHaveBeenCalledWith("user:99");
    expect(namespace.get).toHaveBeenCalledTimes(1);

    const forwardedRequest = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(forwardedRequest.url).pathname).toBe("/connect");
    expect(new URL(forwardedRequest.url).search).toBe("?clientId=12");
    expect(forwardedRequest.headers.get("upgrade")?.toLowerCase()).toBe("websocket");
  });

  test("broadcast should post payload to user durable object", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const namespace = {
      idFromName: jest.fn().mockReturnValue({ toString: () => "user-do-id" }),
      get: jest.fn().mockReturnValue({ fetch: fetchMock })
    };

    const hub = new DurableObjectMessageStreamHub(namespace as any);

    await hub.broadcast(7, {
      id: 8,
      appid: 42,
      message: "payload",
      title: "title",
      priority: 1,
      date: "2026-02-27T10:00:00.000Z"
    });

    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/broadcast");

    const body = await req.json();
    expect(body).toEqual({
      message: {
        id: 8,
        appid: 42,
        message: "payload",
        title: "title",
        priority: 1,
        date: "2026-02-27T10:00:00.000Z"
      }
    });
  });

  test("disconnectClient should post client id to the durable object", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const namespace = {
      idFromName: jest.fn().mockReturnValue({ toString: () => "user-do-id" }),
      get: jest.fn().mockReturnValue({ fetch: fetchMock })
    };
    const hub = new DurableObjectMessageStreamHub(namespace as any);

    await hub.disconnectClient(7, 12);

    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/disconnect");
    expect(new URL(req.url).search).toBe("?clientId=12");
  });

  test("connect 以内部 header 冻结绑定快照（hub 覆写同名 header），并剥离原请求凭据", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const namespace = {
      idFromName: jest.fn().mockReturnValue({ toString: () => "user-do-id" }),
      get: jest.fn().mockReturnValue({ fetch: fetchMock })
    };
    const hub = new DurableObjectMessageStreamHub(namespace as any);
    const req = new Request("https://notice.example/stream?token=Cquery-secret", {
      headers: {
        Upgrade: "websocket",
        Authorization: "Bearer Cbearer-secret",
        "X-Gotify-Key": "Cheader-secret",
        Cookie: "session=abc",

        "X-Woe-Stream-User-Id": "1",
        "X-Woe-Stream-Client-Id": "1",
        "X-Woe-Stream-Token-Lookup": "Cforged"
      }
    });

    await hub.connect(99, 12, req, { userId: 99, clientId: 12, tokenLookup: "Cdb-public-form" });

    const forwarded = fetchMock.mock.calls[0][0] as Request;
    expect(forwarded.headers.get("X-Woe-Stream-User-Id")).toBe("99");
    expect(forwarded.headers.get("X-Woe-Stream-Client-Id")).toBe("12");
    expect(forwarded.headers.get("X-Woe-Stream-Token-Lookup")).toBe("Cdb-public-form");

    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(forwarded.headers.get("x-gotify-key")).toBeNull();
    expect(forwarded.headers.get("cookie")).toBeNull();

    expect(new URL(forwarded.url).search).toBe("?clientId=12");
    expect(forwarded.headers.get("upgrade")?.toLowerCase()).toBe("websocket");
  });

  test("connect 无绑定（Basic）：不带任何内部 header，仍剥离凭据", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const namespace = {
      idFromName: jest.fn().mockReturnValue({ toString: () => "user-do-id" }),
      get: jest.fn().mockReturnValue({ fetch: fetchMock })
    };
    const hub = new DurableObjectMessageStreamHub(namespace as any);
    const req = new Request("https://notice.example/stream", {
      headers: { Upgrade: "websocket", Authorization: "Basic dXNlcjpwYXNz" }
    });

    await hub.connect(99, undefined, req);

    const forwarded = fetchMock.mock.calls[0][0] as Request;


    expect(forwarded.headers.get("X-Woe-Stream-User-Id")).toBeNull();
    expect(forwarded.headers.get("X-Woe-Stream-Client-Id")).toBeNull();
    expect(forwarded.headers.get("X-Woe-Stream-Token-Lookup")).toBeNull();
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(new URL(forwarded.url).search).toBe("");
  });
});
