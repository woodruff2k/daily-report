import { describe, expect, it } from "vitest";
import { commentCreateSchema, commentUpdateSchema } from "./comment";

describe("commentCreateSchema", () => {
  it("parentCommentId 생략·null 은 null 로 통일한다", () => {
    expect(commentCreateSchema.parse({ content: "a" })).toEqual({
      content: "a",
      parentCommentId: null,
    });
    expect(
      commentCreateSchema.parse({ content: "a", parentCommentId: null })
        .parentCommentId,
    ).toBeNull();
  });

  it("내용 앞뒤 공백을 뗀다", () => {
    expect(commentCreateSchema.parse({ content: "  a  " }).content).toBe("a");
  });

  it("2000자까지 허용하고 2001자는 거부한다", () => {
    expect(
      commentCreateSchema.safeParse({ content: "a".repeat(2000) }).success,
    ).toBe(true);
    expect(
      commentCreateSchema.safeParse({ content: "a".repeat(2001) }).success,
    ).toBe(false);
  });

  it.each([
    {},
    { content: "" },
    { content: "  \n\t " },
    { content: 1 },
    { content: "a", parentCommentId: 0 },
    { content: "a", parentCommentId: -1 },
    { content: "a", parentCommentId: 1.5 },
    { content: "a", parentCommentId: "1" },
    { content: "a", parentCommentId: 9007199254740993 },
  ])("거부: %j", (input) => {
    expect(commentCreateSchema.safeParse(input).success).toBe(false);
  });
});

describe("commentUpdateSchema", () => {
  it("content 만 남기고 parentCommentId 는 버린다", () => {
    expect(
      commentUpdateSchema.parse({ content: "a", parentCommentId: 3 }),
    ).toEqual({ content: "a" });
  });

  it.each([{}, { content: "   " }, { content: "a".repeat(2001) }])(
    "거부: %j",
    (input) => {
      expect(commentUpdateSchema.safeParse(input).success).toBe(false);
    },
  );
});
