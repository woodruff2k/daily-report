import { apiFetch, ApiClientError } from "./api-client";
import type { PageResponse } from "./sales-rep-api";

/** 화면이 쓰는 고객 마스터 타입과 호출. (이슈 #16, API 명세 5장·6.6) */

export type CustomerStatus = "ACTIVE" | "INACTIVE";

/**
 * 목록 항목. `email`·`address` 는 담기지 않는다. (NFR-04)
 * 그래서 목록 화면은 그 컬럼을 두지 않고, 상세(수정 화면)에서만 본다.
 */
export interface CustomerListItem {
  customerId: number;
  customerName: string;
  companyName: string | null;
  phone: string | null;
  grade: string | null;
  assignedRepId: number | null;
  assignedRepName: string | null;
  status: CustomerStatus;
}

export interface CustomerDetail extends CustomerListItem {
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerFormValues {
  customerName: string;
  companyName: string;
  phone: string;
  email: string;
  address: string;
  grade: string;
  assignedRepId: string;
  status: CustomerStatus;
}

export interface CustomerFilters {
  keyword?: string;
  assignedRepId?: string;
  grade?: string;
  status?: string;
  size?: number;
}

/** 담당 영업 Select 옵션. 활성 사원만 온다. (API 명세 6.6) */
export interface SalesRepOption {
  repId: number;
  name: string;
}

function query(filters: CustomerFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function listCustomers(filters: CustomerFilters = {}) {
  return apiFetch<PageResponse<CustomerListItem>>(
    `/api/customers${query(filters)}`,
  );
}

export function getCustomer(customerId: number) {
  return apiFetch<CustomerDetail>(`/api/customers/${customerId}`);
}

/**
 * `GET /api/sales-reps` 가 아니라 `options` 를 쓴다. 앞의 것은 관리자 전용이라
 * 고객 화면을 쓰는 영업사원·상급자에게는 403 이다.
 */
export function listSalesRepOptions() {
  return apiFetch<SalesRepOption[]>("/api/sales-reps/options");
}

/**
 * PUT 은 전체 교체라 모든 필드를 보낸다. 비운 선택 항목은 null 로 보내
 * "비움" 을 분명히 한다(생략해도 서버가 null 로 비우지만 의도를 드러낸다).
 */
function toRequestBody(values: CustomerFormValues) {
  const orNull = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    customerName: values.customerName.trim(),
    companyName: orNull(values.companyName),
    phone: orNull(values.phone),
    email: orNull(values.email),
    address: orNull(values.address),
    grade: orNull(values.grade),
    assignedRepId: Number(values.assignedRepId),
    status: values.status,
  };
}

export function createCustomer(values: CustomerFormValues) {
  return apiFetch<CustomerDetail>("/api/customers", {
    method: "POST",
    body: toRequestBody(values),
  });
}

export function updateCustomer(customerId: number, values: CustomerFormValues) {
  return apiFetch<CustomerDetail>(`/api/customers/${customerId}`, {
    method: "PUT",
    body: toRequestBody(values),
  });
}

/** 삭제가 아니라 상태 전환이다. 물리 삭제 API 는 없다. (NFR-03) */
export function changeCustomerStatus(
  customerId: number,
  status: CustomerStatus,
) {
  return apiFetch<CustomerDetail>(`/api/customers/${customerId}/status`, {
    method: "PATCH",
    body: { status },
  });
}

const CODE_MESSAGE: Record<string, string> = {
  ASSIGNED_REP_NOT_FOUND: "담당 영업을 찾을 수 없습니다. 다시 선택하세요.",
  ASSIGNED_REP_INACTIVE:
    "비활성 상태인 사원은 담당 영업으로 지정할 수 없습니다. 다른 사원을 선택하세요.",
  INVALID_REQUEST:
    "입력값을 확인하세요. 이메일·연락처 형식이 올바르지 않을 수 있습니다.",
  NOT_FOUND: "고객을 찾을 수 없습니다.",
};

/**
 * 서버 오류를 사용자가 읽을 문장으로 바꾼다.
 *
 * 403 은 코드보다 상태로 가른다. 고객 API 는 ADMIN 을 막으므로(명세 1.5)
 * 관리자가 들어오면 여기에 온다. 화면을 숨기는 것은 접근통제가 아니며 서버가
 * 이미 막고 있다 — 이 문장은 빈 화면 대신 이유를 알려줄 뿐이다.
 */
export function customerErrorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) {
    return fallback;
  }
  if (caught.status === 403) {
    return "고객 마스터는 영업사원·상급자만 사용할 수 있습니다.";
  }
  return CODE_MESSAGE[caught.code] ?? fallback;
}
