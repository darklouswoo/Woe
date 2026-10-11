import { Authenticator } from "../../src/middleware/auth";

function makeRequest(password: string): Request {
  const encoded = btoa(`admin:${password}`);
  return new Request("https://woe.example/init/admin", {
    headers: { Authorization: `Basic ${encoded}` },
  });
}

function makeEnv(password: string | undefined) {
  return {
    DEFAULT_ADMIN_USER: "admin",
    DEFAULT_ADMIN_PASSWORD: password,
  } as any;
}

describe("isDefaultInitAuth 弱默认凭据加固", () => {
  const auth = new Authenticator({} as any);

  test("强随机密码且用户名匹配 → 放行", async () => {
    const ok = await auth.isDefaultInitAuth(
      makeRequest("xK9$mQ2v#Lp7!zR4"),
      makeEnv("xK9$mQ2v#Lp7!zR4")
    );
    expect(ok).toBe(true);
  });

  test("密码未配置（undefined/空）→ 拒绝", async () => {
    expect(
      await auth.isDefaultInitAuth(makeRequest(""), makeEnv(undefined))
    ).toBe(false);
    expect(await auth.isDefaultInitAuth(makeRequest(""), makeEnv(""))).toBe(false);
  });

  test("已知弱密码（password/admin/123456）→ 拒绝", async () => {
    for (const weak of ["password", "admin", "123456"]) {
      expect(
        await auth.isDefaultInitAuth(makeRequest(weak), makeEnv(weak))
      ).toBe(false);
    }
  });

  test("密码与配置不符 → 拒绝", async () => {
    expect(
      await auth.isDefaultInitAuth(makeRequest("wrong"), makeEnv("xK9$mQ2v#Lp7!zR4"))
    ).toBe(false);
  });
});
