import { describe, expect, it } from "vitest";
import { toJsonId, toJsonIdOrNull } from "./identifier";

describe("toJsonId — #47", () => {
  it("BigInt 를 숫자로 바꾼다", () => {
    expect(toJsonId(1n)).toBe(1);
    expect(typeof toJsonId(1n)).toBe("number");
  });

  it("변환 결과는 JSON 으로 직렬화된다", () => {
    // BigInt 가 남아 있으면 JSON.stringify 가 그대로 던진다.
    expect(() => JSON.stringify({ id: toJsonId(42n) })).not.toThrow();
  });

  it("안전 정수 경계값은 통과한다", () => {
    expect(toJsonId(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("안전 정수를 넘으면 던진다", () => {
    // Number() 는 조용히 정밀도를 잃는다. 식별자에서 그것은 다른 레코드를
    // 가리키는 값이 되어 나간다.
    expect(() => toJsonId(BigInt(Number.MAX_SAFE_INTEGER) + 2n)).toThrow();
  });

  it("정밀도를 잃은 값을 돌려주지 않는다", () => {
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 2n;

    expect(() => toJsonId(tooBig)).toThrow();
    // 던지지 않고 Number(tooBig) 를 돌려주면 MAX_SAFE_INTEGER+1 이 되어
    // 다른 레코드의 식별자와 겹친다.
    expect(Number(tooBig)).toBe(Number.MAX_SAFE_INTEGER + 1);
  });
});

describe("toJsonIdOrNull — #47", () => {
  it("null 은 그대로 둔다", () => {
    expect(toJsonIdOrNull(null)).toBeNull();
  });

  it("값이 있으면 숫자로 바꾼다", () => {
    expect(toJsonIdOrNull(2n)).toBe(2);
  });
});
