











import { validateMessageCreateFields } from "../../src/utils/messageCreateValidation";


async function expectInvalid(input: unknown) {
  const result = validateMessageCreateFields(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected validation failure");
  }
  expect(result.response.status).toBe(400);
  const body = (await result.response.json()) as {
    error: string;
    errorCode: number;
    errorDescription: string;
  };
  expect(body.error).toBe("Bad Request");
  expect(body.errorCode).toBe(400);
  return body;
}


function expectValue(input: unknown) {
  const result = validateMessageCreateFields(input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected validation success");
  }
  return result.value;
}

describe("validateMessageCreateFields: message", () => {
  test("'hi' 合法", () => {
    expect(expectValue({ message: "hi" })).toEqual({ message: "hi" });
  });

  test("' '（纯空白）合法，不擅自 trim", () => {
    expect(expectValue({ message: " " })).toEqual({ message: " " });
  });

  test("缺省 => 400 Missing required field", async () => {
    const body = await expectInvalid({});
    expect(body.errorDescription).toBe("Missing required field: message is required");
  });

  test("null => 400", async () => {
    await expectInvalid({ message: null });
  });

  test("空串 '' => 400", async () => {
    const body = await expectInvalid({ message: "" });
    expect(body.errorDescription).toBe("Missing required field: message is required");
  });

  test.each([
    ["数字", 123],
    ["布尔", true],
    ["数组", []],
    ["对象", {}],
  ])("非字符串 message（%s）=> 400", async (_label, message) => {
    const body = await expectInvalid({ message });
    expect(body.errorDescription).toBe("message must be a string");
  });
});

describe("validateMessageCreateFields: priority", () => {
  test.each([-1, 0, 1, 2, 3, 4, 5, 9, 10, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])("显式整数 %p 合法并原样保留", (priority) => {
    expect(expectValue({ message: "hi", priority })).toEqual({ message: "hi", priority });
  });

  test("缺省 => undefined（采用应用 defaultPriority 的语义留给 handler）", () => {
    const value = expectValue({ message: "hi" });
    expect(value.priority).toBeUndefined();
  });

  test("JSON null => undefined（同缺省，不用应用默认值以外的值顶替）", () => {
    const value = expectValue({ message: "hi", priority: null });
    expect(value.priority).toBeUndefined();
  });

  test.each([
    ["小数", 2.5],
    ["数字字符串", "2"],
    ["空字符串（JSON priority: \"\"）", ""],
    ["true", true],
    ["false", false],
    ["数组", []],
    ["对象", {}],
    ["低于安全范围", Number.MIN_SAFE_INTEGER - 1],
    ["高于安全范围", Number.MAX_SAFE_INTEGER + 1],
  ])("非法 priority（%s）=> 400", async (_label, priority) => {
    await expectInvalid({ message: "hi", priority });
  });
});

describe("validateMessageCreateFields: extras", () => {
  test("{} 合法", () => {
    expect(expectValue({ message: "hi", extras: {} })).toEqual({ message: "hi", extras: {} });
  });

  test("null 合法（保持 null，不静默改写）", () => {
    expect(expectValue({ message: "hi", extras: null })).toEqual({ message: "hi", extras: null });
  });

  test("缺省 => undefined", () => {
    const value = expectValue({ message: "hi" });
    expect(value.extras).toBeUndefined();
  });

  test("合法 tags 数组与嵌套对象/数组完整保留（仅限制顶层类型）", () => {
    const extras = { tags: ["a"], nested: { items: [1] } };
    expect(expectValue({ message: "hi", extras })).toEqual({ message: "hi", extras });
  });

  test.each([
    ["顶层数组", []],
    ["字符串", "text"],
    ["数字", 1],
    ["布尔", true],
  ])("非法 extras（%s）=> 400 extras must be an object", async (_label, extras) => {
    const body = await expectInvalid({ message: "hi", extras });
    expect(body.errorDescription).toBe("extras must be an object");
  });
});

describe("validateMessageCreateFields: title", () => {
  test("缺省 => undefined（应用名回填由 handler 既有空白标题规则完成）", () => {
    const value = expectValue({ message: "hi" });
    expect(value.title).toBeUndefined();
  });

  test("null => undefined（gotify 绑定后 CreateMessage 回填应用名）", () => {
    const value = expectValue({ message: "hi", title: null });
    expect(value.title).toBeUndefined();
  });

  test("空串保留（form title= 的绑定中间值，最终存储由 handler 回填应用名）", () => {
    expect(expectValue({ message: "hi", title: "" })).toEqual({ message: "hi", title: "" });
  });

  test("非空白字符串原样保留（不 trim）", () => {
    expect(expectValue({ message: "hi", title: "  自定义标题  " })).toEqual({
      message: "hi",
      title: "  自定义标题  ",
    });
  });

  test.each([
    ["数字", 123],
    ["布尔", true],
    ["数组", []],
  ])("非字符串 title（%s）=> 400 title must be a string", async (_label, title) => {
    const body = await expectInvalid({ message: "hi", title });
    expect(body.errorDescription).toBe("title must be a string");
  });
});

describe("validateMessageCreateFields: 顶层体形状", () => {
  test.each([
    ["顶层数组", ["hi"]],
    ["顶层字符串", "text"],
    ["顶层数字", 5],
    ["null", null],
    ["undefined", undefined],
  ])("非对象体（%s）=> 400", async (_label, input) => {
    await expectInvalid(input);
  });
});
