// 통합 테스트(실제 PostgreSQL). 행 잠금(FOR UPDATE/FOR SHARE)은 목으로 확인할 수 없다.
// 덮는 TC: TC-CMT-04, TC-CMT-05, TC-SEC-01(다른 보고 경로로 댓글 조작 차단)
// 이슈 #9: 댓글 삭제와 대댓글 작성의 직렬화
// 이슈 #71: 소프트 삭제. TC-CMT-06~10
import { describe, expect, it } from "vitest";
import { DELETE, PUT } from "./route";
import { GET as listComments, POST as postComment } from "../route";
import { prisma } from "@/lib/prisma";
import { withHeldTransaction } from "@/test/integration/held-transaction";
import {
  createComment,
  createRep,
  createReport,
  createTeam,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

type As = Actor;

const put = (reportId: bigint, commentId: bigint, as: As, content = "수정") =>
  call(PUT, "PUT", `/api/reports/${reportId}/comments/${commentId}`, {
    as,
    body: { content },
    params: { reportId, commentId },
  });

const del = (reportId: bigint, commentId: bigint, as: As) =>
  call(DELETE, "DELETE", `/api/reports/${reportId}/comments/${commentId}`, {
    as,
    params: { reportId, commentId },
  });

const reply = (reportId: bigint, parentCommentId: bigint, as: As) =>
  call(postComment, "POST", `/api/reports/${reportId}/comments`, {
    as,
    body: { content: "답글", parentCommentId: Number(parentCommentId) },
    params: { reportId },
  });

const list = (reportId: bigint, as: As) =>
  call(listComments, "GET", `/api/reports/${reportId}/comments`, {
    as,
    params: { reportId },
  });

async function setup() {
  const { manager, member } = await createTeam();
  const report = await createReport(member.repId, { status: "SUBMITTED" });
  const root = await createComment(report.reportId, manager.repId, {
    content: "원본",
  });
  return { manager, member, report, root };
}

describe("PUT /api/reports/{id}/comments/{commentId} (실제 DB)", () => {
  it("본인 댓글은 수정되고 DB 에 반영된다", async () => {
    const { manager, report, root } = await setup();

    const result = await put(report.reportId, root.commentId, manager, "고침");

    expect(result.status).toBe(200);
    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: root.commentId },
    });
    expect(row.content).toBe("고침");
  });

  it("TC-CMT-04: 타인(보고 작성자)이 상급자의 댓글을 수정하면 403 이고 내용이 그대로다", async () => {
    const { member, report, root } = await setup();

    const result = await put(
      report.reportId,
      root.commentId,
      member,
      "가로채기",
    );

    expect(result.status).toBe(403);
    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: root.commentId },
    });
    expect(row.content).toBe("원본");
  });

  it("TC-CMT-04: 같은 팀 상급자라도 타인 댓글은 수정할 수 없다", async () => {
    const { manager, member, report } = await setup();
    const memberReply = await createComment(report.reportId, member.repId, {
      parentCommentId: (await prisma.reportComment.findFirstOrThrow())
        .commentId,
      content: "팀원 답글",
    });

    const result = await put(report.reportId, memberReply.commentId, manager);

    expect(result.status).toBe(403);
  });

  it("TC-SEC-01: 열람 권한 없는 사용자가 댓글 식별자를 두드려도 403 만 받는다", async () => {
    const { report, root } = await setup();
    const intruder = await createRep();

    const result = await put(report.reportId, root.commentId, intruder);

    expect(result.status).toBe(403);
  });

  it("TC-SEC-01: 다른 보고의 댓글을 내 보고 경로로 수정하려 하면 404 이다", async () => {
    const { manager, member, root } = await setup();
    const otherReport = await createReport(member.repId, {
      status: "SUBMITTED",
      reportDate: "2026-07-02",
    });

    const result = await put(otherReport.reportId, root.commentId, manager);

    expect(result.status).toBe(404);
    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: root.commentId },
    });
    expect(row.content).toBe("원본");
  });
});

describe("DELETE /api/reports/{id}/comments/{commentId} (실제 DB)", () => {
  it("TC-CMT-05: 본인 댓글을 삭제하면 204 이고 DB 에서 사라진다", async () => {
    const { manager, report, root } = await setup();

    const result = await del(report.reportId, root.commentId, manager);

    expect(result.status).toBe(204);
    expect(await prisma.reportComment.count()).toBe(0);
  });

  it("타인 댓글 삭제는 403 이고 남아 있다", async () => {
    const { member, report, root } = await setup();

    const result = await del(report.reportId, root.commentId, member);

    expect(result.status).toBe(403);
    expect(await prisma.reportComment.count()).toBe(1);
  });

  it("TC-CMT-06: 대댓글이 없는 댓글은 물리 삭제된다 (흔적을 남기지 않는다)", async () => {
    const { manager, report, root } = await setup();

    expect((await del(report.reportId, root.commentId, manager)).status).toBe(
      204,
    );

    expect(
      await prisma.reportComment.findUnique({
        where: { commentId: root.commentId },
      }),
    ).toBeNull();
  });

  it("TC-CMT-07: 대댓글이 달린 댓글은 204 이고 행이 남으며 deletedAt 이 찍히고 대댓글은 루트로 승격되지 않는다", async () => {
    const { manager, member, report, root } = await setup();
    const child = await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });

    const result = await del(report.reportId, root.commentId, manager);

    expect(result.status).toBe(204);
    const parentRow = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: root.commentId },
    });
    expect(parentRow.deletedAt).toBeInstanceOf(Date);
    const childRow = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: child.commentId },
    });
    expect(childRow.parentCommentId).toBe(root.commentId);
    expect(childRow.deletedAt).toBeNull();
  });

  it("TC-CMT-07: 이슈 #71 의 교착이 풀린다 — 상급자 댓글 → 작성자 대댓글 → 상급자가 자기 댓글 삭제", async () => {
    const { manager, member, report } = await setup();
    const posted = await call(
      postComment,
      "POST",
      `/api/reports/${report.reportId}/comments`,
      {
        as: manager,
        body: { content: "일정 확인 바람", parentCommentId: null },
        params: { reportId: report.reportId },
      },
    );
    expect(posted.status).toBe(201);
    const rootId = BigInt(posted.body.data.commentId);
    expect((await reply(report.reportId, rootId, member)).status).toBe(201);

    expect((await del(report.reportId, rootId, manager)).status).toBe(204);
  });

  it("TC-CMT-08: 삭제된 댓글은 목록에 deleted:true 로 나오고 content·commenter 가 없으며 대댓글은 부모 아래에 남는다", async () => {
    const { manager, member, report, root } = await setup();
    const child = await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
      content: "확인했습니다",
    });
    await del(report.reportId, root.commentId, manager);

    const result = await list(report.reportId, member);

    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(1);
    const [thread] = result.body.data;
    expect(thread).toEqual({
      commentId: Number(root.commentId),
      deleted: true,
      parentCommentId: null,
      createdAt: expect.any(String),
      replies: [
        expect.objectContaining({
          commentId: Number(child.commentId),
          deleted: false,
          content: "확인했습니다",
          parentCommentId: Number(root.commentId),
        }),
      ],
    });
    // 원문은 DB 에 남아 있어도 응답 어디에도 없다.
    expect(result.raw).not.toContain("원본");
  });

  it("TC-CMT-09: 삭제된 댓글에 대댓글을 달면 400 PARENT_DELETED", async () => {
    const { manager, member, report, root } = await setup();
    await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });
    await del(report.reportId, root.commentId, manager);

    const result = await reply(report.reportId, root.commentId, member);

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("PARENT_DELETED");
    expect(await prisma.reportComment.count()).toBe(2);
  });

  it("TC-CMT-10: 삭제된 댓글의 수정·재삭제는 404 이고 내용이 바뀌지 않는다", async () => {
    const { manager, member, report, root } = await setup();
    await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });
    await del(report.reportId, root.commentId, manager);

    const edited = await put(report.reportId, root.commentId, manager, "고침");
    const again = await del(report.reportId, root.commentId, manager);

    expect(edited.status).toBe(404);
    expect(again.status).toBe(404);
    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: root.commentId },
    });
    expect(row.content).toBe("원본");
  });

  it("TC-CMT-10: 삭제된 타인 댓글은 403 이 아니라 404 다 (작성자를 알리지 않는다)", async () => {
    const { manager, member, report, root } = await setup();
    await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });
    await del(report.reportId, root.commentId, manager);

    expect((await del(report.reportId, root.commentId, member)).status).toBe(
      404,
    );
  });

  // 경로의 reportId 가 그 댓글의 보고가 아니면 404 다. 삭제됐는지와 무관하게
  // 같은 응답이라, 다른 보고에 그 댓글이 있다는 사실도 삭제됐다는 사실도 새지
  // 않는다. PUT·DELETE 두 경로를 모두 본다 — 문서화한 동작이다(명세 4.3).
  it("TC-CMT-10: 다른 보고 경로로 삭제된 댓글을 PUT·DELETE 하면 404 다", async () => {
    const { manager, member, report, root } = await setup();
    const otherReport = await createReport(member.repId, {
      status: "SUBMITTED",
      reportDate: "2026-07-02",
    });
    await createComment(report.reportId, member.repId, {
      parentCommentId: root.commentId,
    });
    await del(report.reportId, root.commentId, manager);

    const edited = await put(otherReport.reportId, root.commentId, manager);
    const removed = await del(otherReport.reportId, root.commentId, manager);

    expect(edited.status).toBe(404);
    expect(removed.status).toBe(404);
    // 소프트 삭제된 원본이 그대로 남아 있다 — 다른 보고 경로가 건드리지 못했다.
    const row = await prisma.reportComment.findUniqueOrThrow({
      where: { commentId: root.commentId },
    });
    expect(row.content).toBe("원본");
    expect(row.deletedAt).not.toBeNull();
  });

  it("이슈 #9 직렬화(결정적): 삭제가 부모를 잠근 채 커밋되기 전에 들어온 대댓글은 400 PARENT_NOT_IN_REPORT 이다(FK 오류·승격 아님)", async () => {
    // 대댓글 작성은 부모를 FOR SHARE 로 잠그고 읽는다. 삭제 트랜잭션이 부모에 건
    // FOR UPDATE 때문에 대기하고, 삭제가 커밋되면 부모가 없는 것을 보고 거부해야 한다.
    // 잠금이 없으면 INSERT 가 FK 위반(500)으로 끝난다.
    const { member, report, root } = await setup();

    const replied = await withHeldTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT comment_id FROM report_comment WHERE comment_id = ${root.commentId} FOR UPDATE`;
        await tx.reportComment.delete({ where: { commentId: root.commentId } });
      },
      () => reply(report.reportId, root.commentId, member),
    );

    expect(replied.status).toBe(400);
    expect(replied.body.error.code).toBe("PARENT_NOT_IN_REPORT");
    expect(await prisma.reportComment.count()).toBe(0);
  });

  it("이슈 #9 직렬화(결정적): 대댓글이 커밋되기 전에 들어온 삭제는 소프트 삭제가 되고 대댓글이 루트로 승격되지 않는다", async () => {
    // 삭제는 대상 행을 FOR UPDATE 로 잠근 뒤 대댓글 수를 센다. 대댓글 INSERT 가
    // 부모에 거는 KEY SHARE 와 부딪혀 대기하고, 커밋 뒤에 수를 세어 소프트 삭제로
    // 가야 한다. 잠금 없이 세면 0 으로 보고 물리 삭제해 대댓글의 parentCommentId 가
    // NULL 이 된다.
    const { manager, member, report, root } = await setup();

    const deleted = await withHeldTransaction(
      async (tx) => {
        await tx.reportComment.create({
          data: {
            reportId: report.reportId,
            commenterId: member.repId,
            parentCommentId: root.commentId,
            content: "답글",
          },
        });
      },
      () => del(report.reportId, root.commentId, manager),
    );

    expect(deleted.status).toBe(204);
    const rows = await prisma.reportComment.findMany({
      orderBy: { commentId: "asc" },
    });
    expect(rows.map((r) => r.parentCommentId)).toEqual([null, root.commentId]);
    expect(rows[0].deletedAt).toBeInstanceOf(Date);
    expect(rows[1].deletedAt).toBeNull();
  });

  it("이슈 #9: 댓글 삭제와 그 댓글에 대한 대댓글 작성을 동시에 보내도 대댓글이 루트로 승격되거나 고아가 되지 않는다", async () => {
    // 가능한 결과는 둘뿐이다.
    //   삭제 먼저 → 삭제 204(물리), 대댓글 400 PARENT_NOT_IN_REPORT, 댓글 0건
    //   대댓글 먼저 → 대댓글 201, 삭제 204(소프트), 댓글 2건(부모 deletedAt, 자식 부모 유지)
    // 금지: 삭제 204 이면서 대댓글 201 (대댓글이 parentCommentId=null 로 승격).
    // 순서는 보장되지 않으므로 반복해서 두 갈래를 모두 지난다.
    for (let i = 0; i < 12; i += 1) {
      const { manager, member, report, root } = await setup();

      const [deleted, replied] = await Promise.all([
        del(report.reportId, root.commentId, manager),
        reply(report.reportId, root.commentId, member),
      ]);

      const comments = await prisma.reportComment.findMany({
        where: { reportId: report.reportId },
      });
      // 어떤 경우에도 루트가 아닌 대댓글의 부모는 존재해야 한다.
      for (const c of comments) {
        if (c.commenterId === member.repId) {
          expect(c.parentCommentId).toBe(root.commentId);
        }
      }

      expect(deleted.status).toBe(204);
      if (replied.status === 400) {
        expect(replied.body.error.code).toBe("PARENT_NOT_IN_REPORT");
        expect(comments).toHaveLength(0);
      } else {
        expect(replied.status).toBe(201);
        expect(comments).toHaveLength(2);
        expect(
          comments.find((c) => c.commentId === root.commentId)?.deletedAt,
        ).toBeInstanceOf(Date);
      }
    }
  });
});
