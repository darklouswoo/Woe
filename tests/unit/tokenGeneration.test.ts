import { randomTokenString } from "../../src/middleware/auth";
import { generateEnhancedToken } from "../../src/utils/enhancedToken";
import { PluginHandlers } from "../../src/handlers/pluginHandlers";

jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn() }), { virtual: true });

describe("token 生成（gtfy EdDSA 增强 token，对齐 gotify auth/token.go）", () => {
  test("app/client token 为 gtfy[a|c]. + 43 字符 base64url 双形态（public/private）", () => {
    for (const [kind, ident] of [["app", "a"], ["client", "c"]] as const) {
      const { publicForm, privateForm } = generateEnhancedToken(kind);
      const re = new RegExp(`^gtfy${ident}\\.[A-Za-z0-9\\-_]{43}$`);
      expect(publicForm).toMatch(re);
      expect(privateForm).toMatch(re);
      expect(publicForm).not.toBe(privateForm);
    }
  });

  test("randomTokenString：长度精确、字符集受限、批量生成不重复", () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = randomTokenString(22);
      expect(t).toMatch(/^[A-Za-z0-9]{22}$/);
      set.add(t);
    }
    expect(set.size).toBe(200);
  });

  test("插件 token 为 P + 22 字符且使用 CSPRNG 工具", () => {
    const handlers = new PluginHandlers({} as any);
    const token = (handlers as any).generatePluginToken() as string;
    expect(token).toMatch(/^P[A-Za-z0-9]{22}$/);
  });
});
