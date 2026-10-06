import { apiFetch } from "./api-client";

/** 화면이 쓰는 영업 마스터 타입과 호출. (이슈 #17) */

export type Role = "SALES_REP" | "MANAGER" | "ADMIN";
export type RepStatus = "ACTIVE" | "INACTIVE";

export interface SalesRepListItem {
  repId: number;
  empNo: string;
  name: string;
  department: string | null;
  position: string | null;
  managerId: number | null;
  managerName: string | null;
  role: Role;
  status: RepStatus;
}

/**
 * 단건 응답. 네 라우트가 모두 이 모양을 돌려준다 — 등록(6.2)·상세·수정(6.3)·
 * 비활성화(6.4). 목록 항목과 다르다: `managerName` 이 **없고** `email`·
 * `createdAt`·`updatedAt` 이 **있다**.
 *
 * **명세는 단건 응답의 필드를 열거하지 않는다.** 6.2 의 201 예시는 `repId`·
 * `empNo`·`name`·`role`·`temporaryPassword` 만 적었고 6.3 은 응답 필드를 적지
 * 않았다. 그래서 이 타입의 근거는 명세가 아니라 서버 `SalesRepResponse` 이며,
 * `api-contract.test.ts` 가 `tsc` 로 둘을 묶는다. (이슈 #96)
 */
export interface SalesRepDetail extends Omit<SalesRepListItem, "managerName"> {
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface SalesRepFormValues {
  empNo: string;
  name: string;
  email: string;
  department: string;
  position: string;
  managerId: string;
  role: Role;
  status: RepStatus;
}

/** 등록 응답. 비밀번호를 생략하면 임시 비밀번호가 1회 담겨 온다. (#44) */
export interface CreatedSalesRep extends SalesRepDetail {
  temporaryPassword?: string;
}

export interface SalesRepFilters {
  keyword?: string;
  department?: string;
  status?: string;
  role?: Role;
  size?: number;
}

function query(filters: SalesRepFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function listSalesReps(filters: SalesRepFilters = {}) {
  return apiFetch<PageResponse<SalesRepListItem>>(
    `/api/sales-reps${query(filters)}`,
  );
}

export function getSalesRep(repId: number) {
  return apiFetch<SalesRepDetail>(`/api/sales-reps/${repId}`);
}

/**
 * 빈 문자열은 보내지 않는다. 선택 항목을 비워 두면 서버 스키마가 빈 문자열을
 * 거부하므로, 아예 생략해 "없음" 으로 전달한다.
 */
/**
 * 폼 상태를 요청 본문으로. **`api-contract.test.ts` 가 서버 스키마와 묶으려고
 * export 한다** — 비공개로 두면 "폼이 실제로 보내는 모양" 을 검증할 대상이 없고,
 * 서버 스키마가 필드를 필수로 바꿔도 아무 신호가 없다(이슈 #96 검토).
 */
export function toRequestBody(values: SalesRepFormValues) {
  return {
    empNo: values.empNo,
    name: values.name,
    email: values.email,
    department: values.department === "" ? undefined : values.department,
    position: values.position === "" ? undefined : values.position,
    managerId: values.managerId === "" ? undefined : Number(values.managerId),
    role: values.role,
    status: values.status,
  };
}

export function createSalesRep(values: SalesRepFormValues) {
  return apiFetch<CreatedSalesRep>("/api/sales-reps", {
    method: "POST",
    body: toRequestBody(values),
  });
}

export function updateSalesRep(repId: number, values: SalesRepFormValues) {
  return apiFetch<SalesRepDetail>(`/api/sales-reps/${repId}`, {
    method: "PUT",
    body: toRequestBody(values),
  });
}

export function changeSalesRepStatus(repId: number, status: RepStatus) {
  return apiFetch<SalesRepDetail>(`/api/sales-reps/${repId}/status`, {
    method: "PATCH",
    body: { status },
  });
}

export function resetSalesRepPassword(repId: number) {
  return apiFetch<{ repId: number; empNo: string; temporaryPassword: string }>(
    `/api/sales-reps/${repId}/password/reset`,
    { method: "POST" },
  );
}

/** 팀 보고 조회의 팀원 선택지. 비활성 팀원도 온다(과거 보고 필터용). (API 명세 6.7) */
export interface TeamOption {
  repId: number;
  name: string;
  status: RepStatus;
}

export function listTeamOptions() {
  return apiFetch<TeamOption[]>("/api/sales-reps/team");
}
