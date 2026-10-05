import { describe, expect, it } from "vitest";
import { SAVE_BODY } from "@/test/report-fixtures";
import { dateOnlySchema, reportCreateSchema, reportSaveSchema } from "./report";

describe("dateOnlySchema", () => {
  it("실제 존재하는 날짜만 통과한다", () => {
    expect(dateOnlySchema.safeParse("2026-06-20").success).toBe(true);
    expect(dateOnlySchema.safeParse("2028-02-29").success).toBe(true);
  });

  it.each([
    "2026-02-30",
    "2027-02-29",
    "2026-13-01",
    "2026-6-1",
    "2026-06-20T00:00:00Z",
    "",
  ])("%s 는 거부한다", (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(false);
  });
});

describe("reportCreateSchema", () => {
  it("reportDate 가 필수다", () => {
    expect(reportCreateSchema.safeParse({}).success).toBe(false);
    expect(
      reportCreateSchema.safeParse({ reportDate: "2026-06-20" }).success,
    ).toBe(true);
  });
});

describe("reportSaveSchema", () => {
  it("정상 본문을 통과시키고 선택 항목을 정규화한다", () => {
    const parsed = reportSaveSchema.parse({
      visits: [{ customerId: 5, visitType: "VISIT", content: " 내용 " }],
      problems: [{ content: "과제" }],
      plans: [{ content: "계획", plannedDate: "" }],
    });

    expect(parsed.visits[0]).toMatchObject({
      content: "내용",
      visitTime: null,
      result: null,
    });
    expect(parsed.visits[0].visitId).toBeUndefined();
    expect(parsed.problems[0]).toMatchObject({
      status: "OPEN",
      customerId: null,
    });
    expect(parsed.plans[0].plannedDate).toBeNull();
  });

  it("visits 0건도 받는다 (최소 1건은 제출 시점에 검증한다)", () => {
    expect(
      reportSaveSchema.safeParse({ ...SAVE_BODY, visits: [] }).success,
    ).toBe(true);
  });

  it("null 식별자는 신규 행으로 본다", () => {
    const parsed = reportSaveSchema.parse({
      ...SAVE_BODY,
      visits: [{ ...SAVE_BODY.visits[1], visitId: null }],
    });
    expect(parsed.visits[0].visitId).toBeUndefined();
  });

  it.each([
    ["배열 누락", { plans: undefined }],
    ["customerId 누락", { visits: [{ visitType: "VISIT", content: "x" }] }],
    [
      "visitType 비정상",
      { visits: [{ customerId: 5, visitType: "기타", content: "x" }] },
    ],
    [
      "내용 공백",
      { visits: [{ customerId: 5, visitType: "VISIT", content: "  " }] },
    ],
    [
      "내용 과대 길이",
      {
        visits: [
          { customerId: 5, visitType: "VISIT", content: "a".repeat(2001) },
        ],
      },
    ],
    [
      "방문시각 형식",
      {
        visits: [
          {
            customerId: 5,
            visitType: "VISIT",
            content: "x",
            visitTime: "25:00",
          },
        ],
      },
    ],
    [
      "안전 정수 초과 customerId",
      {
        visits: [{ customerId: 2 ** 53, visitType: "VISIT", content: "x" }],
      },
    ],
    [
      "문자열 customerId",
      { visits: [{ customerId: "5", visitType: "VISIT", content: "x" }] },
    ],
    [
      "안전 정수 초과 visitId",
      {
        visits: [
          { visitId: 2 ** 53, customerId: 5, visitType: "VISIT", content: "x" },
        ],
      },
    ],
    [
      "중복 visitId",
      {
        visits: [
          { visitId: 1, customerId: 5, visitType: "VISIT", content: "a" },
          { visitId: 1, customerId: 5, visitType: "CALL", content: "b" },
        ],
      },
    ],
    ["problem 상태 비정상", { problems: [{ content: "x", status: "DONE" }] }],
    [
      "plan 날짜 비정상",
      { plans: [{ content: "x", plannedDate: "2026-02-30" }] },
    ],
    [
      "행 수 과다",
      {
        problems: Array.from({ length: 101 }, () => ({ content: "x" })),
      },
    ],
  ])("%s 는 거부한다", (_name, override) => {
    expect(
      reportSaveSchema.safeParse({ ...SAVE_BODY, ...override }).success,
    ).toBe(false);
  });
});

// 순서 컬럼(이슈 #85). 해당 TC 는 없다. 가장 가까운 것은 TC-VST-01(다중 행 저장).
describe("reportSaveSchema sortOrder", () => {
  it.each(["problems", "plans"] as const)(
    "%s 의 sortOrder 는 생략하거나 0~9999 정수만 받는다",
    (key) => {
      const parse = (sortOrder?: unknown) =>
        reportSaveSchema.safeParse({
          visits: [],
          problems: [],
          plans: [],
          [key]: [{ content: "내용", sortOrder }],
        }).success;

      expect(parse(undefined)).toBe(true);
      expect(parse(0)).toBe(true);
      expect(parse(9999)).toBe(true);
      expect(parse(-1)).toBe(false);
      expect(parse(10000)).toBe(false);
      expect(parse(1.5)).toBe(false);
      expect(parse("1")).toBe(false);
    },
  );

  // 서버는 생략된 행에 배열 순서(index + 1)를 넣는다. 일부만 보내면 두 체계가 한
  // 배열에서 섞여 값이 충돌하고, 배열 순서도 보낸 숫자도 아닌 순서가 나온다.
  it.each(["visits", "problems", "plans"] as const)(
    "%s 의 sortOrder 를 일부 행만 보내면 거부한다",
    (key) => {
      const row =
        key === "visits"
          ? { customerId: 1, visitType: "VISIT" as const, content: "내용" }
          : { content: "내용" };
      const parse = (rows: unknown[]) =>
        reportSaveSchema.safeParse({
          visits: [],
          problems: [],
          plans: [],
          [key]: rows,
        }).success;

      // 전부 보내거나 전부 생략은 받는다.
      expect(
        parse([
          { ...row, sortOrder: 1 },
          { ...row, sortOrder: 2 },
        ]),
      ).toBe(true);
      expect(parse([{ ...row }, { ...row }])).toBe(true);
      // 섞으면 거부한다.
      expect(parse([{ ...row, sortOrder: 2 }, { ...row }])).toBe(false);
      expect(parse([{ ...row }, { ...row, sortOrder: 1 }])).toBe(false);
      // 같은 숫자를 일부러 두 번 보내는 것은 막지 않는다(동점 처리가 정의돼 있다).
      expect(
        parse([
          { ...row, sortOrder: 1 },
          { ...row, sortOrder: 1 },
        ]),
      ).toBe(true);
    },
  );
});

// 이슈 #75: NUL 은 400, 줄바꿈·탭은 허용(회귀)
describe("reportSaveSchema 제어문자", () => {
  const visit = { customerId: 1, visitType: "VISIT", content: "내용" };

  it.each([
    ["방문 내용", { visits: [{ ...visit, content: "a\u0000b" }] }],
    ["방문 결과", { visits: [{ ...visit, result: "a\u0000b" }] }],
    ["과제 내용", { problems: [{ content: "a\u0000b" }] }],
    ["계획 내용", { plans: [{ content: "a\u0000b" }] }],
  ])("%s 의 NUL 을 거부한다", (_name, patch) => {
    expect(
      reportSaveSchema.safeParse({
        visits: [],
        problems: [],
        plans: [],
        ...patch,
      }).success,
    ).toBe(false);
  });

  it("내용·결과의 줄바꿈과 탭을 허용한다", () => {
    const parsed = reportSaveSchema.parse({
      visits: [{ ...visit, content: "1줄\n2줄\t탭", result: "a\r\nb" }],
      problems: [{ content: "x\ny" }],
      plans: [{ content: "x\ny" }],
    });
    expect(parsed.visits[0].content).toBe("1줄\n2줄\t탭");
    expect(parsed.visits[0].result).toBe("a\r\nb");
  });
});
