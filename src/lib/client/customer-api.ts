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
  /**
   * 호출자가 이 고객을 수정·비활성화할 수 있는지. 서버가 계산한다. (이슈 #68)
   * 상급자 판정에는 담당 사원의 managerId 가 필요한데 목록 응답에 없으므로
   * 화면이 `assignedRepId` 로 다시 계산하지 않는다 — 상급자 버튼이 사라진다.
   * **접근통제가 아니다.** 서버가 PUT·PATCH 에서 다시 막는다.
   */
  editable: boolean;
}

/** 상세 응답에는 `editable` 이 없다. 상세는 전사 공개다. */
export interface CustomerDetail extends Omit<CustomerListItem, "editable"> {
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

/**
 * 403 의 두 가지 사유에 대응하는 문장.
 *
 * 화면을 숨기는 것은 접근통제가 아니다 — 서버가 이미 막고 있고, 이 문장은 빈
 * 화면 대신 이유를 알려줄 뿐이다.
 */
export const ROLE_FORBIDDEN_MESSAGE =
  "고객 마스터는 영업사원·상급자만 사용할 수 있습니다.";
export const SCOPE_FORBIDDEN_MESSAGE =
  "담당 영업과 그 상급자만 수정할 수 있습니다.";

const CODE_MESSAGE: Record<string, string> = {
  CUSTOMER_WRITE_FORBIDDEN: SCOPE_FORBIDDEN_MESSAGE,
  ASSIGNED_REP_NOT_FOUND: "담당 영업을 찾을 수 없습니다. 다시 선택하세요.",
  ASSIGNED_REP_INACTIVE:
    "비활성 상태인 사원은 담당 영업으로 지정할 수 없습니다. 다른 사원을 선택하세요.",
  INVALID_REQUEST:
    "입력값을 확인하세요. 이메일·연락처 형식이 올바르지 않을 수 있습니다.",
  NOT_FOUND: "고객을 찾을 수 없습니다.",
};

export function customerErrorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) {
    return fallback;
  }
  // 코드를 먼저 본다. 서버가 403 을 두 가지로 나눠 주기 때문이다 —
  // CUSTOMER_WRITE_FORBIDDEN 은 "남의 고객", 그 밖의 403 은 "역할이 안 맞음".
  // 호출 지점으로 가르지 않는다. 새 호출부가 생길 때 조용히 틀린 문구가 나간다.
  const byCode = CODE_MESSAGE[caught.code];
  if (byCode) {
    return byCode;
  }
  if (caught.status === 403) {
    return ROLE_FORBIDDEN_MESSAGE;
  }
  return fallback;
}
