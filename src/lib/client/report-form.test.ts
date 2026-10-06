import { describe, expect, it } from "vitest";
import {
  toRows,
  toSaveBody,
  validateForSave,
  type FormRows,
  type PlanRow,
  type ProblemRow,
} from "./report-form";
import type { ReportDetail } from "./report-api";

/**
 * 과제·계획의 sortOrder (이슈 #85).
 *
 * **해당 TC 는 없다.** 가장 가까운 것은 TC-VST-01·TC-PRB-01·TC-PLN-01(다중 행 저장)
 * 이다. 순서 보존은 테스트 명세서에 항목이 없다.
 *
 * 화면에는 행을 중간에 끼우는 조작이 없어(추가는 맨 뒤 append) "중간 삽입" 은
 * 화면 테스트로 만들 수 없다. 변환 함수에 `FormRows` 를 직접 주어 확인한다.
 */

const problemRow = (key: string, content: string, id?: number): ProblemRow => ({
  key,
  ...(id === undefined ? {} : { problemId: id }),
  customer: null,
  content,
  status: "OPEN",
});
const planRow = (key: string, content: string, id?: number): PlanRow => ({
  key,
  ...(id === undefined ? {} : { planId: id }),
  customer: null,
  plannedDate: "2026-10-06",
  content,
});

describe("toSaveBody — 과제·계획 sortOrder (#85)", () => {
  it("A·B·C 사이에 D 를 끼우면 A=1, D=2, B=3, C=4 가 담긴다", () => {
    const rows: FormRows = {
      visits: [],
      problems: [
        problemRow("a", "A", 1),
        problemRow("d", "D"),
        problemRow("b", "B", 2),
        problemRow("c", "C", 3),
      ],
      plans: [
        planRow("a", "A", 1),
        planRow("d", "D"),
        planRow("b", "B", 2),
        planRow("c", "C", 3),
      ],
    };

    const body = toSaveBody(rows);

    expect(body.problems.map((p) => [p.content, p.sortOrder])).toEqual([
      ["A", 1],
      ["D", 2],
      ["B", 3],
      ["C", 4],
    ]);
    expect(body.plans.map((p) => [p.content, p.sortOrder])).toEqual([
      ["A", 1],
      ["D", 2],
      ["B", 3],
      ["C", 4],
    ]);
  });

  it("행을 지우면 빈 번호 없이 1부터 다시 매긴다", () => {
    const body = toSaveBody({
      visits: [],
      problems: [problemRow("a", "A", 1), problemRow("c", "C", 3)],
      plans: [planRow("a", "A", 1), planRow("c", "C", 3)],
    });
    expect(body.problems.map((p) => p.sortOrder)).toEqual([1, 2]);
    expect(body.plans.map((p) => p.sortOrder)).toEqual([1, 2]);
  });
});

describe("toRows — 과제·계획 순서 (#85)", () => {
  const detail: ReportDetail = {
    reportId: 10,
    rep: { repId: 2, name: "합성사원" },
    reportDate: "2026-10-05",
    status: "DRAFT",
    submittedAt: null,
    visits: [],
    problems: [
      {
        problemId: 1,
        customer: null,
        content: "a",
        status: "OPEN",
        sortOrder: 1,
      },
      {
        problemId: 2,
        customer: null,
        content: "b",
        status: "OPEN",
        sortOrder: 2,
      },
      {
        problemId: 3,
        customer: null,
        content: "c",
        status: "OPEN",
        sortOrder: 2,
      },
    ],
    plans: [
      {
        planId: 1,
        customer: null,
        plannedDate: null,
        content: "x",
        sortOrder: 1,
      },
      {
        planId: 2,
        customer: null,
        plannedDate: null,
        content: "y",
        sortOrder: 2,
      },
    ],
  };

  it("서버가 준 순서를 유지한다 (sortOrder 가 같으면 서버 순서)", () => {
    const rows = toRows(detail);
    expect(rows.problems.map((p) => p.content)).toEqual(["a", "b", "c"]);
    expect(rows.plans.map((p) => p.content)).toEqual(["x", "y"]);
  });

  it("sortOrder 가 어긋나 온 응답도 sortOrder 순으로 놓는다", () => {
    // 동순위(b·c)가 없는 응답만 뒤집는다. 동순위의 순서는 위 테스트가 다룬다.
    const shuffled: ReportDetail = {
      ...detail,
      problems: [detail.problems[1], detail.problems[0]],
      plans: [...detail.plans].reverse(),
    };
    const rows = toRows(shuffled);
    expect(rows.problems.map((p) => p.content)).toEqual(["a", "b"]);
    expect(rows.plans.map((p) => p.content)).toEqual(["x", "y"]);
  });
});

/**
 * 저장 응답으로 폼을 갱신할 때 식별자가 같은 행은 key 를 물려받는다 (이슈 #13 검토).
 *
 * **해당 TC 는 없다.** key 는 클라이언트 전용이라 API 명세·테스트 명세 어디에도 없다.
 * 화면 테스트로는 방문 행에서 이것을 볼 수 없다 — 방문은 고객 선택이 필수라 "아직 고르지
 * 않은 검색어" 가 남지 않는다. 그래서 변환 함수에서 세 섹션을 각각 확인한다. 한 섹션만
 * 되돌려도 화면 테스트 전체가 통과했다(#93 뮤테이션 확인).
 */
describe("toRows — 같은 식별자의 행은 key 를 물려받는다", () => {
  const detail: ReportDetail = {
    reportId: 10,
    rep: { repId: 2, name: "합성사원" },
    reportDate: "2026-10-05",
    status: "DRAFT",
    submittedAt: null,
    visits: [
      {
        visitId: 11,
        customer: { customerId: 5, customerName: "에이상사" },
        visitTime: null,
        visitType: "VISIT",
        content: "v",
        result: null,
        sortOrder: 1,
      },
      {
        visitId: 12,
        customer: { customerId: 5, customerName: "에이상사" },
        visitTime: null,
        visitType: "CALL",
        content: "w",
        sortOrder: 2,
        result: null,
      },
    ],
    problems: [
      {
        problemId: 21,
        customer: null,
        content: "p",
        status: "OPEN",
        sortOrder: 1,
      },
    ],
    plans: [
      {
        planId: 31,
        customer: null,
        plannedDate: null,
        content: "n",
        sortOrder: 1,
      },
    ],
  };

  it("방문·과제·계획 모두 식별자가 같으면 이전 key 를 그대로 쓴다", () => {
    const first = toRows(detail);

    const second = toRows(detail, first);

    expect(second.visits.map((r) => r.key)).toEqual(
      first.visits.map((r) => r.key),
    );
    expect(second.problems[0].key).toBe(first.problems[0].key);
    expect(second.plans[0].key).toBe(first.plans[0].key);
  });

  it("처음 보는 식별자는 새 key 를 받고, 다른 행의 key 와 겹치지 않는다", () => {
    const first = toRows(detail);
    const grown: ReportDetail = {
      ...detail,
      visits: [
        ...detail.visits,
        { ...detail.visits[0], visitId: 13, sortOrder: 3 },
      ],
      problems: [
        ...detail.problems,
        { ...detail.problems[0], problemId: 22, sortOrder: 2 },
      ],
      plans: [
        ...detail.plans,
        { ...detail.plans[0], planId: 32, sortOrder: 2 },
      ],
    };

    const second = toRows(grown, first);

    const allKeys = [...second.visits, ...second.problems, ...second.plans].map(
      (r) => r.key,
    );
    expect(new Set(allKeys).size).toBe(allKeys.length);
    expect(second.visits[0].key).toBe(first.visits[0].key);
    expect(second.visits[2].key).not.toBe(first.visits[0].key);
    expect(second.problems[1].key).not.toBe(first.problems[0].key);
    expect(second.plans[1].key).not.toBe(first.plans[0].key);
  });

  it("이전이 없으면(첫 로드) 행마다 서로 다른 key 를 받는다", () => {
    const rows = toRows(detail);

    expect(rows.visits[0].key).not.toBe(rows.visits[1].key);
  });
});

describe("toRows — 방문 순서", () => {
  it("방문기록도 sortOrder 순으로 놓는다", () => {
    const base = (visitId: number, sortOrder: number, content: string) => ({
      visitId,
      customer: { customerId: 5, customerName: "에이상사" },
      visitTime: null,
      visitType: "VISIT" as const,
      content,
      result: null,
      sortOrder,
    });
    const detail: ReportDetail = {
      reportId: 10,
      rep: { repId: 2, name: "합성사원" },
      reportDate: "2026-10-05",
      status: "DRAFT",
      submittedAt: null,
      visits: [base(2, 2, "둘째"), base(1, 1, "첫째")],
      problems: [],
      plans: [],
    };

    expect(toRows(detail).visits.map((v) => v.content)).toEqual([
      "첫째",
      "둘째",
    ]);
  });
});

describe("validateForSave — 예정일 형식", () => {
  const planWith = (plannedDate: string): FormRows => ({
    visits: [],
    problems: [],
    plans: [{ ...planRow("p", "내용"), plannedDate }],
  });

  it("형식이 틀린 예정일은 행 번호와 함께 오류로 돌려준다", () => {
    expect(validateForSave(planWith("2026/10/06"))).toEqual([
      "내일 할 일 1행: 예정일은 YYYY-MM-DD 형식이어야 합니다.",
    ]);
  });

  it.each(["", "   "])("예정일을 비워 두면(%j) 오류가 아니다", (blank) => {
    expect(validateForSave(planWith(blank))).toEqual([]);
  });

  it("올바른 형식의 예정일은 통과한다", () => {
    expect(validateForSave(planWith("2026-10-06"))).toEqual([]);
  });
});
