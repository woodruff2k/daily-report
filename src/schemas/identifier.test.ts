import { describe, expect, it } from "vitest";
import { idSchema } from "./identifier";

describe("idSchema — #47", () => {
  it.each([1, 42, Number.MAX_SAFE_INTEGER])("%s 를 받는다", (value) => {
    expect(idSchema.safeParse(value).success).toBe(true);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2, "1", null])(
    "%s 는 거부한다",
    (value) => {
      // 안전 정수를 넘는 값은 BigInt 변환 과정에서 정밀도를 잃는다.
      expect(idSchema.safeParse(value).success).toBe(false);
    },
  );
});
