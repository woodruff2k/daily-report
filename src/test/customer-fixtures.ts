import { NextRequest } from "next/server";
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
  assignedRep: { name: "홍길동" },
};

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
  return request(
    url,
    { "x-user-rep-id": "1", "x-user-role": "SALES_REP" },
    options,
  );
}

export function asManager(url: string, options?: RequestOptions) {
  return request(
    url,
    { "x-user-rep-id": "2", "x-user-role": "MANAGER" },
    options,
  );
}

/** 고객 마스터는 관리자 담당이 아니다. 403이어야 한다. */
export function asAdmin(url: string, options?: RequestOptions) {
  return request(
    url,
    { "x-user-rep-id": "9", "x-user-role": "ADMIN" },
    options,
  );
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
