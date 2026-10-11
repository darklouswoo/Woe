



jest.mock("drizzle-orm/d1", () => ({
  drizzle: jest.fn(() => ({ mocked: true })),
}));

import { drizzle } from "drizzle-orm/d1";
import { createDrizzle } from "../../src/drizzle/index";

describe("createDrizzle SQL 日志开关", () => {
  test("以 logger: false 创建实例（禁止绑定参数入日志）", () => {
    createDrizzle({} as any);
    expect(drizzle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logger: false })
    );
  });
});
