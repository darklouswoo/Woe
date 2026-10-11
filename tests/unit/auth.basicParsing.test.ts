import { Authenticator } from "../../src/middleware/auth";

describe("Authenticator basic auth parsing", () => {
  let auth: Authenticator;

  beforeEach(() => {
    auth = new Authenticator({} as any);
  });

  test("keeps full password when it contains colons", () => {
    const encoded = btoa("alice:pa:ss:word");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`) as {
      username: string;
      password: string;
    } | null;

    expect(parsed).toEqual({
      username: "alice",
      password: "pa:ss:word"
    });
  });

  test("returns null when decoded credentials do not contain colon separator", () => {
    const encoded = btoa("alice-only");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`);
    expect(parsed).toBeNull();
  });





  test("round-trips chinese username with chinese and emoji password", () => {
    const sample = "用户甲:密码🔐之树";
    const encoded = Buffer.from(sample, "utf8").toString("base64");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`) as {
      username: string;
      password: string;
    } | null;

    expect(parsed).toEqual({
      username: "用户甲",
      password: "密码🔐之树"
    });
  });

  test("keeps full non-ascii password containing colons", () => {
    const sample = "李四:秘密:口令:🔑";
    const encoded = Buffer.from(sample, "utf8").toString("base64");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`) as {
      username: string;
      password: string;
    } | null;

    expect(parsed).toEqual({
      username: "李四",
      password: "秘密:口令:🔑"
    });
  });

  test("preserves leading U+FEFF in username (ignoreBOM)", () => {
    const sample = "\uFEFF王五:口令";
    const encoded = Buffer.from(sample, "utf8").toString("base64");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`) as {
      username: string;
      password: string;
    } | null;

    expect(parsed).toEqual({
      username: "\uFEFF王五",
      password: "口令"
    });
  });

  test("returns null on malformed base64", () => {
    const parsed = (auth as any).parseBasicAuth("Basic !!!!not-base64!!!!");
    expect(parsed).toBeNull();
  });

  test("returns null on invalid utf-8 bytes instead of replacing them", () => {

    const encoded = Buffer.from([0xe4, 0xb8, 0xad, 0x80]).toString("base64");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`);
    expect(parsed).toBeNull();
  });

  test("returns null on colon-bearing credentials with invalid utf-8 bytes (fatal, not replacement)", () => {



    const sample = Buffer.concat([
      Buffer.from("user:", "utf8"),
      Buffer.from([0x80, 0xc3, 0x28]),
      Buffer.from("tail", "utf8")
    ]);
    const encoded = sample.toString("base64");
    const parsed = (auth as any).parseBasicAuth(`Basic ${encoded}`);
    expect(parsed).toBeNull();
  });
});
