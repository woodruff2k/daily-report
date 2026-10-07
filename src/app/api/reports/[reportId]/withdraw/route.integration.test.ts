// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-WDR-01~07 (정상 회수·재저장·재제출 / 타인 403 / 이미 DRAFT 409 /
//          댓글 409 / 소프트 삭제 댓글 409 / 댓글 작성과의 경합 / 404)
// 이슈 #109: 회수의 조건부 UPDATE 직렬화, 댓글 검사와 상태 전환의 원자성
import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { PUT } from "../route";
import { POST as submit } from "../submit/route";
import { POST as postComment } from "../comments/route";
import { prisma } from "@/lib/prisma";
import { withHeldTransaction } from "@/test/integration/held-transaction";
import {
  createComment,
  createCustomer,
  createRep,
  createReport,
  createTeam,
  createVisit,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

const withdraw = (reportId: bigint | number, as?: Actor) =>
  call(POST, "POST", `/api/reports/${reportId}/withdraw`, {
    as,
    params: { reportId },
  });

const submitReport = (reportId: bigint, as: Actor) =>
  call(submit, "POST", `/api/reports/${reportId}/submit`, {
    as,
    params: { reportId },
  });

const putReport = (reportId: bigint, as: Actor, body: unknown) =>
  call(PUT, "PUT", `/api/reports/${reportId}`, {
    as,
    body,
    params: { reportId },
  });

const writeComment = (reportId: bigint, as: Actor, content = "확인 바랍니다") =>
  call(postComment, "POST", `/api/reports/${reportId}/comments`, {
    as,
    body: { content },
    params: { reportId },
  });

const readRow = (reportId: bigint) =>
  prisma.dailyReport.findUniqueOrThrow({ where: { reportId } });

describe("POST /api/reports/{id}/withdraw (실제 DB)", () => {
  it("TC-WDR-01: 본인의 제출된 보고를 회수하면 200, DRAFT, submittedAt 이 null 이 된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId, { status: "SUBMITTED" });
    await createVisit(report.reportId, customer.customerId);

    const result = await withdraw(report.reportId, rep);

    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      reportId: Number(report.reportId),
      status: "DRAFT",
      submittedAt: null,
    });
    const row = await readRow(report.reportId);
    expect(row.status).toBe("DRAFT");
    expect(row.submittedAt).toBeNull();
  });

  it("TC-WDR-01: 회수한 보고는 PUT 으로 저장하고 다시 제출할 수 있다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId, { status: "SUBMITTED" });
    await createVisit(report.reportId, customer.customerId);
    await withdraw(report.reportId, rep);

    const saved = await putReport(report.reportId, rep, {
      visits: [
        {
          customerId: Number(customer.customerId),
          visitType: "VISIT",
          content: "회수 후 수정",
        },
      ],
      problems: [],
      plans: [],
    });
    const resubmitted = await submitReport(report.reportId, rep);

    expect(saved.status).toBe(200);
    expect(resubmitted.status).toBe(200);
    const row = await readRow(report.reportId);
    expect(row.status).toBe("SUBMITTED");
    expect(row.submittedAt).not.toBeNull();
  });

  it("TC-WDR-02: 남의 보고는 회수할 수 없고(403) 상태가 바뀌지 않는다", async () => {
    const owner = await createRep();
    const intruder = await createRep();
    const report = await createReport(owner.repId, { status: "SUBMITTED" });

    const result = await withdraw(report.reportId, intruder);

    expect(result.status).toBe(403);
    const row = await readRow(report.reportId);
    expect(row.status).toBe("SUBMITTED");
    expect(row.submittedAt).not.toBeNull();
  });

  it("TC-WDR-02: 상급자도 팀원 보고를 대신 회수할 수 없다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await withdraw(report.reportId, manager);

    expect(result.status).toBe(403);
    expect((await readRow(report.reportId)).status).toBe("SUBMITTED");
  });

  it("TC-WDR-03: 이미 DRAFT 면 409 REPORT_NOT_SUBMITTED", async () => {
    const rep = await createRep();
    const report = await createReport(rep.repId);

    const result = await withdraw(report.reportId, rep);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_NOT_SUBMITTED");
  });

  it("TC-WDR-03: 같은 보고를 동시에 두 번 회수하면 하나는 200, 하나는 409 이다", async () => {
    const rep = await createRep();
    const report = await createReport(rep.repId, { status: "SUBMITTED" });

    const results = await Promise.all([
      withdraw(report.reportId, rep),
      withdraw(report.reportId, rep),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      "REPORT_NOT_SUBMITTED",
    );
  });

  it("TC-WDR-04: 댓글이 있으면 409 REPORT_HAS_COMMENTS 이고 상태·submittedAt 이 그대로다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    await createComment(report.reportId, manager.repId);
    const before = await readRow(report.reportId);

    const result = await withdraw(report.reportId, member);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_HAS_COMMENTS");
    const after = await readRow(report.reportId);
    expect(after.status).toBe("SUBMITTED");
    expect(after.submittedAt).toEqual(before.submittedAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("TC-WDR-04: 대댓글만 작성자가 단 경우도 댓글이 있는 보고다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    const root = await createComment(report.reportId, manager.repId);
    await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });

    const result = await withdraw(report.reportId, member);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_HAS_COMMENTS");
  });

  it("TC-WDR-05: 소프트 삭제된 댓글만 있어도 409 REPORT_HAS_COMMENTS", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    await createComment(report.reportId, manager.repId, {
      deletedAt: new Date(),
    });

    const result = await withdraw(report.reportId, member);

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_HAS_COMMENTS");
    expect((await readRow(report.reportId)).status).toBe("SUBMITTED");
  });

  it("TC-WDR-06(결정적): 댓글 작성이 보고 행을 잠근 채 커밋 전이면 회수는 기다렸다가 그 댓글을 보고 409 이다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await withHeldTransaction(
      async (tx) => {
        // 댓글 작성(4.2)이 하는 것과 같다: 공유 잠금 → 상태 확인 → INSERT, 아직 미커밋.
        await tx.$queryRaw`SELECT report_id FROM daily_report WHERE report_id = ${report.reportId} FOR SHARE`;
        await tx.reportComment.create({
          data: {
            reportId: report.reportId,
            commenterId: manager.repId,
            content: "미커밋 댓글",
          },
        });
      },
      () => withdraw(report.reportId, member),
    );

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_HAS_COMMENTS");
    expect((await readRow(report.reportId)).status).toBe("SUBMITTED");
  });

  it("TC-WDR-06(결정적): 회수가 먼저 보고 행을 잡았으면 늦게 온 댓글은 DRAFT 를 보고 409 이고 댓글이 생기지 않는다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await withHeldTransaction(
      async (tx) => {
        // 회수가 상태를 DRAFT 로 바꾸고 댓글 0건을 확인한 뒤 아직 커밋하지 않았다.
        await tx.dailyReport.updateMany({
          where: { reportId: report.reportId, status: "SUBMITTED" },
          data: { status: "DRAFT", submittedAt: null },
        });
      },
      () => writeComment(report.reportId, manager),
    );

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_NOT_SUBMITTED");
    expect(
      await prisma.reportComment.count({
        where: { reportId: report.reportId },
      }),
    ).toBe(0);
  });

  it("TC-WDR-06: 회수와 댓글 작성을 동시에 보내도 'DRAFT 인데 댓글이 있는' 상태는 생기지 않는다", async () => {
    for (let i = 0; i < 5; i += 1) {
      const { manager, member } = await createTeam();
      const report = await createReport(member.repId, { status: "SUBMITTED" });

      await Promise.all([
        withdraw(report.reportId, member),
        writeComment(report.reportId, manager),
      ]);

      const row = await readRow(report.reportId);
      const comments = await prisma.reportComment.count({
        where: { reportId: report.reportId },
      });
      expect(row.status === "DRAFT" && comments > 0).toBe(false);
    }
  });

  it("TC-WDR-07: 없는 보고는 404", async () => {
    const rep = await createRep();

    const result = await withdraw(999_999_999, rep);

    expect(result.status).toBe(404);
  });

  it("TC-WDR-07: 인증이 없으면 401", async () => {
    const rep = await createRep();
    const report = await createReport(rep.repId, { status: "SUBMITTED" });

    const result = await withdraw(report.reportId);

    expect(result.status).toBe(401);
    expect((await readRow(report.reportId)).status).toBe("SUBMITTED");
  });
});
