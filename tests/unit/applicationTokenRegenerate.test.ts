import { ApplicationHandlers } from "../../src/handlers/applicationHandlers";
import { resolveTokenForLookup } from "../../src/utils/enhancedToken";

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn()
}), { virtual: true })

function createDrizzleMock(existingApp: any | null, options: { updateChanges?: number } = {}) {
  const state = { updatedToken: null as string | null, updateCalls: 0 };

  const updateChanges = options.updateChanges ?? (existingApp ? 1 : 0);
  return {
    __state: state,
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(existingApp),
        })),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn((payload: any) => {
        state.updatedToken = payload.token;
        return {
          where: jest.fn(() => {
            state.updateCalls += 1;
            return Promise.resolve({ meta: { changes: updateChanges } });
          }),
        };
      }),
    })),
  };
}

describe("regenerateApplicationToken（对齐 gotify api/application.go:332-361）", () => {
  test("属主应用 → 200 且返回新 token（gotify 响应形状）", async () => {
    const drizzle = createDrizzleMock({ id: 9 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.regenerateApplicationToken(7, "9");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({

      regenerateToken: { token: expect.stringMatching(/^gtfya\.[A-Za-z0-9\-_]{43}$/) },
    });
    expect(drizzle.__state.updateCalls).toBe(1);

    expect(drizzle.__state.updatedToken).toMatch(/^gtfya\.[A-Za-z0-9\-_]{43}$/);
    expect(drizzle.__state.updatedToken).not.toBe(body.regenerateToken.token);
    await expect(resolveTokenForLookup(body.regenerateToken.token)).resolves.toBe(drizzle.__state.updatedToken);
  });

  test("非属主/不存在 → 404，不更新", async () => {
    const drizzle = createDrizzleMock(null);
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.regenerateApplicationToken(7, "9");
    expect(res.status).toBe(404);
    expect(drizzle.__state.updateCalls).toBe(0);
  });

  test("非法 id → 400", async () => {
    const handlers = new ApplicationHandlers(createDrizzleMock(null) as any);
    const res = await handlers.regenerateApplicationToken(7, "abc");
    expect(res.status).toBe(400);
  });

  test("并发删除（select 命中但 update changes===0）→ 404", async () => {
    const drizzle = createDrizzleMock({ id: 9 }, { updateChanges: 0 });
    const handlers = new ApplicationHandlers(drizzle as any);
    const res = await handlers.regenerateApplicationToken(7, "9");
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.errorDescription).toBe("Application not found or no permission");
    expect(drizzle.__state.updateCalls).toBe(1);
  });
});
