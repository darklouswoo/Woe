import { system } from "../../src/routes/system";
import { isRegistrationEnabled } from "../../src/utils/registrationConfig";

describe("GET /gotifyinfo（对齐 gotify router.go:193-201）", () => {
  test("无鉴权返回能力与版本信息", async () => {
    const res = await system.fetch(
      new Request("https://woe.example/gotifyinfo"),
      { REGISTRATION: "false", DB: undefined } as any,
      {} as any
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({
      version: expect.any(String),
      register: false,
      localAuth: true,
      oidc: false,
      oidcIdpName: "",
      oidcAutoRedirect: false,
    });
  });

  test("REGISTRATION=true 时 register 为 true", async () => {
    const res = await system.fetch(
      new Request("https://woe.example/gotifyinfo"),
      { REGISTRATION: "true", DB: undefined } as any,
      {} as any
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.register).toBe(true);
  });

  test("REGISTRATION 未设置时 register 为 false（默认关闭）", async () => {
    const res = await system.fetch(
      new Request("https://woe.example/gotifyinfo"),
      { DB: undefined } as any,
      {} as any
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.register).toBe(false);
  });


  test("boolean REGISTRATION=true 时 register 为 true", async () => {
    const res = await system.fetch(
      new Request("https://woe.example/gotifyinfo"),
      { REGISTRATION: true, DB: undefined } as any,
      {} as any
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.register).toBe(true);
  });

  test("boolean REGISTRATION=false 时 register 为 false", async () => {
    const res = await system.fetch(
      new Request("https://woe.example/gotifyinfo"),
      { REGISTRATION: false, DB: undefined } as any,
      {} as any
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.register).toBe(false);
  });



  test.each([
    [true],
    ["true"],
    [" TRUE "],
    [false],
    ["false"],
    [undefined],
    [""],
    [1],
    ["1"],
    ["yes"],
  ])("REGISTRATION=%p：gotifyinfo.register === isRegistrationEnabled（同一结果）", async (value) => {
    const res = await system.fetch(
      new Request("https://woe.example/gotifyinfo"),
      { REGISTRATION: value, DB: undefined } as any,
      {} as any
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.register).toBe(isRegistrationEnabled(value));
  });
});
