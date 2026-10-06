import type { Prisma } from "@prisma/client";
import type { ReportSave } from "@/schemas/report";
import { ConflictError, ValidationError } from "./errors";
import type { AuthContext } from "./auth";
import { assertOwnerOrManager } from "./auth";
import { toJsonId } from "./identifier";

/**
 * 일일보고를 다룰 수 있는 역할. (FR-03, SCR-200·210, API 명세 1.5)
 *
 * ADMIN 은 넣지 않는다. 역할 간 상하 관계를 두지 않으므로 관리자는 영업
 * 마스터만 관리하고 보고는 담당 범위가 아니다. 상급자도 본인 보고를 쓰므로
 * MANAGER 는 넣는다.
 */
export const REPORT_ROLES = ["SALES_REP", "MANAGER"] as const;

/** `@db.Date` 컬럼용 값. UTC 자정으로 만든다. 서버 타임존에 영향받지 않는다. */
export function toDbDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * `@db.Date` 값을 `YYYY-MM-DD` 로 바꾼다.
 *
 * `toISOString` 은 UTC 기준이다. Prisma 가 날짜 컬럼을 UTC 자정으로 돌려주므로
 * 로컬 타임존 변환(`toLocaleDateString` 등)을 거치면 UTC+ 서버에서 하루가
 * 밀리는 일이 없다.
 */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 상세 조회에 필요한 관계. 응답에 쓰는 필드만 읽는다. (NFR-04)
 *
 * `rep.managerId` 는 상급자 판정용이고 응답에는 담지 않는다. 고객은 이름만
 * 읽는다 — 연락처·이메일은 보고 상세가 쓰지 않는다.
 */
export const REPORT_DETAIL_INCLUDE = {
  rep: { select: { repId: true, name: true, managerId: true } },
  visits: {
    orderBy: [{ sortOrder: "asc" }, { visitId: "asc" }],
    include: { customer: { select: { customerId: true, customerName: true } } },
  },
  // 2차 키(식별자)를 빼면 안 된다. 마이그레이션 직후 기존 행은 sort_order 가
  // 모두 0 이라 1차 키만으로는 전부 동점이고, DB 가 임의 순서로 돌려줘 기존
  // 보고의 순서가 달라진다. 식별자가 "만들어진 순서"를 보존한다. (visits 와 같다)
  // 관련 고객은 선택이라 null 일 수 있다. visits 와 같은 select 로 이름만 읽는다.
  problems: {
    orderBy: [{ sortOrder: "asc" }, { problemId: "asc" }],
    include: { customer: { select: { customerId: true, customerName: true } } },
  },
  plans: {
    orderBy: [{ sortOrder: "asc" }, { planId: "asc" }],
    include: { customer: { select: { customerId: true, customerName: true } } },
  },
} satisfies Prisma.DailyReportInclude;

export type ReportDetailRecord = Prisma.DailyReportGetPayload<{
  include: typeof REPORT_DETAIL_INCLUDE;
}>;

/** 목록 레코드. 건수는 `_count` 로 한 쿼리에서 얻는다. (N+1 방지) */
export interface ReportListRecord {
  reportId: bigint;
  reportDate: Date;
  status: "DRAFT" | "SUBMITTED";
  updatedAt: Date;
  _count: { visits: number; comments: number };
}

/** 목록 응답. (API 명세 3.1, 화면정의서 SCR-200) */
export interface ReportListItem {
  reportId: number;
  reportDate: string;
  visitCount: number;
  status: "DRAFT" | "SUBMITTED";
  commentCount: number;
  updatedAt: string;
}

export function toReportListItem(record: ReportListRecord): ReportListItem {
  return {
    reportId: toJsonId(record.reportId),
    reportDate: formatDateOnly(record.reportDate),
    visitCount: record._count.visits,
    status: record.status,
    commentCount: record._count.comments,
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * 팀 목록 레코드. 본인 목록과 달리 작성자를 담는다. (API 명세 3.6, SCR-300)
 *
 * 작성자는 `repId`·`name` 만 읽는다. 이메일·사번은 팀 목록이 쓰지 않는다. (NFR-04)
 */
export interface TeamReportListRecord extends ReportListRecord {
  rep: { repId: bigint; name: string };
}

export interface TeamReportListItem extends ReportListItem {
  rep: { repId: number; name: string };
}

export function toTeamReportListItem(
  record: TeamReportListRecord,
): TeamReportListItem {
  return {
    ...toReportListItem(record),
    rep: { repId: toJsonId(record.rep.repId), name: record.rep.name },
  };
}

/**
 * 상세·저장 응답. (API 명세 3.3, 3.4)
 *
 * Prisma 모델을 그대로 반환하지 않고 필드를 명시적으로 나열한다. 컬럼이 늘어도
 * 조용히 새 나가지 않게 하려는 것이다. (NFR-04)
 */
export interface ReportDetailResponse {
  reportId: number;
  rep: { repId: number; name: string };
  reportDate: string;
  status: "DRAFT" | "SUBMITTED";
  submittedAt: string | null;
  visits: {
    visitId: number;
    customer: { customerId: number; customerName: string };
    visitTime: string | null;
    visitType: "VISIT" | "CALL" | "ONLINE";
    content: string;
    result: string | null;
    sortOrder: number;
  }[];
  problems: {
    problemId: number;
    customer: { customerId: number; customerName: string } | null;
    content: string;
    status: "OPEN" | "CLOSED";
    sortOrder: number;
  }[];
  plans: {
    planId: number;
    customer: { customerId: number; customerName: string } | null;
    plannedDate: string | null;
    content: string;
    sortOrder: number;
  }[];
}

/** 관련 고객이 선택인 행(과제·계획)용. 고객이 없으면 null. */
function toReportCustomerOrNull(
  customer: { customerId: bigint; customerName: string } | null,
): { customerId: number; customerName: string } | null {
  return customer
    ? {
        customerId: toJsonId(customer.customerId),
        customerName: customer.customerName,
      }
    : null;
}

export function toReportDetail(
  report: ReportDetailRecord,
): ReportDetailResponse {
  return {
    reportId: toJsonId(report.reportId),
    rep: { repId: toJsonId(report.rep.repId), name: report.rep.name },
    reportDate: formatDateOnly(report.reportDate),
    status: report.status,
    submittedAt: report.submittedAt?.toISOString() ?? null,
    visits: report.visits.map((visit) => ({
      visitId: toJsonId(visit.visitId),
      customer: {
        customerId: toJsonId(visit.customer.customerId),
        customerName: visit.customer.customerName,
      },
      visitTime: visit.visitTime,
      visitType: visit.visitType,
      content: visit.content,
      result: visit.result,
      sortOrder: visit.sortOrder,
    })),
    problems: report.problems.map((problem) => ({
      problemId: toJsonId(problem.problemId),
      customer: toReportCustomerOrNull(problem.customer),
      content: problem.content,
      status: problem.status,
      sortOrder: problem.sortOrder,
    })),
    plans: report.plans.map((plan) => ({
      planId: toJsonId(plan.planId),
      customer: toReportCustomerOrNull(plan.customer),
      plannedDate: plan.plannedDate ? formatDateOnly(plan.plannedDate) : null,
      content: plan.content,
      sortOrder: plan.sortOrder,
    })),
  };
}

/** 열람 판정에 필요한 보고의 최소 정보. */
export interface ViewableReport {
  repId: bigint;
  status: "DRAFT" | "SUBMITTED";
  rep: { managerId: bigint | null };
}

/**
 * 보고를 열람할 수 있는지 판정한다. (TC-SEC-01, NFR-01)
 *
 * **작성자 본인 또는 직속 상급자다. 상태로 제한하지 않는다** — 상급자는 팀원의
 * 작성중 보고도 볼 수 있다. 화면정의서 SCR-300 의 검색 조건에 상태 "제출/작성중"
 * 이 있고 API 명세 3.6 의 `status` 파라미터도 DRAFT 를 받는다. 목록에 나오는 보고를
 * 열면 403 이 되는 상태를 만들지 않는다. `auth.ts` 의 역할 표도 상급자 권한을
 * "직속 팀원 보고 조회(작성중 포함)" 로 적는다.
 *
 * **제출 여부로 갈리는 것은 댓글 작성이다**(FR-09, `assertCanComment` →
 * 409 `REPORT_NOT_SUBMITTED`). 열람과 혼동하지 않는다.
 *
 * 없는 보고(404)와 권한 없는 보고(403)는 호출 측이 가른다. 둘을 같은 404 로
 * 합치면 순차 식별자 열거를 막는 데는 낫지만, 명세(TC-SEC-01)는 둘 다 허용하고
 * 기존 헬퍼(`assertOwnerOrManager`)가 403 으로 설계되어 있어 그대로 따른다.
 */
export function assertReportViewable(
  auth: AuthContext,
  report: ViewableReport,
): void {
  assertOwnerOrManager(auth, {
    repId: report.repId,
    managerId: report.rep.managerId,
  });
}

/**
 * 보고 행을 잠그고 DRAFT 인지 다시 확인한다. 트랜잭션 안에서만 호출한다.
 *
 * 앞서 읽은 상태로 판단하면 검사와 쓰기 사이에 제출이 끼어들 수 있다
 * (check-then-write). `status = DRAFT` 조건이 걸린 UPDATE 는 행 잠금을 잡고
 * 조건을 다시 평가하므로, 동시에 들어온 PUT·제출은 여기서 줄을 선다. 잠금은
 * 트랜잭션이 끝날 때 풀린다. 별도의 권고 잠금 키를 두지 않아도 되는 이유다.
 *
 * `updatedAt` 도 함께 올린다. 방문 행만 바뀌어도 보고의 최종수정(SCR-200)이
 * 갱신되어야 한다.
 */
export async function lockDraftReport(
  tx: Prisma.TransactionClient,
  reportId: bigint,
  data: Prisma.DailyReportUpdateManyMutationInput = {},
): Promise<void> {
  const { count } = await tx.dailyReport.updateMany({
    where: { reportId, status: "DRAFT" },
    data: { updatedAt: new Date(), ...data },
  });

  if (count === 0) {
    throw new ConflictError(
      "REPORT_LOCKED",
      "제출된 보고는 수정할 수 없습니다.",
    );
  }
}

/**
 * 요청에 담긴 행 식별자가 모두 이 보고의 행인지 확인한다. (IDOR 방어)
 *
 * 남의 보고의 `visitId` 를 섞어 보내면 갱신이 그 행을 가져오거나 고친다.
 * 존재하지 않는 식별자와 다른 보고의 식별자를 같은 응답으로 돌려, 다른 보고에
 * 그 행이 있다는 사실이 드러나지 않게 한다.
 */
function assertIdsBelong(
  requested: (number | undefined)[],
  existing: bigint[],
  label: string,
  code: string,
): void {
  const owned = new Set(existing.map((id) => id.toString()));
  const foreign = requested.some(
    (id) => id !== undefined && !owned.has(String(id)),
  );

  if (foreign) {
    throw new ValidationError(`보고에 속하지 않은 ${label}입니다.`, code);
  }
}

/** 참조한 고객이 모두 존재하는지 확인한다. 비활성 고객도 허용한다. (NFR-03) */
async function assertCustomersExist(
  tx: Prisma.TransactionClient,
  input: ReportSave,
): Promise<void> {
  const ids = new Set<number>();
  for (const row of [...input.visits, ...input.problems, ...input.plans]) {
    if (row.customerId !== null) {
      ids.add(row.customerId);
    }
  }

  if (ids.size === 0) {
    return;
  }

  const found = await tx.customer.findMany({
    where: { customerId: { in: [...ids].map(BigInt) } },
    select: { customerId: true },
  });

  if (found.length !== ids.size) {
    throw new ValidationError(
      "존재하지 않는 고객이 포함되어 있습니다.",
      "CUSTOMER_NOT_FOUND",
    );
  }
}

/**
 * 보고의 방문·과제·계획을 요청 내용으로 전체 교체한다. (API 명세 3.4)
 *
 * 반드시 `lockDraftReport` 를 통과한 트랜잭션 안에서 호출한다. 삭제만 되고
 * 생성이 실패하면 사용자 데이터가 사라지므로 한 트랜잭션이어야 한다.
 *
 * 순서: 검증 전부 → 요청에 없는 행 삭제 → 식별자 있는 행 갱신 → 나머지 생성.
 * 검증이 쓰기보다 앞이라 잘못된 요청은 아무것도 건드리지 못한다.
 * 갱신은 `reportId` 조건을 다시 건다 — 검증이 뚫려도 다른 보고의 행은 못 고친다.
 */
export async function replaceReportContent(
  tx: Prisma.TransactionClient,
  reportId: bigint,
  input: ReportSave,
): Promise<void> {
  const [visitRows, problemRows, planRows] = await Promise.all([
    tx.visitRecord.findMany({ where: { reportId }, select: { visitId: true } }),
    tx.reportProblem.findMany({
      where: { reportId },
      select: { problemId: true },
    }),
    tx.reportPlan.findMany({ where: { reportId }, select: { planId: true } }),
  ]);

  assertIdsBelong(
    input.visits.map((row) => row.visitId),
    visitRows.map((row) => row.visitId),
    "방문기록",
    "VISIT_NOT_IN_REPORT",
  );
  assertIdsBelong(
    input.problems.map((row) => row.problemId),
    problemRows.map((row) => row.problemId),
    "과제",
    "PROBLEM_NOT_IN_REPORT",
  );
  assertIdsBelong(
    input.plans.map((row) => row.planId),
    planRows.map((row) => row.planId),
    "계획",
    "PLAN_NOT_IN_REPORT",
  );
  await assertCustomersExist(tx, input);

  const keptVisitIds = input.visits.flatMap((row) =>
    row.visitId === undefined ? [] : [BigInt(row.visitId)],
  );
  const keptProblemIds = input.problems.flatMap((row) =>
    row.problemId === undefined ? [] : [BigInt(row.problemId)],
  );
  const keptPlanIds = input.plans.flatMap((row) =>
    row.planId === undefined ? [] : [BigInt(row.planId)],
  );

  // 요청에 없는 기존 행 삭제. 빈 notIn 은 "전부"라 보고의 행이 모두 지워진다.
  await tx.visitRecord.deleteMany({
    where: { reportId, visitId: { notIn: keptVisitIds } },
  });
  await tx.reportProblem.deleteMany({
    where: { reportId, problemId: { notIn: keptProblemIds } },
  });
  await tx.reportPlan.deleteMany({
    where: { reportId, planId: { notIn: keptPlanIds } },
  });

  const newVisits: Prisma.VisitRecordCreateManyInput[] = [];
  for (const [index, row] of input.visits.entries()) {
    const data = {
      customerId: BigInt(row.customerId),
      visitTime: row.visitTime,
      visitType: row.visitType,
      content: row.content,
      result: row.result,
      // 생략하면 요청 순서를 따른다.
      sortOrder: row.sortOrder ?? index + 1,
    };
    if (row.visitId === undefined) {
      newVisits.push({ ...data, reportId });
    } else {
      await tx.visitRecord.updateMany({
        where: { visitId: BigInt(row.visitId), reportId },
        data,
      });
    }
  }

  const newProblems: Prisma.ReportProblemCreateManyInput[] = [];
  for (const [index, row] of input.problems.entries()) {
    const data = {
      customerId: row.customerId === null ? null : BigInt(row.customerId),
      content: row.content,
      status: row.status,
      // 생략하면 요청 순서를 따른다. (방문기록과 같다)
      sortOrder: row.sortOrder ?? index + 1,
    };
    if (row.problemId === undefined) {
      newProblems.push({ ...data, reportId });
    } else {
      await tx.reportProblem.updateMany({
        where: { problemId: BigInt(row.problemId), reportId },
        data,
      });
    }
  }

  const newPlans: Prisma.ReportPlanCreateManyInput[] = [];
  for (const [index, row] of input.plans.entries()) {
    const data = {
      customerId: row.customerId === null ? null : BigInt(row.customerId),
      plannedDate: row.plannedDate === null ? null : toDbDate(row.plannedDate),
      content: row.content,
      sortOrder: row.sortOrder ?? index + 1,
    };
    if (row.planId === undefined) {
      newPlans.push({ ...data, reportId });
    } else {
      await tx.reportPlan.updateMany({
        where: { planId: BigInt(row.planId), reportId },
        data,
      });
    }
  }

  if (newVisits.length > 0) {
    await tx.visitRecord.createMany({ data: newVisits });
  }
  if (newProblems.length > 0) {
    await tx.reportProblem.createMany({ data: newProblems });
  }
  if (newPlans.length > 0) {
    await tx.reportPlan.createMany({ data: newPlans });
  }
}
