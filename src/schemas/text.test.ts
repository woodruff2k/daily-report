// 덮는 TC: TC-SEC-05 (입력 검증), 이슈 #75 (NUL 문자 500)
import { describe, expect, it } from "vitest";
import { multiLineText, singleLineText } from "./text";

describe("singleLineText", () => {
  it.each(["a\u0000b", "a\nb", "a\tb", "a\rb", "a\u001Fb", "a\u007Fb"])(
    "제어문자를 거부한다: %j",
    (value) => {
      expect(singleLineText().min(1).safeParse(value).success).toBe(false);
    },
  );

  it("앞뒤 줄바꿈은 trim 으로 제거되어 통과한다", () => {
    expect(singleLineText().min(1).parse(" 홍길동\n")).toBe("홍길동");
  });

  it("짝 없는 서로게이트를 거부한다", () => {
    expect(singleLineText().min(1).safeParse("a\ud800b").success).toBe(false);
  });

  it("한글·이모지는 허용한다", () => {
    expect(singleLineText().parse("홍길동 😀")).toBe("홍길동 😀");
  });
});

describe("multiLineText", () => {
  it("줄바꿈(\\n, \\r\\n)과 탭을 허용한다 (회귀)", () => {
    const value = "첫 줄\n둘째\t줄\r\n셋째";
    expect(multiLineText().min(1).parse(value)).toBe(value);
  });

  it.each(["a\u0000b", "a\u0008b", "a\u001Bb", "a\u007Fb", "a\ud800b"])(
    "NUL 등 제어문자·서로게이트를 거부한다: %j",
    (value) => {
      expect(multiLineText().min(1).safeParse(value).success).toBe(false);
    },
  );
});
