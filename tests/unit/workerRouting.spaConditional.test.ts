



















jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true });

jest.mock("../../src/services/migrationRunner.ts", () => ({
  MigrationRunner: class {
    async runPendingMigrations() {}
  },
}));

import worker from "../../src/index";

const INDEX_ETAG = '"index-abc123"';
const ASSET_ETAG = '"asset-v1-js"';
const INDEX_HTML = "<!DOCTYPE html><html><body>spa</body></html>";


function createStatementStub() {
  const stmt: Record<string, unknown> = {};
  stmt.run = () => Promise.resolve({ results: [], success: true });
  stmt.all = () => Promise.resolve({ results: [] });
  stmt.first = () => Promise.resolve(null);
  stmt.bind = () => stmt;
  return stmt;
}

type AssetsMode = "plain" | "index-redirect";





function createSpaAssetsStub(mode: AssetsMode = "plain") {
  return {
    fetch: jest.fn(async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      const ifNoneMatch = request.headers.get("if-none-match");


      if (mode === "index-redirect" && pathname === "/index.html") {
        return new Response(null, { status: 307, headers: { Location: "/" } });
      }

      if (pathname === "/" || pathname === "/index.html") {
        if (ifNoneMatch === INDEX_ETAG) {
          return new Response(null, {
            status: 304,
            headers: { ETag: INDEX_ETAG },
          });
        }
        return new Response(INDEX_HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            ETag: INDEX_ETAG,
          },
        });
      }

      if (pathname === "/assets/app.js") {
        if (ifNoneMatch === ASSET_ETAG) {
          return new Response(null, {
            status: 304,
            headers: { ETag: ASSET_ETAG },
          });
        }
        return new Response("console.log('app');", {
          status: 200,
          headers: {
            "Content-Type": "application/javascript",
            ETag: ASSET_ETAG,
          },
        });
      }


      return new Response(null, { status: 404 });
    }),
  };
}

function createEnv(assets?: unknown) {
  const env: Record<string, unknown> = {
    DB: { prepare: () => createStatementStub() },
  };
  if (assets !== undefined) {
    env.ASSETS = assets;
  }
  return env as any;
}

const ctxStub = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

function get(path: string, ifNoneMatch?: string) {
  const headers: Record<string, string> = {};
  if (ifNoneMatch !== undefined) {
    headers["If-None-Match"] = ifNoneMatch;
  }
  return new Request(`https://woe.example${path}`, { headers });
}


function stubCall(stub: ReturnType<typeof createSpaAssetsStub>, n: number): Request {
  return stub.fetch.mock.calls[n][0] as Request;
}

describe("SPA 条件请求及缓存（F8）", () => {
  test("初次 404→index 200：深链无条件请求返回 200 HTML", async () => {
    const stub = createSpaAssetsStub("plain");
    const res = await worker.fetch(get("/apps/3"), createEnv(stub), ctxStub);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<!DOCTYPE html>");

    expect(new URL(stubCall(stub, 0).url).pathname).toBe("/apps/3");
    expect(new URL(stubCall(stub, 1).url).pathname).toBe("/index.html");
  });

  test("404→index 304：匹配 ETag 的深链得到 304 空体且原 ETag 保留", async () => {
    const stub = createSpaAssetsStub("plain");
    const res = await worker.fetch(
      get("/apps/3", INDEX_ETAG),
      createEnv(stub),
      ctxStub
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(INDEX_ETAG);

    expect((await res.arrayBuffer()).byteLength).toBe(0);

    expect(stubCall(stub, 1).headers.get("if-none-match")).toBe(INDEX_ETAG);
  });

  test("404→index 307→根：跳转后的根条件命中 304 同样透传", async () => {
    const stub = createSpaAssetsStub("index-redirect");
    const res = await worker.fetch(
      get("/apps/3", INDEX_ETAG),
      createEnv(stub),
      ctxStub
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(INDEX_ETAG);
    expect((await res.arrayBuffer()).byteLength).toBe(0);

    expect(new URL(stubCall(stub, 0).url).pathname).toBe("/apps/3");
    expect(new URL(stubCall(stub, 1).url).pathname).toBe("/index.html");
    expect(new URL(stubCall(stub, 2).url).pathname).toBe("/");

    expect(stubCall(stub, 2).headers.get("if-none-match")).toBe(INDEX_ETAG);
  });

  test("初次资产 304 透传：/assets/app.js 匹配 ETag → 304 空体 + ETag", async () => {
    const stub = createSpaAssetsStub("plain");
    const res = await worker.fetch(
      get("/assets/app.js", ASSET_ETAG),
      createEnv(stub),
      ctxStub
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(ASSET_ETAG);
    expect((await res.arrayBuffer()).byteLength).toBe(0);

    expect(res.headers.get("cache-control")).toContain("immutable");

    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  test("条件不匹配 200：过期 If-None-Match 的深链回退返回 200 HTML", async () => {
    const stub = createSpaAssetsStub("plain");
    const res = await worker.fetch(
      get("/apps/3", '"stale-etag"'),
      createEnv(stub),
      ctxStub
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");

    expect(res.headers.get("etag")).toBe(INDEX_ETAG);
  });

  test("缺失静态文件不变成 SPA HTML：/assets/missing.js 保持 404 且非 HTML", async () => {
    const stub = createSpaAssetsStub("plain");
    const res = await worker.fetch(
      get("/assets/missing.js"),
      createEnv(stub),
      ctxStub
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toContain("text/html");
    const text = await res.text();
    expect(text).not.toContain("<!DOCTYPE html>");
    expect(text).not.toContain(INDEX_HTML);
  });

  describe("后端分流保留（带 ASSETS 绑定时也不得截获）", () => {
    test("GET /gotifyinfo 进入后端且从不调用 ASSETS.fetch", async () => {
      const stub = createSpaAssetsStub("plain");
      const res = await worker.fetch(get("/gotifyinfo"), createEnv(stub), ctxStub);

      expect(stub.fetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(typeof JSON.parse(await res.text()).version).toBe("string");
    });

    test("POST /auth/logout 进入后端且从不调用 ASSETS.fetch", async () => {
      const stub = createSpaAssetsStub("plain");
      const res = await worker.fetch(
        new Request("https://woe.example/auth/logout", { method: "POST" }),
        createEnv(stub),
        ctxStub
      );

      expect(stub.fetch).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(JSON.parse(await res.text())).toEqual({
        error: "Unauthorized",
        errorCode: 401,
        errorDescription:
          "you need to provide a valid access token or user credentials to access this api"
      });
    });

    test("GET /api/v1/unknown 进入后端（Hono notFound 404 JSON）且从不调用 ASSETS.fetch", async () => {
      const stub = createSpaAssetsStub("plain");
      const res = await worker.fetch(
        get("/api/v1/unknown-endpoint"),
        createEnv(stub),
        ctxStub
      );

      expect(stub.fetch).not.toHaveBeenCalled();
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(JSON.parse(await res.text()).errorDescription).toBe("Endpoint not found");
    });
  });
});
