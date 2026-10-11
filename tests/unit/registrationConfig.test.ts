import { isRegistrationEnabled } from "../../src/utils/registrationConfig";





describe("isRegistrationEnabled（F2 注册开关归一化）", () => {
  test.each([[true], ["true"], [" TRUE "]])("%p → 开启", (value) => {
    expect(isRegistrationEnabled(value)).toBe(true);
  });

  test.each([
    [false],
    ["false"],
    [" FALSE "],
    [undefined],
    [null],
    [""],
    [1],
    ["1"],
    [{}],
    ["yes"],
  ])("%p → 关闭（fail-closed）", (value) => {
    expect(isRegistrationEnabled(value)).toBe(false);
  });

  test("字符串大小写与空白变体归一", () => {
    expect(isRegistrationEnabled("True")).toBe(true);
    expect(isRegistrationEnabled("  true  ")).toBe(true);
    expect(isRegistrationEnabled("\ttrue\n")).toBe(true);
    expect(isRegistrationEnabled("trueish")).toBe(false);
    expect(isRegistrationEnabled(" true ")).toBe(true);
  });
});
