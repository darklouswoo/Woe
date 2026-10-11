













jest.mock("file-type", () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true });

jest.mock("../../src/services/migrationRunner.ts", () => ({
  MigrationRunner: class {
    async runPendingMigrations() {}
  },
}));

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import worker from "../../src/index";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);


function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}






const EXPECTED_PNG_SHA256 = "1f854444a9087c0497a597e999f4e80fc27f4139f44c5d1c24c046541ffb1004";
const EXPECTED_PNG_BYTES = 15750;

const bundledPng = readFileSync(
  join(__dirname, "../../frontend/public/static/defaultapp.png")
);

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function createStatementStub() {
  const stmt: Record<string, unknown> = {};
  stmt.run = () => Promise.resolve({ results: [], success: true });
  stmt.all = () => Promise.resolve({ results: [] });
  stmt.first = () => Promise.resolve(null);
  stmt.bind = () => stmt;
  return stmt;
}

type AssetsMode = "has-file" | "html-fallback" | "missing-file";


function createAssetsStub(mode: AssetsMode) {
  return {
    fetch: async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/static/defaultapp.png") {
        return new Response(null, { status: 404 });
      }
      if (mode === "has-file") {
        return new Response(bundledPng, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      if (mode === "html-fallback") {

        return new Response("<!DOCTYPE html><html><body>spa</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(null, { status: 404 });
    },
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

describe("默认应用图静态入口（双入口同一真实 PNG）", () => {
  test("入仓默认图命中固定 SHA-256 provenance 锁（经 Gotify 参考资源验证）", () => {
    expect(sha256Hex(bundledPng)).toBe(EXPECTED_PNG_SHA256);
    expect(bundledPng.length).toBe(EXPECTED_PNG_BYTES);
    expect(bytesEqual(bundledPng.subarray(0, 8), PNG_SIGNATURE)).toBe(true);
  });

  test.each([
    ["/static/defaultapp.png"],
    ["/api/v1/static/defaultapp.png"],
  ])("GET %s 返回真实 PNG 字节与 image/png", async (pathname) => {
    const res = await worker.fetch(
      new Request(`https://woe.example${pathname}`),
      createEnv(createAssetsStub("has-file")),
      ctxStub
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytesEqual(bytes.subarray(0, 8), PNG_SIGNATURE)).toBe(true);
    expect(bytesEqual(bytes, bundledPng)).toBe(true);
  });

  test("ASSETS 返回 HTML 200（SPA 回退伪装）→ 明确失败，不伪造 PNG 成功", async () => {
    const res = await worker.fetch(
      new Request("https://woe.example/static/defaultapp.png"),
      createEnv(createAssetsStub("html-fallback")),
      ctxStub
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(await res.text());
    expect(typeof body.errorDescription).toBe("string");
    expect(body.errorDescription.length).toBeGreaterThan(0);
  });

  test("ASSETS 缺文件（404）→ 明确失败", async () => {
    const res = await worker.fetch(
      new Request("https://woe.example/api/v1/static/defaultapp.png"),
      createEnv(createAssetsStub("missing-file")),
      ctxStub
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("无 ASSETS 绑定 → 明确失败（503），非 PNG 成功", async () => {
    const res = await worker.fetch(
      new Request("https://woe.example/static/defaultapp.png"),
      createEnv(undefined),
      ctxStub
    );

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(await res.text());
    expect(body.errorDescription).toContain("assets");
  });

  test("任意 /static/* 不改道 API：/static/other.png 落回前端/Hono 404，而非静态路由", async () => {


    const res = await worker.fetch(
      new Request("https://woe.example/static/other.png"),
      createEnv(undefined),
      ctxStub
    );

    expect(res.status).toBe(404);
    const body = JSON.parse(await res.text());
    expect(body.errorDescription).toBe("Endpoint not found");
  });
});
