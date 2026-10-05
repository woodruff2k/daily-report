// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-SUB-01, TC-SUB-02, TC-SEC-01(타인 보고 제출 차단)
// 이슈 #7: 제출 중복 호출의 직렬화, 방문 0건 제출 시 상태 롤백
import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/prisma";
import {
  createCustomer,
  createRep,
  createReport,
  createTeam,
  createVisit,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

const submit = (reportId: bigint, as: Actor) =>
  call(POST, "POST", `/api/reports/${reportId}/submit`, {
    as,
    params: { reportId },
  });

describe("POST /api/reports/{id}/submit (실제 DB)", () => {
  it("TC-SUB-01: 방문 1건 이상의 DRAFT 를 제출하면 200, SUBMITTED, submittedAt 이 기록된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId);

    const result = await submit(report.reportId, rep);

    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("SUBMITTED");
    const row = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: report.reportId },
    });
    expect(row.status).toBe("SUBMITTED");
    expect(row.submittedAt).not.toBeNull();
    expect(row.submittedAt!.toISOString()).toBe(result.body.data.submittedAt);
  });

  it("TC-SUB-02: 방문 0건이면 400 VISITS_REQUIRED 이고 상태가 DRAFT 로 롤백된다", async () => {
    const rep = await createRep();
    const report = await createReport(rep.repId);

    const result = await submit(report.reportId, rep);

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("VISITS_REQUIRED");
    const row = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: report.reportId },
    });
    expect(row.status).toBe("DRAFT");
    expect(row.submittedAt).toBeNull();
  });

  it("이미 제출된 보고의 재제출은 409 REPORT_ALREADY_SUBMITTED 이다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId, { status: "SUBMITTED" });
    await createVisit(report.reportId, customer.customerId);

    const result = await submit(report.reportId, rep);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_ALREADY_SUBMITTED");
  });

  it("이슈 #7: 같은 보고를 동시에 두 번 제출하면 하나는 200, 하나는 409 이다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId);

    const results = await Promise.all([
      submit(report.reportId, rep),
      submit(report.reportId, rep),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      "REPORT_ALREADY_SUBMITTED",
    );
  });

  it("TC-SEC-01: 남의 보고는 제출할 수 없고(403) 상태가 바뀌지 않는다", async () => {
    const owner = await createRep();
    const intruder = await createRep();
    const customer = await createCustomer(owner.repId);
    const report = await createReport(owner.repId);
    await createVisit(report.reportId, customer.customerId);

    const result = await submit(report.reportId, intruder);

    expect(result.status).toBe(403);
    const row = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: report.reportId },
    });
    expect(row.status).toBe("DRAFT");
  });

  it("상급자도 팀원 보고를 대신 제출할 수 없다", async () => {
    const { manager, member } = await createTeam();
    const customer = await createCustomer(member.repId);
    const report = await createReport(member.repId);
    await createVisit(report.reportId, customer.customerId);

    const result = await submit(report.reportId, manager);

    expect(result.status).toBe(403);
  });
});
