// 영업 Select 옵션(API 명세 6.6). 덮는 항목: 역할 무관 200, 401, ACTIVE 만, name asc,
// 최소 필드(NFR-04, TC-SEC-06 계열). 6.1 의 ADMIN 전용은 route.test.ts 가 지킨다.
import { NextRequest } from "next/server";
import { bearerHeaders } from "@/test/auth-headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER_REP,
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

const URL = "http://localhost/api/sales-reps/options";

function asManager() {
  return new NextRequest(URL, {
    headers: bearerHeaders(2, "MANAGER"),
  });
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.findMany)
    .mockReset()
    .mockResolvedValue([MANAGER_REP, REP]);
});

describe("GET /api/sales-reps/options", () => {
  it.each([
    ["SALES_REP", () => asSalesRep(URL)],
    ["MANAGER", asManager],
    ["ADMIN", () => asAdmin(URL)],
  ])("%s 도 200 이다", async (_role, make) => {
    const response = await GET(make());

    expect(response.status).toBe(200);
    expect((await readBody(response)).success).toBe(true);
  });

  it("인증 헤더가 없으면 401 이고 조회하지 않는다", async () => {
    const response = await GET(withoutAuth(URL));

    expect(response.status).toBe(401);
    expect(prisma.salesRep.findMany).not.toHaveBeenCalled();
  });

  it("repId·name 만 담은 배열을 돌려준다", async () => {
    const body = await readBody(await GET(asSalesRep(URL)));

    expect(body.data).toEqual([
      { repId: 2, name: "김부장" },
      { repId: 1, name: "홍길동" },
    ]);
  });

  it("ACTIVE 사원만 조회한다", async () => {
    await GET(asSalesRep(URL));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE" } }),
    );
  });

  it("이름 오름차순으로 조회한다", async () => {
    await GET(asSalesRep(URL));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: "asc" }, { repId: "asc" }],
      }),
    );
  });

  it("쿼리도 repId·name 만 읽는다", async () => {
    await GET(asSalesRep(URL));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { repId: true, name: true } }),
    );
  });

  it("페이지네이션 파라미터를 받지 않는다", async () => {
    await GET(asSalesRep(`${URL}?page=3&size=1`));

    const args = vi.mocked(prisma.salesRep.findMany).mock.calls[0][0];
    expect(args).not.toHaveProperty("skip");
    expect(args).not.toHaveProperty("take");
  });

  it("응답에 이메일·사번·부서·역할·해시가 없다 (NFR-04)", async () => {
    // 목이 전체 레코드를 돌려줘도 변환 함수가 걸러야 한다.
    const body = await readBody(await GET(asSalesRep(URL)));
    const raw = JSON.stringify(body);

    for (const leaked of [
      REP.email,
      REP.empNo,
      REP.department,
      REP.passwordHash,
      "email",
      "empNo",
      "department",
      "role",
      "status",
    ]) {
      expect(raw).not.toContain(leaked as string);
    }
  });

  it("조회 실패는 목록 내용 없이 500 INTERNAL_ERROR 로 응답한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.salesRep.findMany).mockRejectedValue(
      new Error("connection refused"),
    );

    const response = await GET(asSalesRep(URL));
    const body = (await response.json()) as {
      success: boolean;
      data: unknown;
      error: { code: string };
    };

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      success: false,
      data: null,
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
