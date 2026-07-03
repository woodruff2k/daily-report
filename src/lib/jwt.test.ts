import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt";

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = "test-only-secret-not-a-real-credential";
});

afterEach(() => {
  process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
});

describe("jwt", () => {
  it("signs and verifies a token round-trip", () => {
    const payload = { repId: "1", name: "홍길동", role: "SALES_REP" as const };
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded).toMatchObject(payload);
  });

  it("throws on a tampered token", () => {
    const token = signAccessToken({ repId: "1", name: "홍길동", role: "SALES_REP" as const });
    expect(() => verifyAccessToken(`${token}tampered`)).toThrow();
  });

  it("throws when JWT_SECRET is not set", () => {
    delete process.env.JWT_SECRET;
    expect(() =>
      signAccessToken({ repId: "1", name: "홍길동", role: "SALES_REP" as const })
    ).toThrow("JWT_SECRET");
  });
});
