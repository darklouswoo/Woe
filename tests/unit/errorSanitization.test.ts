import { parseJsonBody, createErrorHandler } from "../../src/utils/response";

describe("parseJsonBody", () => {
  test("合法 JSON → 返回数据", async () => {
    const req = new Request("https://x/", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    const result = await parseJsonBody<{ a: number }>(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.a).toBe(1);
  });

  test("畸形 JSON → ok:false 且 response 为 400 Invalid JSON body", async () => {
    const req = new Request("https://x/", {
      method: "POST",
      body: "{not json",
    });
    const result = await parseJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json() as any;
      expect(body.errorDescription).toBe("Invalid JSON body");
    }
  });

  test("字面 null 体 → ok:false 且 response 为 400 Invalid JSON body（不再以 data:null 放行）", async () => {
    const req = new Request("https://x/", {
      method: "POST",
      body: "null",
    });
    const result = await parseJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json() as any;
      expect(body.errorDescription).toBe("Invalid JSON body");
    }
  });
});

describe("createErrorHandler（app.onError 用）", () => {
  test("500 响应体不含原始错误消息", async () => {
    const handler = createErrorHandler();
    const res = await handler(new Error("D1 SQL error: no such table users at line 1"), { req: new Request("https://x/"), res: null } as any);
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.errorDescription).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("no such table");
  });

  test("非 Error 抛出物也返回通用 500", async () => {
    const handler = createErrorHandler();
    const res = await handler("weird throw" as any, { req: new Request("https://x/"), res: null } as any);
    expect(res.status).toBe(500);
  });
});
