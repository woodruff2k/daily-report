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

export interface SalesRepDetail extends SalesRepListItem {
  email: string;
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
  return apiFetch<PageResponse<SalesRepListItem>>(`/api/sales-reps${query(filters)}`);
}

export function getSalesRep(repId: number) {
  return apiFetch<SalesRepDetail>(`/api/sales-reps/${repId}`);
}

/**
 * 빈 문자열은 보내지 않는다. 선택 항목을 비워 두면 서버 스키마가 빈 문자열을
 * 거부하므로, 아예 생략해 "없음" 으로 전달한다.
 */
function toRequestBody(values: SalesRepFormValues) {
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
    { method: "POST" }
  );
}
