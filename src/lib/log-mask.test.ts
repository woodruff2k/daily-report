// 덮는 TC: TC-SEC-07 (로그에 password·phone·email 평문 미기록)
import { describe, expect, it } from "vitest";
import {
  describeErrorForLog,
  MASK,
  MASK_EMAIL,
  maskString,
  maskValue,
} from "./log-mask";

describe("maskString", () => {
  it("이메일 형태 문자열을 가린다", () => {
    expect(maskString("user a.b+c@corp.example.com failed")).toBe(
      `user ${MASK_EMAIL} failed`,
    );
  });

  it.each([
    ['password: "hunter2hunter2"', "hunter2hunter2"],
    ["password=hunter2hunter2", "hunter2hunter2"],
    ['"phone":"010-1234-5678"', "010-1234-5678"],
    ["phone: '02-000-0000'", "02-000-0000"],
    ['email: "a@example.com"', "a@example.com"],
    ["passwordHash: $2b$10$abcdefghijk", "$2b$10$abcdefghijk"],
  ])("민감 키의 값을 가린다: %s", (input, secret) => {
    const masked = maskString(`Invalid invocation ${input} at line 3`);
    expect(masked).not.toContain(secret);
    expect(masked).toContain("Invalid invocation");
    expect(masked).toContain("at line 3");
  });

  it("민감 정보가 없으면 그대로 둔다", () => {
    expect(maskString("connection refused")).toBe("connection refused");
  });
});

describe("maskValue", () => {
  it("민감 키의 값을 중첩 객체·배열까지 가린다", () => {
    const masked = maskValue({
      customerName: "테스트",
      phone: "010-0000-0000",
      nested: [{ Email: "a@example.com", note: "문의 b@example.com" }],
      loginPassword: "pw",
    });

    expect(masked).toEqual({
      customerName: "테스트",
      phone: MASK,
      nested: [{ Email: MASK, note: `문의 ${MASK_EMAIL}` }],
      loginPassword: MASK,
    });
  });

  it("BigInt 를 문자열로 바꿔 로그 직렬화가 깨지지 않게 한다", () => {
    expect(maskValue({ id: 1n })).toEqual({ id: "1" });
  });

  it("너무 깊은 객체는 가린다", () => {
    const deep = { a: { b: { c: { d: { e: { f: "x" } } } } } };
    expect(JSON.stringify(maskValue(deep))).toContain(MASK);
  });
});

describe("describeErrorForLog", () => {
  it("메시지와 스택을 마스킹하고 code 를 보존한다", () => {
    const error = Object.assign(new Error("dup email: x@example.com"), {
      code: "P2002",
    });

    const described = describeErrorForLog(error);

    expect(described.code).toBe("P2002");
    expect(JSON.stringify(described)).not.toContain("x@example.com");
  });

  it("Error 가 아닌 값도 마스킹한다", () => {
    expect(describeErrorForLog({ password: "pw" })).toEqual({
      value: { password: MASK },
    });
  });
});
