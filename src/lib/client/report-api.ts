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

export function createReport(reportDate: string) {
  return apiFetch<{ reportId: number; status: ReportStatus }>("/api/reports", {
    method: "POST",
    body: { reportDate },
  });
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
const CODE_MESSAGE: Record<string, string> = {};

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
  if (caught.status === 403) {
    return ROLE_FORBIDDEN_MESSAGE;
  }
  return fallback;
}
