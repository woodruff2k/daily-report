// 통합 테스트(실제 PostgreSQL). `visits: { some }` 와 `_count` 가 실제 SQL 에서 맞는지 본다.
// 덮는 TC: TC-SEC-02, TC-RPT-03/04(팀 목록 필터), TC-SEC-06(응답에 사원 이메일·사번 미포함)
// 이슈 #8: 고객 필터, visitCount·commentCount
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import {
  createComment,
  createCustomer,
  createRep,
  createReport,
  createTeam,
  createVisit,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

const team = (as: Actor, query: Record<string, string> = {}) =>
  call(GET, "GET", "/api/reports/team", { as, query });

const ids = (result: { body: { data: { content: { reportId: number }[] } } }) =>
  result.body.data.content.map((r) => r.reportId).sort();

describe("GET /api/reports/team (실제 DB)", () => {
  it("직속 팀원의 보고만 돌려주고 다른 팀·본인 보고는 제외한다", async () => {
    const { manager, member } = await createTeam();
    const { member: otherMember } = await createTeam();
    const mine = await createReport(member.repId);
    await createReport(otherMember.repId);
    await createReport(manager.repId);

    const result = await team(manager);

    expect(result.status).toBe(200);
    expect(ids(result)).toEqual([Number(mine.reportId)]);
  });

  it("TC-SEC-02: 비소속 사원을 repIds 로 지정하면 403 이다", async () => {
    const { manager } = await createTeam();
    const { member: outsider } = await createTeam();
    await createReport(outsider.repId);

    const result = await team(manager, { repIds: String(outsider.repId) });

    expect(result.status).toBe(403);
    expect(result.body.data).toBeNull();
  });

  it("TC-SEC-02: 소속·비소속을 섞으면 비소속이 하나라도 있는 한 403 이다", async () => {
    const { manager, member } = await createTeam();
    const outsider = await createRep();

    const result = await team(manager, {
      repIds: `${member.repId},${outsider.repId}`,
    });

    expect(result.status).toBe(403);
  });

  it("손자 팀원(상급자의 상급자)의 보고는 포함되지 않는다", async () => {
    const { manager, member } = await createTeam();
    const grandchild = await createRep({ managerId: member.repId });
    await createReport(grandchild.repId);

    const result = await team(manager);

    expect(result.body.data.content).toEqual([]);
  });

  it.each(["SALES_REP", "ADMIN"] as const)(
    "%s 는 팀 조회가 403 이다",
    async (role) => {
      const caller = await createRep({ role });

      const result = await team(caller);

      expect(result.status).toBe(403);
    },
  );

  it("customerId 필터는 그 고객을 방문한 보고만 돌려준다 (visits some)", async () => {
    const { manager, member } = await createTeam();
    const target = await createCustomer(member.repId);
    const another = await createCustomer(member.repId);
    const visited = await createReport(member.repId, {
      reportDate: "2026-07-01",
    });
    await createVisit(visited.reportId, target.customerId);
    await createVisit(visited.reportId, another.customerId);
    const visitedOnlyOther = await createReport(member.repId, {
      reportDate: "2026-07-02",
    });
    await createVisit(visitedOnlyOther.reportId, another.customerId);
    await createReport(member.repId, { reportDate: "2026-07-03" });

    const result = await team(manager, {
      customerId: String(target.customerId),
    });

    expect(ids(result)).toEqual([Number(visited.reportId)]);
    expect(result.body.data.totalElements).toBe(1);
  });

  it("customerId 필터는 과제·계획에만 걸린 고객은 보지 않는다", async () => {
    const { manager, member } = await createTeam();
    const customer = await createCustomer(member.repId);
    const report = await createReport(member.repId);
    const { prisma } = await import("@/lib/prisma");
    await prisma.reportProblem.create({
      data: {
        reportId: report.reportId,
        customerId: customer.customerId,
        content: "테스트 과제",
      },
    });

    const result = await team(manager, {
      customerId: String(customer.customerId),
    });

    expect(result.body.data.content).toEqual([]);
  });

  it("visitCount·commentCount 는 조인 중복 없이 실제 행 수와 같다", async () => {
    const { manager, member } = await createTeam();
    const customer = await createCustomer(member.repId);
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    for (let i = 0; i < 3; i += 1) {
      await createVisit(report.reportId, customer.customerId, { sortOrder: i });
    }
    const root = await createComment(report.reportId, manager.repId);
    await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });

    // customerId 필터(조인)가 걸려도 숫자가 부풀지 않아야 한다.
    const result = await team(manager, {
      customerId: String(customer.customerId),
    });

    expect(result.body.data.content).toEqual([
      expect.objectContaining({
        reportId: Number(report.reportId),
        visitCount: 3,
        commentCount: 2,
        rep: { repId: Number(member.repId), name: member.name },
      }),
    ]);
  });

  it("status·기간 필터가 SQL 에서 적용된다", async () => {
    const { manager, member } = await createTeam();
    await createReport(member.repId, {
      reportDate: "2026-06-30",
      status: "SUBMITTED",
    });
    const hit = await createReport(member.repId, {
      reportDate: "2026-07-01",
      status: "SUBMITTED",
    });
    await createReport(member.repId, { reportDate: "2026-07-02" });

    const result = await team(manager, {
      status: "SUBMITTED",
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
    });

    expect(ids(result)).toEqual([Number(hit.reportId)]);
  });

  it("TC-SEC-06: 응답에 팀원 이메일·사번이 실리지 않는다", async () => {
    const { manager, member } = await createTeam();
    await createReport(member.repId);

    const result = await team(manager);

    expect(result.raw).toContain(member.name);
    expect(result.raw).not.toContain(member.email);
    expect(result.raw).not.toContain(member.empNo);
  });

  it("팀원이 없는 상급자는 빈 페이지 200 이다", async () => {
    const manager = await createRep({ role: "MANAGER" });

    const result = await team(manager);

    expect(result.status).toBe(200);
    expect(result.body.data.totalElements).toBe(0);
  });
});
