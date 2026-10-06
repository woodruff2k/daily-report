import { NextRequest } from "next/server";
import { bearerHeaders } from "@/test/auth-headers";
import type { Customer } from "@prisma/client";

/** 합성 데이터. 실제 고객 정보를 쓰지 않는다. (테스트 명세 1.4) */
export const CUSTOMER: Customer = {
  customerId: 5n,
  customerName: "테스트고객",
  companyName: "(주)가상상사",
  phone: "02-000-0000",
  email: "customer@example.com",
  address: "서울시 가상구 테스트로 1",
  grade: "A",
  assignedRepId: 1n,
  status: "ACTIVE",
  createdAt: new Date("2026-06-20T09:00:00.000Z"),
  updatedAt: new Date("2026-06-20T09:00:00.000Z"),
};

/** 담당 영업 이름을 함께 읽은 목록용 레코드. */
export const CUSTOMER_WITH_REP = {
  ...CUSTOMER,
  // repId·managerId 는 목록의 `editable` 판정에 쓰고 응답에는 담지 않는다.
  // 담당 영업(repId 1)의 직속 상급자는 repId 2 다.
  assignedRep: { name: "홍길동", repId: 1n, managerId: 2n },
};

/**
 * 쓰기 범위 판정용 조회 결과. 담당 영업(repId 1)의 직속 상급자는 repId 2 다.
 * `asSalesRep`(1)은 담당 본인, `asManager`(2)는 직속 상급자다.
 */
export const CUSTOMER_WITH_SCOPE = {
  ...CUSTOMER,
  assignedRep: { repId: 1n, managerId: 2n },
};

/** 담당자와 무관한 영업사원(repId 7). */
export function asStranger(url: string, options?: RequestOptions) {
  return request(url, bearerHeaders(7, "SALES_REP"), options);
}

/** 다른 팀 상급자(repId 8). 담당 영업의 상급자가 아니다. */
export function asOtherTeamManager(url: string, options?: RequestOptions) {
  return request(url, bearerHeaders(8, "MANAGER"), options);
}

/** 담당 영업으로 지정 가능한 활성 사원. */
export const ACTIVE_ASSIGNEE = { status: "ACTIVE" as const };

export const CUSTOMER_BODY = {
  customerName: "테스트고객",
  companyName: "(주)가상상사",
  phone: "02-000-0000",
  email: "customer@example.com",
  address: "서울시 가상구 테스트로 1",
  grade: "A",
  assignedRepId: 1,
  status: "ACTIVE",
};

interface RequestOptions {
  method?: string;
  body?: unknown;
}

function request(
  url: string,
  headers: Record<string, string>,
  { method = "GET", body }: RequestOptions = {},
) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function asSalesRep(url: string, options?: RequestOptions) {
  return request(url, bearerHeaders(1, "SALES_REP"), options);
}

export function asManager(url: string, options?: RequestOptions) {
  return request(url, bearerHeaders(2, "MANAGER"), options);
}

/** 고객 마스터는 관리자 담당이 아니다. 403이어야 한다. */
export function asAdmin(url: string, options?: RequestOptions) {
  return request(url, bearerHeaders(9, "ADMIN"), options);
}

export function withoutAuth(url: string, options?: RequestOptions) {
  return request(url, {}, options);
}

export async function readBody(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  };
}

export function params(customerId: string) {
  return { params: Promise.resolve({ customerId }) };
}
