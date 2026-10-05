import { describe, expect, it } from "vitest";
import {
  toRows,
  toSaveBody,
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
        customerId: null,
        content: "a",
        status: "OPEN",
        sortOrder: 1,
      },
      {
        problemId: 2,
        customerId: null,
        content: "b",
        status: "OPEN",
        sortOrder: 2,
      },
      {
        problemId: 3,
        customerId: null,
        content: "c",
        status: "OPEN",
        sortOrder: 2,
      },
    ],
    plans: [
      {
        planId: 1,
        customerId: null,
        plannedDate: null,
        content: "x",
        sortOrder: 1,
      },
      {
        planId: 2,
        customerId: null,
        plannedDate: null,
        content: "y",
        sortOrder: 2,
      },
    ],
  };

  it("서버가 준 순서를 유지한다 (sortOrder 가 같으면 서버 순서)", () => {
    const rows = toRows(detail, new Map());
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
    const rows = toRows(shuffled, new Map());
    expect(rows.problems.map((p) => p.content)).toEqual(["a", "b"]);
    expect(rows.plans.map((p) => p.content)).toEqual(["x", "y"]);
  });
});
