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
    const result = loginRequestSchema.safeParse({ loginId: "hong@company.com" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty loginId", () => {
    const result = loginRequestSchema.safeParse({ loginId: "", password: "x" });
    expect(result.success).toBe(false);
  });
});
