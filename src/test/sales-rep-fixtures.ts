import { NextRequest } from "next/server";
import { bearerHeaders } from "@/test/auth-headers";
import type { SalesRep } from "@prisma/client";

/** 합성 데이터. 실제 직원 정보를 쓰지 않는다. (테스트 명세 1.4) */
export const REP: SalesRep = {
  repId: 1n,
  empNo: "S2026001",
  name: "홍길동",
  email: "hong@example.com",
  department: "영업1팀",
  position: "대리",
  managerId: 2n,
  passwordHash: "$2a$10$synthetic.hash.value.for.tests.only.not.a.secret",
  role: "SALES_REP",
  mustChangePassword: false,
  tokenVersion: 0,
  status: "ACTIVE",
  createdAt: new Date("2026-06-20T09:00:00.000Z"),
  updatedAt: new Date("2026-06-20T09:00:00.000Z"),
};

/** 상급자 이름을 함께 읽은 목록용 레코드. (#17) */
export const REP_WITH_MANAGER = { ...REP, manager: { name: "김부장" } };

/** 상급자로 지정 가능한 사원. role 이 MANAGER 여야 한다. */
export const MANAGER_REP: SalesRep = {
  ...REP,
  repId: 2n,
  empNo: "S2026000",
  name: "김부장",
  email: "manager@example.com",
  managerId: null,
  role: "MANAGER",
};

const ADMIN_HEADERS = bearerHeaders(9, "ADMIN");
const SALES_REP_HEADERS = bearerHeaders(1, "SALES_REP");

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function request(
  url: string,
  { method = "GET", body, headers }: RequestOptions = {},
) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 프록시가 ADMIN 토큰을 검증한 뒤의 요청. */
export function asAdmin(url: string, options: RequestOptions = {}) {
  return request(url, {
    ...options,
    headers: { ...ADMIN_HEADERS, ...options.headers },
  });
}

/** 영업사원 권한 요청. 관리자 전용 API에서 403이어야 한다. (TC-SEC-03) */
export function asSalesRep(url: string, options: RequestOptions = {}) {
  return request(url, {
    ...options,
    headers: { ...SALES_REP_HEADERS, ...options.headers },
  });
}

/** 프록시를 거치지 않아 인증 헤더가 없는 요청. */
export function withoutAuth(url: string, options: RequestOptions = {}) {
  return request(url, options);
}

export async function readBody(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data: unknown;
    error: { code: string; message: string } | null;
  };
}

/** 경로 파라미터는 Next 15에서 Promise로 들어온다. */
export function params(repId: string) {
  return { params: Promise.resolve({ repId }) };
}
