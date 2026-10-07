// 팀원 Select 옵션(API 명세 6.7). 덮는 항목: MANAGER 만 200, SALES_REP·ADMIN 403,
// 401, 직속 조건(managerId), status 필터 없음, 빈 배열 200, repId 숫자, name asc,
// 최소 필드(NFR-04). 실제 DB 의 직속 범위는 route.integration.test.ts 가 지킨다.
//
// 덮는 TC: **6.7 은 테스트 명세서에 전용 TC 가 없다** — 이번에 추가한 절이다.
// 범위 판정(직속 팀원)이 **TC-SEC-02**(팀 범위 밖 조회 차단, NFR-01/3.7)와
// 같은 규칙이므로 그것을 참조로 적는다. 명세서에 절이 생기면 번호를 붙인다.
import { NextRequest } from "next/server";
import { bearerHeaders } from "@/test/auth-headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REP,
  asAdmin,
  asSalesRep,
  readBody,
  withoutAuth,
} from "@/test/sales-rep-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const URL = "http://localhost/api/sales-reps/team";

function asManager() {
  return new NextRequest(URL, {
    headers: bearerHeaders(2, "MANAGER"),
  });
}

const INACTIVE_MEMBER = {
  ...REP,
  repId: 3n,
  name: "이퇴사",
  status: "INACTIVE" as const,
};

beforeEach(() => {
  vi.mocked(prisma.salesRep.findMany)
    .mockReset()
    .mockResolvedValue([REP, INACTIVE_MEMBER]);
});

describe("GET /api/sales-reps/team", () => {
  it("MANAGER 는 200 이고 repId 가 숫자인 팀원을 받는다", async () => {
    const response = await GET(asManager());
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { repId: 1, name: "홍길동", status: "ACTIVE" },
      { repId: 3, name: "이퇴사", status: "INACTIVE" },
    ]);
    expect(typeof (body.data as { repId: unknown }[])[0].repId).toBe("number");
  });

  it.each([
    ["SALES_REP", () => asSalesRep(URL)],
    ["ADMIN", () => asAdmin(URL)],
  ])("%s 는 403 이고 조회하지 않는다", async (_role, make) => {
    const response = await GET(make());

    expect(response.status).toBe(403);
    expect(prisma.salesRep.findMany).not.toHaveBeenCalled();
  });

  it("인증 헤더가 없으면 401 이고 조회하지 않는다", async () => {
    const response = await GET(withoutAuth(URL));

    expect(response.status).toBe(401);
    expect(prisma.salesRep.findMany).not.toHaveBeenCalled();
  });

  it("호출자의 직속(managerId)만, status 필터 없이 조회한다", async () => {
    await GET(asManager());

    const args = vi.mocked(prisma.salesRep.findMany).mock.calls[0][0];
    expect(args?.where).toEqual({ managerId: 2n });
  });

  it("이름 오름차순으로, repId·name·status 만 읽는다", async () => {
    await GET(asManager());

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // 동명이인이 있으면 이름만으로는 순서가 안 정해진다 (#95 검토).
        orderBy: [{ name: "asc" }, { repId: "asc" }],
        select: { repId: true, name: true, status: true },
      }),
    );
  });

  it("팀원이 없으면 빈 배열 200 이다", async () => {
    vi.mocked(prisma.salesRep.findMany).mockResolvedValue([]);

    const response = await GET(asManager());

    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toEqual([]);
  });

  it("페이지네이션 파라미터를 받지 않는다", async () => {
    await GET(
      new NextRequest(`${URL}?page=3&size=1`, {
        headers: bearerHeaders(2, "MANAGER"),
      }),
    );

    const args = vi.mocked(prisma.salesRep.findMany).mock.calls[0][0];
    expect(args).not.toHaveProperty("skip");
    expect(args).not.toHaveProperty("take");
  });

  it("응답에 이메일·사번·부서·직급·해시가 없다 (NFR-04)", async () => {
    // 목이 전체 레코드를 돌려줘도 변환 함수가 걸러야 한다.
    const raw = JSON.stringify(await readBody(await GET(asManager())));

    for (const leaked of [
      REP.email,
      REP.empNo,
      REP.department,
      REP.position,
      REP.passwordHash,
      "email",
      "empNo",
      "department",
      "position",
    ]) {
      expect(raw).not.toContain(leaked as string);
    }
  });

  it("조회 실패는 500 INTERNAL_ERROR 로 응답한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.salesRep.findMany).mockRejectedValue(
      new Error("connection refused"),
    );

    const response = await GET(asManager());
    const body = await readBody(response);

    expect(response.status).toBe(500);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
  });
});
