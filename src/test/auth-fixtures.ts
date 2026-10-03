import { NextRequest } from "next/server";
import type { SalesRep } from "@prisma/client";

/** 합성 데이터. 실제 직원 정보나 실제 해시를 쓰지 않는다. (테스트 명세 1.4) */
export const ACTIVE_REP: SalesRep = {
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
  status: "ACTIVE",
  createdAt: new Date("2026-06-20T09:00:00.000Z"),
  updatedAt: new Date("2026-06-20T09:00:00.000Z"),
};

export const INACTIVE_REP: SalesRep = { ...ACTIVE_REP, status: "INACTIVE" };

/** 관리자가 임시 비밀번호를 발급한 상태. 본인이 바꿔야 한다. (이슈 #44) */
export const MUST_CHANGE_REP: SalesRep = { ...ACTIVE_REP, mustChangePassword: true };

/** 테스트 전용 더미 비밀번호. 실제 자격증명이 아니다. */
export const PASSWORD = "synthetic-password";

export function jsonRequest(url: string, body: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function readBody(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  };
}
