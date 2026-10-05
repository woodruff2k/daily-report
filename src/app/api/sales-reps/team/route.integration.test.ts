// 통합 테스트(실제 PostgreSQL). 팀원 Select 옵션(API 명세 6.7).
// 덮는 항목: 직속만(다른 상급자·손자 제외), INACTIVE 포함, 빈 배열 200,
// SALES_REP·ADMIN 403, 401, 최소 필드(NFR-04), repId 숫자, name asc,
// 3.6 팀 보고 조회 범위와의 일치.
//
// 덮는 TC: **6.7 은 테스트 명세서에 전용 TC 가 없다** — 이번에 추가한 절이다.
// 범위 판정(직속 팀원)이 **TC-SEC-02**(팀 범위 밖 조회 차단, NFR-01/3.6)와
// 같은 규칙이므로 그것을 참조로 적는다. 명세서에 절이 생기면 번호를 붙인다.
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { GET as GET_TEAM_REPORTS } from "../../reports/team/route";
import { prisma } from "@/lib/prisma";
import { createRep } from "@/test/integration/factories";
import { call } from "@/test/integration/http";

const PATH = "/api/sales-reps/team";

describe("GET /api/sales-reps/team (실제 DB)", () => {
  it("직속 팀원만 온다 — 다른 상급자의 팀원과 손자는 오지 않는다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    const otherManager = await createRep({ role: "MANAGER" });
    const mine = await createRep({ managerId: manager.repId });
    await createRep({ managerId: otherManager.repId });
    const midManager = await createRep({
      role: "MANAGER",
      managerId: manager.repId,
    });
    await createRep({ managerId: midManager.repId }); // 손자

    const result = await call(GET, "GET", PATH, { as: manager });

    expect(result.status).toBe(200);
    const ids = result.body.data.map((o: { repId: number }) => o.repId).sort();
    expect(ids).toEqual([Number(mine.repId), Number(midManager.repId)].sort());
  });

  it("비활성 팀원도 status 와 함께 온다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    const inactive = await createRep({
      managerId: manager.repId,
      status: "INACTIVE",
    });

    const result = await call(GET, "GET", PATH, { as: manager });

    expect(result.body.data).toEqual([
      {
        repId: Number(inactive.repId),
        name: inactive.name,
        status: "INACTIVE",
      },
    ]);
  });

  it("팀원이 없으면 빈 배열 200 이다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    await createRep(); // 상급자 없는 사원

    const result = await call(GET, "GET", PATH, { as: manager });

    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([]);
  });

  it.each(["SALES_REP", "ADMIN"] as const)("%s 는 403 이다", async (role) => {
    const caller = await createRep({ role });

    expect((await call(GET, "GET", PATH, { as: caller })).status).toBe(403);
  });

  it("인증 헤더가 없으면 401 이다", async () => {
    expect((await call(GET, "GET", PATH)).status).toBe(401);
  });

  it("이름 오름차순이고 repId 는 숫자다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    await createRep({ managerId: manager.repId, name: "테스트정렬다" });
    await createRep({ managerId: manager.repId, name: "테스트정렬가" });
    await createRep({ managerId: manager.repId, name: "테스트정렬나" });

    const result = await call(GET, "GET", PATH, { as: manager });

    expect(result.body.data.map((o: { name: string }) => o.name)).toEqual([
      "테스트정렬가",
      "테스트정렬나",
      "테스트정렬다",
    ]);
    for (const option of result.body.data) {
      expect(typeof option.repId).toBe("number");
    }
  });

  it("항목은 repId·name·status 뿐이고 이메일·사번·부서가 없다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    const member = await createRep({
      managerId: manager.repId,
      email: "test-leak@example.com",
      empNo: "T9999",
    });
    await prisma.salesRep.update({
      where: { repId: member.repId },
      data: { department: "테스트유출부서", position: "테스트유출직급" },
    });

    const result = await call(GET, "GET", PATH, { as: manager });

    expect(result.raw).not.toContain("test-leak@example.com");
    expect(result.raw).not.toContain("T9999");
    expect(result.raw).not.toContain("테스트유출부서");
    expect(result.raw).not.toContain("테스트유출직급");
    expect(result.raw).not.toContain("$2");
    for (const option of result.body.data) {
      expect(Object.keys(option).sort()).toEqual(["name", "repId", "status"]);
    }
  });

  it("목록의 모든 팀원을 3.6 팀 보고 조회에 repIds 로 넘기면 403 이 아니다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    await createRep({ managerId: manager.repId });
    await createRep({ managerId: manager.repId, status: "INACTIVE" });

    const options = await call(GET, "GET", PATH, { as: manager });
    const ids = options.body.data.map((o: { repId: number }) => o.repId);

    const reports = await call(GET_TEAM_REPORTS, "GET", "/api/reports/team", {
      as: manager,
      query: { repIds: ids.join(",") },
    });

    expect(ids).toHaveLength(2);
    expect(reports.status).toBe(200);
  });
});
