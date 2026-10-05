import { apiFetch, ApiClientError } from "./api-client";
import type { PageResponse } from "./sales-rep-api";

/** 화면이 쓰는 일일보고 타입과 호출. (이슈 #12, API 명세 3.1·3.2) */

export type ReportStatus = "DRAFT" | "SUBMITTED";

/** 목록 항목. 본인 목록이라 작성자 정보는 없다. */
export interface ReportListItem {
  reportId: number;
  /** `YYYY-MM-DD` */
  reportDate: string;
  visitCount: number;
  status: ReportStatus;
  commentCount: number;
  /** ISO 문자열 */
  updatedAt: string;
}

export interface ReportFilters {
  fromDate?: string;
  toDate?: string;
  status?: string;
  page?: number;
  size?: number;
  sort?: string;
}

function query(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function listReports(filters: ReportFilters = {}) {
  return apiFetch<PageResponse<ReportListItem>>(
    `/api/reports${query(filters)}`,
  );
}

/** 팀 보고 목록 항목. 본인 목록에 작성자가 더해진다. (API 명세 3.6) */
export interface TeamReportListItem extends ReportListItem {
  rep: { repId: number; name: string };
}

export interface TeamReportFilters extends ReportFilters {
  /** 비우면 팀 전체. 서버에는 쉼표로 이어 붙여 보낸다. */
  repIds?: number[];
  customerId?: number | string;
}

export function listTeamReports(filters: TeamReportFilters = {}) {
  const { repIds, ...rest } = filters;
  const base = query(rest);
  const ids = repIds && repIds.length > 0 ? repIds.join(",") : "";
  // 쉼표를 %2C 로 보내지 않도록 직접 붙인다(서버는 둘 다 같게 읽지만 명세 표기를 따른다).
  const extra = ids === "" ? "" : `repIds=${ids}`;
  const url =
    base === ""
      ? extra
        ? `?${extra}`
        : ""
      : extra
        ? `${base}&${extra}`
        : base;
  return apiFetch<PageResponse<TeamReportListItem>>(`/api/reports/team${url}`);
}

export function createReport(reportDate: string) {
  return apiFetch<{ reportId: number; status: ReportStatus }>("/api/reports", {
    method: "POST",
    body: { reportDate },
  });
}

export type VisitType = "VISIT" | "CALL" | "ONLINE";
export type ProblemStatus = "OPEN" | "CLOSED";

/** 상세 응답(API 명세 3.3). 과제·계획에는 고객 이름이 없고 식별자만 있다. */
export interface ReportDetail {
  reportId: number;
  rep: { repId: number; name: string };
  reportDate: string;
  status: ReportStatus;
  submittedAt: string | null;
  visits: {
    visitId: number;
    customer: { customerId: number; customerName: string };
    visitTime: string | null;
    visitType: VisitType;
    content: string;
    result: string | null;
    sortOrder: number;
  }[];
  problems: {
    problemId: number;
    customerId: number | null;
    content: string;
    status: ProblemStatus;
  }[];
  plans: {
    planId: number;
    customerId: number | null;
    plannedDate: string | null;
    content: string;
  }[];
}

/** 저장 본문(API 명세 3.4). 전체 교체라 세 배열을 항상 모두 보낸다. */
export interface ReportSaveBody {
  visits: {
    visitId?: number;
    customerId: number;
    visitTime: string | null;
    visitType: VisitType;
    content: string;
    result: string | null;
    sortOrder: number;
  }[];
  problems: {
    problemId?: number;
    customerId: number | null;
    content: string;
    status: ProblemStatus;
  }[];
  plans: {
    planId?: number;
    customerId: number | null;
    plannedDate: string | null;
    content: string;
  }[];
}

export function getReport(reportId: number) {
  return apiFetch<ReportDetail>(`/api/reports/${reportId}`);
}

export function saveReport(reportId: number, body: ReportSaveBody) {
  return apiFetch<ReportDetail>(`/api/reports/${reportId}`, {
    method: "PUT",
    body,
  });
}

export function submitReport(reportId: number) {
  return apiFetch<{
    reportId: number;
    status: ReportStatus;
    submittedAt: string;
  }>(`/api/reports/${reportId}/submit`, { method: "POST" });
}

/** 같은 일자의 보고가 이미 있을 때 서버가 주는 409 코드. */
export const REPORT_ALREADY_EXISTS = "REPORT_ALREADY_EXISTS";

export function isReportAlreadyExists(caught: unknown): boolean {
  return (
    caught instanceof ApiClientError &&
    caught.status === 409 &&
    caught.code === REPORT_ALREADY_EXISTS
  );
}

export const ROLE_FORBIDDEN_MESSAGE =
  "일일보고는 영업사원·상급자만 사용할 수 있습니다.";

// INVALID_REQUEST 는 ValidationError 의 기본 코드라 여러 조건이 같이 쓴다. 기간이
// 거꾸로인 경우, 잘못된 status, 잘못된 sort·size 가 모두 이 코드다. "날짜 형식이
// 틀렸다" 로 단정하면 형식이 맞는데도 그렇게 말하게 되고, 사용자가 형식을 고쳐도
// 해결되지 않는다. 그래서 **서버가 준 문장을 그대로 보여준다** — 서버 쪽이 어느
// 조건인지 알고 한국어로 적어 준다(예: "fromDate 는 toDate 보다 늦을 수 없습니다").
/**
 * 제출 전 화면 검증과 서버의 400 이 같은 규칙을 말한다. 두 군데 적어 두면 한쪽만
 * 고쳐도 양쪽 테스트가 통과해 조용히 갈라지므로, 여기를 단일 출처로 둔다.
 * (`report-form.ts` 가 이것을 가져온다 — 반대 방향은 순환 의존이다.)
 */
export const VISITS_REQUIRED_MESSAGE =
  "방문 기록을 1건 이상 입력해야 제출할 수 있습니다.";

const CODE_MESSAGE: Record<string, string> = {
  VISITS_REQUIRED: VISITS_REQUIRED_MESSAGE,
  REPORT_LOCKED: "제출된 보고는 수정할 수 없습니다.",
  REPORT_ALREADY_SUBMITTED: "이미 제출된 보고입니다.",
  CUSTOMER_NOT_FOUND: "선택한 고객을 찾을 수 없습니다. 고객을 다시 선택하세요.",
  NOT_FOUND: "보고를 찾을 수 없습니다.",
};

/** 서버 메시지를 그대로 보여줄 코드. 조건이 여러 개라 화면이 단정할 수 없다. */
const USE_SERVER_MESSAGE = new Set(["INVALID_REQUEST"]);

export function reportErrorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) {
    return fallback;
  }
  const byCode = CODE_MESSAGE[caught.code];
  if (byCode) {
    return byCode;
  }
  if (USE_SERVER_MESSAGE.has(caught.code) && caught.message) {
    return caught.message;
  }
  // 403 은 서버가 조건별로 정확한 문장을 준다 — 역할 불일치("이 작업을 수행할
  // 권한이 없습니다"), 조회 범위 밖("해당 보고에 접근할 권한이 없습니다"), 댓글
  // 작성 권한, 본인 댓글 아님이 모두 코드 `FORBIDDEN` 하나에 담겨 온다. 화면이
  // 한 문장으로 덮으면 **맞지 않는 안내가 나간다** — 상급자가 조회 범위 밖의
  // 보고를 열었을 때 "영업사원·상급자만 쓸 수 있습니다" 는 사실이 아니다.
  // 그래서 서버 문장을 쓰고, 서버가 문장을 주지 않을 때만 기본 문구로 돌아간다.
  if (caught.status === 403) {
    return caught.message || ROLE_FORBIDDEN_MESSAGE;
  }
  return fallback;
}
