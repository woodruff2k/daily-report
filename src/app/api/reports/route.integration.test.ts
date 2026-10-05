// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-RPT-01, TC-RPT-02(순차·동시), TC-NFR-02(DB 유니크 제약), TC-NFR-01(이력 기록),
//          TC-RPT-03/04(목록과 _count)
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import {
  createComment,
  createCustomer,
  createRep,
  createReport,
  createVisit,
} from "@/test/integration/factories";
import { call } from "@/test/integration/http";

describe("POST /api/reports (실제 DB)", () => {
  it("TC-RPT-01: 보고를 생성하면 201 이고 DB 에 DRAFT 로 저장된다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/reports", {
      as: rep,
      body: { reportDate: "2026-07-01" },
    });

    expect(result.status).toBe(201);
    expect(result.body.data.status).toBe("DRAFT");
    const row = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: BigInt(result.body.data.reportId) },
    });
    expect(row.repId).toBe(rep.repId);
    expect(row.status).toBe("DRAFT");
    expect(row.reportDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("TC-NFR-01: 작성자는 본문이 아니라 인증 컨텍스트로 정해지고 생성·수정 일시가 기록된다", async () => {
    const rep = await createRep();
    const other = await createRep();

    const result = await call(POST, "POST", "/api/reports", {
      as: rep,
      body: { reportDate: "2026-07-01", repId: Number(other.repId) },
    });

    const row = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: BigInt(result.body.data.reportId) },
    });
    expect(row.repId).toBe(rep.repId);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("TC-RPT-02: 같은 일자 보고가 있으면 409 REPORT_ALREADY_EXISTS 이고 행이 늘지 않는다", async () => {
    const rep = await createRep();
    await createReport(rep.repId, { reportDate: "2026-07-01" });

    const result = await call(POST, "POST", "/api/reports", {
      as: rep,
      body: { reportDate: "2026-07-01" },
    });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_ALREADY_EXISTS");
    expect(await prisma.dailyReport.count()).toBe(1);
  });

  it("다른 사원은 같은 일자에 보고를 만들 수 있다", async () => {
    const a = await createRep();
    const b = await createRep();
    await createReport(a.repId, { reportDate: "2026-07-01" });

    const result = await call(POST, "POST", "/api/reports", {
      as: b,
      body: { reportDate: "2026-07-01" },
    });

    expect(result.status).toBe(201);
  });

  it("TC-RPT-02, TC-NFR-02: 같은 (사원, 일자) 를 동시에 생성하면 하나는 201, 하나는 409 이고 행은 1건이다", async () => {
    const rep = await createRep();
    const create = () =>
      call(POST, "POST", "/api/reports", {
        as: rep,
        body: { reportDate: "2026-07-01" },
      });

    const results = await Promise.all([create(), create()]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.body.error.code).toBe("REPORT_ALREADY_EXISTS");
    expect(
      await prisma.dailyReport.count({ where: { repId: rep.repId } }),
    ).toBe(1);
  });

  it("TC-NFR-02: DB 유니크 제약이 같은 (repId, reportDate) 삽입을 막는다", async () => {
    const rep = await createRep();
    await createReport(rep.repId, { reportDate: "2026-07-01" });

    await expect(
      createReport(rep.repId, { reportDate: "2026-07-01" }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("GET /api/reports (실제 DB)", () => {
  it("TC-RPT-03: 본인 보고만, 기간 안에서, visitCount·commentCount 가 실제 행 수와 같게 돌려준다", async () => {
    const manager = await createRep({ role: "MANAGER" });
    const rep = await createRep({ managerId: manager.repId });
    const other = await createRep();
    const customer = await createCustomer(rep.repId);
    const inRange = await createReport(rep.repId, {
      reportDate: "2026-07-02",
      status: "SUBMITTED",
    });
    await createVisit(inRange.reportId, customer.customerId);
    await createVisit(inRange.reportId, customer.customerId);
    await createVisit(inRange.reportId, customer.customerId);
    const root = await createComment(inRange.reportId, manager.repId);
    await createComment(inRange.reportId, rep.repId, {
      parentCommentId: root.commentId,
    });
    await createReport(rep.repId, { reportDate: "2026-06-01" });
    await createReport(other.repId, { reportDate: "2026-07-02" });

    const result = await call(GET, "GET", "/api/reports", {
      as: rep,
      query: { fromDate: "2026-07-01", toDate: "2026-07-31" },
    });

    expect(result.status).toBe(200);
    expect(result.body.data.totalElements).toBe(1);
    expect(result.body.data.content).toEqual([
      expect.objectContaining({
        reportId: Number(inRange.reportId),
        reportDate: "2026-07-02",
        status: "SUBMITTED",
        visitCount: 3,
        commentCount: 2,
      }),
    ]);
  });

  it("TC-RPT-04: status=SUBMITTED 필터는 제출 보고만 돌려준다", async () => {
    const rep = await createRep();
    await createReport(rep.repId, { reportDate: "2026-07-01" });
    const submitted = await createReport(rep.repId, {
      reportDate: "2026-07-02",
      status: "SUBMITTED",
    });

    const result = await call(GET, "GET", "/api/reports", {
      as: rep,
      query: { status: "SUBMITTED" },
    });

    expect(
      result.body.data.content.map((r: { reportId: number }) => r.reportId),
    ).toEqual([Number(submitted.reportId)]);
  });
});
