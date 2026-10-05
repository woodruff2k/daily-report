import {
  VISITS_REQUIRED_MESSAGE,
  type ProblemStatus,
  type ReportDetail,
  type ReportSaveBody,
  type VisitType,
} from "./report-api";

/**
 * SCR-210 폼 상태와 변환·검증. (이슈 #13)
 *
 * 화면 검증은 서버 Zod 스키마(`src/schemas/report.ts`)를 거울처럼 따른다. 서버
 * 검증을 대체하지 않는다 — 서버가 400 을 주면 화면이 그 문장을 보여준다.
 */

/** 행이 아닌 한 고객 선택. 이름을 모르면(과제·계획 상세) null. */
export interface CustomerRef {
  customerId: number;
  customerName: string | null;
}

// `key` 는 클라이언트 전용이다. 서버로 보내지 않는다(`visitId` 와 다르다).
// 배열 인덱스를 key 로 쓰면 중간 행을 지울 때 아래 행의 입력이 뒤섞인다.
let sequence = 0;
export function newRowKey() {
  sequence += 1;
  return `row-${sequence}`;
}

export interface VisitRow {
  key: string;
  visitId?: number;
  customer: CustomerRef | null;
  visitTime: string;
  visitType: VisitType;
  content: string;
  result: string;
}

export interface ProblemRow {
  key: string;
  problemId?: number;
  customer: CustomerRef | null;
  content: string;
  status: ProblemStatus;
}

export interface PlanRow {
  key: string;
  planId?: number;
  customer: CustomerRef | null;
  plannedDate: string;
  content: string;
}

export interface FormRows {
  visits: VisitRow[];
  problems: ProblemRow[];
  plans: PlanRow[];
}

/**
 * 뒤늦게 받은 고객 이름을 해당 칸에만 채운다. 다른 상태는 건드리지 않는다 —
 * 이름 조회가 폼을 막지 않고 뒤에서 도는 동안 사용자가 이미 입력하고 있다.
 */
export function withCustomerName(
  rows: FormRows,
  customerId: number,
  customerName: string,
): FormRows {
  const fill = <T extends { customer: CustomerRef | null }>(row: T): T =>
    row.customer !== null &&
    row.customer.customerId === customerId &&
    row.customer.customerName === null
      ? { ...row, customer: { customerId, customerName } }
      : row;

  return {
    visits: rows.visits.map(fill),
    problems: rows.problems.map(fill),
    plans: rows.plans.map(fill),
  };
}

export const MAX_ROWS = 100;
const CONTENT_MAX = 2000;
const RESULT_MAX = 255;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function emptyVisit(): VisitRow {
  return {
    key: newRowKey(),
    customer: null,
    visitTime: "",
    visitType: "VISIT",
    content: "",
    result: "",
  };
}

export function emptyProblem(): ProblemRow {
  return {
    key: newRowKey(),
    customer: null,
    content: "",
    status: "OPEN",
  };
}

/** `plannedDate` 기본값(익일)은 호출하는 쪽이 행을 추가하는 순간에 계산해 넘긴다. */
export function emptyPlan(plannedDate: string): PlanRow {
  return { key: newRowKey(), customer: null, plannedDate, content: "" };
}

/**
 * 과제·계획의 고객 이름은 상세에 없어 `names` 에서 찾는다.
 *
 * `previous` 를 주면 **식별자가 같은 행은 key 를 물려받는다.** 저장할 때마다 새 key
 * 를 발급하면 React 가 모든 행을 떼고 다시 붙여, 아직 고르지 않은 고객 검색어와
 * 포커스가 사라진다 — 임시저장 한 번에 입력 중이던 검색이 날아간다.
 */
export function toRows(
  detail: ReportDetail,
  names: ReadonlyMap<number, string>,
  previous?: FormRows,
): FormRows {
  const ref = (customerId: number | null): CustomerRef | null =>
    customerId === null
      ? null
      : { customerId, customerName: names.get(customerId) ?? null };

  /** 같은 식별자를 쓰던 행의 key. 없으면 새로 발급한다(새 행이다). */
  function keyFor<T extends { key: string }>(
    rows: T[] | undefined,
    matches: (row: T) => boolean,
  ): string {
    return rows?.find(matches)?.key ?? newRowKey();
  }

  return {
    visits: [...detail.visits]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((visit) => ({
        key: keyFor(previous?.visits, (row) => row.visitId === visit.visitId),
        visitId: visit.visitId,
        customer: {
          customerId: visit.customer.customerId,
          customerName: visit.customer.customerName,
        },
        visitTime: visit.visitTime ?? "",
        visitType: visit.visitType,
        content: visit.content,
        result: visit.result ?? "",
      })),
    // 서버도 sortOrder 순으로 돌려주지만 방문기록과 같이 화면이 한 번 더 정렬한다.
    // 정렬은 안정적이라 sortOrder 가 같으면 서버가 준 순서(식별자 순)가 유지된다.
    problems: [...detail.problems]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((problem) => ({
        key: keyFor(
          previous?.problems,
          (row) => row.problemId === problem.problemId,
        ),
        problemId: problem.problemId,
        customer: ref(problem.customerId),
        content: problem.content,
        status: problem.status,
      })),
    plans: [...detail.plans]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((plan) => ({
        key: keyFor(previous?.plans, (row) => row.planId === plan.planId),
        planId: plan.planId,
        customer: ref(plan.customerId),
        plannedDate: plan.plannedDate ?? "",
        content: plan.content,
      })),
  };
}

/**
 * 저장 본문. 세 배열을 항상 모두 담는다(전체 교체). 기존 행의 식별자는 그대로
 * 담는다 — 빼면 서버가 삭제하고 새로 만든다. `sortOrder` 는 화면 순서대로 1부터.
 */
function requireCustomerId(
  customer: CustomerRef | null,
  index: number,
): number {
  if (customer === null) {
    throw new Error(
      `방문 기록 ${index + 1}행에 고객이 없습니다. 검증 없이 저장을 시도했습니다.`,
    );
  }
  return customer.customerId;
}

export function toSaveBody(rows: FormRows): ReportSaveBody {
  const orNull = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    visits: rows.visits.map((row, index) => ({
      ...(row.visitId === undefined ? {} : { visitId: row.visitId }),
      // 방문의 고객은 필수다. `validateForSave` 가 먼저 막으므로 여기 오면 호출
      // 순서가 깨진 것이다. `!` 로 단정하면 "null 의 속성을 읽을 수 없다" 로
      // 터져 원인이 보이지 않으므로, 무엇이 깨졌는지 말하고 멈춘다.
      customerId: requireCustomerId(row.customer, index),
      visitTime: orNull(row.visitTime),
      visitType: row.visitType,
      content: row.content.trim(),
      result: orNull(row.result),
      sortOrder: index + 1,
    })),
    problems: rows.problems.map((row, index) => ({
      ...(row.problemId === undefined ? {} : { problemId: row.problemId }),
      customerId: row.customer?.customerId ?? null,
      content: row.content.trim(),
      status: row.status,
      sortOrder: index + 1,
    })),
    plans: rows.plans.map((row, index) => ({
      ...(row.planId === undefined ? {} : { planId: row.planId }),
      customerId: row.customer?.customerId ?? null,
      plannedDate: orNull(row.plannedDate),
      content: row.content.trim(),
      sortOrder: index + 1,
    })),
  };
}

// 제출 전 검증과 서버의 400 VISITS_REQUIRED 가 같은 규칙을 말한다. 문장을 두 군데
// 적어 두면 한쪽만 고쳐도 테스트가 둘 다 통과해 조용히 갈라진다. 한 곳에서 가져온다.
export { VISITS_REQUIRED_MESSAGE };

function checkContent(label: string, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return `${label}을 입력하세요.`;
  if (trimmed.length > CONTENT_MAX)
    return `${label}은 ${CONTENT_MAX}자 이하로 입력하세요.`;
  return null;
}

/** 저장 전 검증. 메시지 목록을 돌려주며 비어 있으면 통과다. */
export function validateForSave(rows: FormRows): string[] {
  const errors: string[] = [];
  const add = (message: string | null, prefix: string) => {
    if (message) errors.push(`${prefix} ${message}`);
  };

  if (rows.visits.length > MAX_ROWS)
    errors.push(`방문 기록은 ${MAX_ROWS}행까지 입력할 수 있습니다.`);
  if (rows.problems.length > MAX_ROWS)
    errors.push(`과제/상담은 ${MAX_ROWS}행까지 입력할 수 있습니다.`);
  if (rows.plans.length > MAX_ROWS)
    errors.push(`내일 할 일은 ${MAX_ROWS}행까지 입력할 수 있습니다.`);

  rows.visits.forEach((row, index) => {
    const prefix = `방문 기록 ${index + 1}행:`;
    if (row.customer === null) errors.push(`${prefix} 고객을 선택하세요.`);
    add(checkContent("방문내용", row.content), prefix);
    if (row.visitTime.trim() !== "" && !TIME_PATTERN.test(row.visitTime))
      errors.push(`${prefix} 방문시각은 HH:mm 형식이어야 합니다.`);
    if (row.result.trim().length > RESULT_MAX)
      errors.push(`${prefix} 상담결과는 ${RESULT_MAX}자 이하로 입력하세요.`);
  });
  rows.problems.forEach((row, index) => {
    add(checkContent("내용", row.content), `과제/상담 ${index + 1}행:`);
  });
  rows.plans.forEach((row, index) => {
    const prefix = `내일 할 일 ${index + 1}행:`;
    add(checkContent("내용", row.content), prefix);
    if (row.plannedDate.trim() !== "" && !DATE_PATTERN.test(row.plannedDate))
      errors.push(`${prefix} 예정일은 YYYY-MM-DD 형식이어야 합니다.`);
  });
  return errors;
}

/** 제출 전 검증. 저장 검증에 방문 1건 이상이 더해진다. */
export function validateForSubmit(rows: FormRows): string[] {
  const errors = validateForSave(rows);
  if (rows.visits.length === 0) errors.unshift(VISITS_REQUIRED_MESSAGE);
  return errors;
}
