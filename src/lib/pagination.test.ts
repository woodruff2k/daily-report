import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors";
import { pageResponse, parsePageRequest } from "./pagination";

const SORTABLE = ["name", "createdAt"] as const;
const DEFAULT_SORT = { createdAt: "desc" } as const;

const ID_FIELD = "widgetId";
const TIE_BREAK = { [ID_FIELD]: "desc" } as const;

function parse(query: string) {
  return parsePageRequest(
    new URLSearchParams(query),
    SORTABLE,
    DEFAULT_SORT,
    ID_FIELD,
  );
}

describe("parsePageRequest", () => {
  /**
   * 동순위 보조 키 (이슈 #95). 해당 TC 는 없다.
   *
   * 호출부에 맡겼더니 네 라우트 중 셋이 빠뜨린 채로 배포됐다. 여기서 붙이면
   * 새 목록 라우트가 같은 실수를 반복할 수 없다 — `idField` 가 필수 인자라
   * 빠뜨리면 컴파일이 막힌다.
   */
  it("요청한 정렬 뒤에 식별자 보조 키를 항상 붙인다", () => {
    for (const query of [
      "",
      "sort=name,asc",
      "sort=name,desc",
      "page=3&size=5",
    ]) {
      const { orderBy } = parse(query);
      expect(orderBy).toHaveLength(2);
      expect(orderBy[1]).toEqual(TIE_BREAK);
    }
  });

  it("정렬 가능 필드에 보조 키가 있으면 거부한다", () => {
    // 같은 컬럼이 두 번 들어가면 뒤의 것이 무시돼 보조 키가 조용히 죽는다.
    expect(() =>
      parsePageRequest(
        new URLSearchParams(""),
        [...SORTABLE, ID_FIELD],
        DEFAULT_SORT,
        ID_FIELD,
      ),
    ).toThrow(/보조 키/);
  });

  it("파라미터가 없으면 0페이지·20건·기본 정렬이다", () => {
    expect(parse("")).toEqual({
      page: 0,
      size: 20,
      skip: 0,
      take: 20,
      orderBy: [DEFAULT_SORT, TIE_BREAK],
    });
  });

  it("page·size 를 skip·take 로 바꾼다", () => {
    expect(parse("page=2&size=10")).toMatchObject({ skip: 20, take: 10 });
  });

  it("sort 를 Prisma orderBy 로 바꾼다", () => {
    expect(parse("sort=name,asc").orderBy).toEqual([
      { name: "asc" },
      TIE_BREAK,
    ]);
  });

  it("방향을 생략하면 asc 다", () => {
    expect(parse("sort=name").orderBy).toEqual([{ name: "asc" }, TIE_BREAK]);
  });

  it.each(["page=-1", "page=1.5", "page=abc", "size=x"])(
    "%s 는 400으로 막는다",
    (query) => {
      expect(() => parse(query)).toThrow(ValidationError);
    },
  );

  it("size 가 0이면 400으로 막는다", () => {
    expect(() => parse("size=0")).toThrow(ValidationError);
  });

  it("size 상한(100)을 넘으면 400으로 막는다", () => {
    expect(() => parse("size=101")).toThrow(ValidationError);
  });

  it("허용 목록에 없는 정렬 필드는 400으로 막는다", () => {
    // 임의 컬럼명이 Prisma orderBy 로 그대로 넘어가지 않게 한다.
    expect(() => parse("sort=passwordHash,asc")).toThrow(ValidationError);
  });

  it("정렬 방향이 asc·desc 가 아니면 400으로 막는다", () => {
    expect(() => parse("sort=name,sideways")).toThrow(ValidationError);
  });
});

describe("pageResponse", () => {
  it("전체 건수로 총 페이지 수를 계산한다", () => {
    const request = parse("page=1&size=10");

    expect(pageResponse(["a"], 25, request)).toEqual({
      content: ["a"],
      page: 1,
      size: 10,
      totalElements: 25,
      totalPages: 3,
    });
  });

  it("결과가 없으면 총 페이지 수는 0이다", () => {
    expect(pageResponse([], 0, parse("")).totalPages).toBe(0);
  });
});
