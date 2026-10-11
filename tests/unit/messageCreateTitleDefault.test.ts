import { MessageHandlers } from "../../src/handlers/messageHandlers";

jest.mock('../../src/plugins/manager.ts', () => ({
  PluginManager: jest.fn().mockImplementation(() => ({ emit: jest.fn().mockResolvedValue(undefined) }))
}))

function createCreateMessageDrizzleMock(app: any | null) {
  const state = { insertedValues: null as any };
  const drizzle = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(app),
        })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((v: any) => {
        state.insertedValues = v;
        return {
          returning: jest.fn().mockResolvedValue([
            {
              id: 42,
              appId: v.appid,
              message: v.message,
              title: v.title,
              priority: v.priority,
              date: "2026-09-02 10:00:00",
              extras: v.extras,
            },
          ]),
        };
      }),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn().mockResolvedValue({ meta: { changes: 0 } }) })),
    })),
  };
  return { drizzle, state };
}

const APP = { userId: 1, defaultPriority: 5, name: "Backup Monitor" };

describe("createMessage title 默认（对齐 gotify api/message.go:372-374）", () => {
  test("title 缺省 → 存应用名", async () => {
    const { drizzle, state } = createCreateMessageDrizzleMock(APP);
    const handlers = new MessageHandlers(drizzle as any);
    const res = await handlers.createMessage(3, "disk full");
    expect(res.status).toBe(200);
    expect(state.insertedValues.title).toBe("Backup Monitor");
  });

  test("title 全空白 → 存应用名", async () => {
    const { drizzle, state } = createCreateMessageDrizzleMock(APP);
    const handlers = new MessageHandlers(drizzle as any);
    await handlers.createMessage(3, "disk full", "   ");
    expect(state.insertedValues.title).toBe("Backup Monitor");
  });

  test("title 非空白 → 原样保留", async () => {
    const { drizzle, state } = createCreateMessageDrizzleMock(APP);
    const handlers = new MessageHandlers(drizzle as any);
    await handlers.createMessage(3, "disk full", "自定义标题");
    expect(state.insertedValues.title).toBe("自定义标题");
  });

  test("title 非空白且含首尾空白 → 原样保留（不 trim）", async () => {
    const { drizzle, state } = createCreateMessageDrizzleMock(APP);
    const handlers = new MessageHandlers(drizzle as any);
    await handlers.createMessage(3, "disk full", "  自定义标题  ");
    expect(state.insertedValues.title).toBe("  自定义标题  ");
  });
});
