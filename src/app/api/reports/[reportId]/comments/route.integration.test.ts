// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-CMT-01, TC-CMT-02, TC-CMT-03, TC-SEC-04
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import {
  createComment,
  createRep,
  createReport,
  createTeam,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

const post = (reportId: bigint, as: Actor, body: unknown) =>
  call(POST, "POST", `/api/reports/${reportId}/comments`, {
    as,
    body,
    params: { reportId },
  });

describe("POST /api/reports/{id}/comments (실제 DB)", () => {
  it("TC-CMT-01: 직속 상급자가 제출된 보고에 댓글을 쓰면 201 이고 DB 에 저장된다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await post(report.reportId, manager, {
      content: "수고했습니다",
    });

    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({
      content: "수고했습니다",
      parentCommentId: null,
      commenter: { repId: Number(manager.repId), name: manager.name },
    });
    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: BigInt(result.body.data.commentId) },
    });
    expect(row).toMatchObject({
      reportId: report.reportId,
      commenterId: manager.repId,
      parentCommentId: null,
    });
  });

  it("TC-CMT-01: 작성자는 본문이 아니라 인증 컨텍스트로 정해진다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await post(report.reportId, manager, {
      content: "본문의 commenterId 는 무시된다",
      commenterId: Number(member.repId),
    });

    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: BigInt(result.body.data.commentId) },
    });
    expect(row.commenterId).toBe(manager.repId);
  });

  it("작성중 보고에는 409 REPORT_NOT_SUBMITTED 이고 댓글이 생기지 않는다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId);

    const result = await post(report.reportId, manager, {
      content: "초안에는 안 된다",
    });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_NOT_SUBMITTED");
    expect(await prisma.reportComment.count()).toBe(0);
  });

  it("TC-SEC-04: 다른 팀 상급자의 댓글은 403 이고 저장되지 않는다", async () => {
    const { member } = await createTeam();
    const { manager: otherManager } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await post(report.reportId, otherManager, {
      content: "남의 팀",
    });

    expect(result.status).toBe(403);
    expect(await prisma.reportComment.count()).toBe(0);
  });

  it("TC-SEC-04: 상급자가 아닌 동료 영업사원의 댓글은 403 이다", async () => {
    const { member } = await createTeam();
    const peer = await createRep();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await post(report.reportId, peer, { content: "동료" });

    expect(result.status).toBe(403);
    expect(await prisma.reportComment.count()).toBe(0);
  });

  it("TC-SEC-04: 작성자 본인은 루트 댓글을 쓸 수 없다(403)", async () => {
    const { member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await post(report.reportId, member, {
      content: "셀프 댓글",
    });

    expect(result.status).toBe(403);
  });

  it("TC-SEC-04: ADMIN 은 댓글을 쓸 수 없다(403)", async () => {
    const { member } = await createTeam();
    const admin = await createRep({ role: "ADMIN" });
    const report = await createReport(member.repId, { status: "SUBMITTED" });

    const result = await post(report.reportId, admin, { content: "관리자" });

    expect(result.status).toBe(403);
  });

  it("TC-CMT-02: 작성자 본인은 상급자 댓글에 대댓글을 쓸 수 있고 스레드가 연결된다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    const root = await createComment(report.reportId, manager.repId);

    const result = await post(report.reportId, member, {
      content: "확인했습니다",
      parentCommentId: Number(root.commentId),
    });

    expect(result.status).toBe(201);
    expect(result.body.data.parentCommentId).toBe(Number(root.commentId));
  });

  it("다른 보고의 댓글을 부모로 지정하면 400 PARENT_NOT_IN_REPORT 이다 (IDOR)", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, {
      status: "SUBMITTED",
      reportDate: "2026-07-01",
    });
    const otherReport = await createReport(member.repId, {
      status: "SUBMITTED",
      reportDate: "2026-07-02",
    });
    const foreign = await createComment(otherReport.reportId, manager.repId);

    const result = await post(report.reportId, manager, {
      content: "엉뚱한 스레드",
      parentCommentId: Number(foreign.commentId),
    });

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("PARENT_NOT_IN_REPORT");
  });

  it("대댓글에 다시 답글을 달면 400 PARENT_IS_REPLY 이다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    const root = await createComment(report.reportId, manager.repId);
    const reply = await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });

    const result = await post(report.reportId, manager, {
      content: "2단계",
      parentCommentId: Number(reply.commentId),
    });

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("PARENT_IS_REPLY");
  });
});

describe("GET /api/reports/{id}/comments (실제 DB)", () => {
  it("TC-CMT-03: 루트 댓글 아래에 대댓글이 계층으로, 작성순으로 반환된다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    const first = await createComment(report.reportId, manager.repId, {
      content: "루트1",
    });
    const second = await createComment(report.reportId, manager.repId, {
      content: "루트2",
    });
    await createComment(report.reportId, member.repId, {
      parentCommentId: first.commentId,
      content: "답글1-1",
    });
    await createComment(report.reportId, manager.repId, {
      parentCommentId: first.commentId,
      content: "답글1-2",
    });

    const result = await call(
      GET,
      "GET",
      `/api/reports/${report.reportId}/comments`,
      {
        as: member,
        params: { reportId: report.reportId },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.data.map((c: { content: string }) => c.content)).toEqual(
      ["루트1", "루트2"],
    );
    expect(
      result.body.data[0].replies.map((c: { content: string }) => c.content),
    ).toEqual(["답글1-1", "답글1-2"]);
    expect(result.body.data[1].replies).toEqual([]);
    expect(second.commentId).toBeGreaterThan(first.commentId);
  });

  it("TC-SEC-06: 댓글 응답에 작성자 이메일·사번이 실리지 않는다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    await createComment(report.reportId, manager.repId);

    const result = await call(
      GET,
      "GET",
      `/api/reports/${report.reportId}/comments`,
      {
        as: member,
        params: { reportId: report.reportId },
      },
    );

    expect(result.raw).toContain(manager.name);
    expect(result.raw).not.toContain(manager.email);
    expect(result.raw).not.toContain(manager.empNo);
  });

  it("남의 보고의 댓글 목록은 403 이다 (IDOR)", async () => {
    const { manager, member } = await createTeam();
    const intruder = await createRep();
    const report = await createReport(member.repId, { status: "SUBMITTED" });
    await createComment(report.reportId, manager.repId);

    const result = await call(
      GET,
      "GET",
      `/api/reports/${report.reportId}/comments`,
      {
        as: intruder,
        params: { reportId: report.reportId },
      },
    );

    expect(result.status).toBe(403);
  });
});
