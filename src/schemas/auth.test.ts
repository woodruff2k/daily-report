import { describe, expect, it } from "vitest";
import { loginRequestSchema } from "./auth";

describe("loginRequestSchema", () => {
  it("accepts a valid payload", () => {
    const result = loginRequestSchema.safeParse({
      loginId: "hong@company.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing password", () => {
    const result = loginRequestSchema.safeParse({
      loginId: "hong@company.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty loginId", () => {
    const result = loginRequestSchema.safeParse({ loginId: "", password: "x" });
    expect(result.success).toBe(false);
  });
});

// 이슈 #10: 인증 전 엔드포인트의 입력 상한
describe("loginRequestSchema 상한·제어문자", () => {
  it("loginId 255자까지, password 72자까지 허용한다", () => {
    expect(
      loginRequestSchema.safeParse({
        loginId: "a".repeat(255),
        password: "p".repeat(72),
      }).success,
    ).toBe(true);
  });

  it.each([
    ["loginId 256자", { loginId: "a".repeat(256), password: "x" }],
    ["password 73자", { loginId: "a", password: "p".repeat(73) }],
    ["loginId NUL", { loginId: "a\u0000b", password: "x" }],
  ])("%s 는 거부한다", (_name, body) => {
    expect(loginRequestSchema.safeParse(body).success).toBe(false);
  });
});
