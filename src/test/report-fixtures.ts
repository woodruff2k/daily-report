import { NextRequest } from "next/server";
import type { ReportDetailRecord } from "@/lib/report";

/**
 * 합성 데이터. 실제 고객·직원 정보를 쓰지 않는다. (테스트 명세 1.4)
 *
 * 인물 관계: 1번(SALES_REP)의 상급자가 2번(MANAGER). 3번은 팀 밖의 다른 영업사원,
 * 4번은 다른 상급자다.
 */
export const REPORT: ReportDetailRecord = {
  reportId: 10n,
  repId: 1n,
  reportDate: new Date("2026-06-20T00:00:00.000Z"),
  status: "DRAFT",
  submittedAt: null,
  createdAt: new Date("2026-06-20T09:00:00.000Z"),
  updatedAt: new Date("2026-06-20T09:10:00.000Z"),
  rep: { repId: 1n, name: "홍길동", managerId: 2n },
  visits: [
    {
      visitId: 100n,
      reportId: 10n,
      customerId: 5n,
      visitTime: "10:00",
      visitType: "VISIT",
      content: "신제품 소개",
      result: "견적요청",
      sortOrder: 1,
      createdAt: new Date("2026-06-20T09:00:00.000Z"),
      customer: { customerId: 5n, customerName: "테스트고객" },
    },
  ],
  problems: [
    {
      problemId: 200n,
      reportId: 10n,
      customerId: 5n,
      content: "납기 단축 요청",
      status: "OPEN",
      sortOrder: 1,
      createdAt: new Date("2026-06-20T09:00:00.000Z"),
    },
  ],
  plans: [
    {
      planId: 300n,
      reportId: 10n,
      customerId: null,
      plannedDate: new Date("2026-06-21T00:00:00.000Z"),
      content: "견적서 발송",
      sortOrder: 1,
      createdAt: new Date("2026-06-20T09:00:00.000Z"),
    },
  ],
};

export const SUBMITTED_REPORT: ReportDetailRecord = {
  ...REPORT,
  status: "SUBMITTED",
  submittedAt: new Date("2026-06-20T09:10:00.000Z"),
};

/** 목록용 레코드. */
export const REPORT_LIST_RECORD = {
  reportId: 10n,
  reportDate: new Date("2026-06-20T00:00:00.000Z"),
  status: "SUBMITTED" as const,
  updatedAt: new Date("2026-06-20T09:10:00.000Z"),
  _count: { visits: 3, comments: 2 },
};

/** 팀 목록용 레코드. 작성자는 repId·name 만 읽는다. */
export const TEAM_REPORT_LIST_RECORD = {
  ...REPORT_LIST_RECORD,
  rep: { repId: 1n, name: "홍길동" },
};

/** PUT 요청 본문. 기존 행(visitId 100 등)을 수정하고 새 행을 더한다. */
export const SAVE_BODY = {
  visits: [
    {
      visitId: 100,
      customerId: 5,
      visitTime: "10:00",
      visitType: "VISIT",
      content: "신제품 소개",
      result: "견적요청",
      sortOrder: 1,
    },
    {
      customerId: 8,
      visitTime: "14:00",
      visitType: "CALL",
      content: "재고 문의",
      result: "보류",
      sortOrder: 2,
    },
  ],
  problems: [{ customerId: 5, content: "납기 단축 요청", status: "OPEN" }],
  plans: [{ customerId: 5, plannedDate: "2026-06-21", content: "견적서 발송" }],
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

/** 1번 사원의 직속 상급자. */
export function asManager(url: string, options?: RequestOptions) {
  return request(
    url,
    { "x-user-rep-id": "2", "x-user-role": "MANAGER" },
    options,
  );
}

/** 1번 사원과 무관한 영업사원. */
export function asOtherRep(url: string, options?: RequestOptions) {
  return request(
    url,
    { "x-user-rep-id": "3", "x-user-role": "SALES_REP" },
    options,
  );
}

/** 1번 사원의 상급자가 아닌 다른 상급자. */
export function asOtherManager(url: string, options?: RequestOptions) {
  return request(
    url,
    { "x-user-rep-id": "4", "x-user-role": "MANAGER" },
    options,
  );
}

/** 보고는 관리자 담당이 아니다. 403이어야 한다. */
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

export function params(reportId: string) {
  return { params: Promise.resolve({ reportId }) };
}
