import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import {
  type AuthContext,
  assertAnyRole,
  assertCommentAuthor,
  parseAuthContext,
} from "@/lib/auth";
import { parseCommentIdParam } from "@/lib/comment-query";
import {
  COMMENT_SELECT,
  assertNoReplies,
  findReportForComment,
  lockComment,
  toCommentResponse,
} from "@/lib/comment";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapCommentWriteError } from "@/lib/prisma-errors";
import { REPORT_ROLES, assertReportViewable } from "@/lib/report";
import { parseReportIdParam } from "@/lib/report-query";
import { commentUpdateSchema } from "@/schemas/comment";

interface RouteContext {
  params: Promise<{ reportId: string; commentId: string }>;
}

/**
 * 수정·삭제 공통 검사. 순서가 보안 설계다. (IDOR)
 *
 * 1. 보고를 읽고 열람 권한을 먼저 본다. 보고를 볼 수 없는 호출자는 댓글 식별자를
 *    훑어도 403 만 받는다 — 그 보고에 그 댓글이 있는지 알 수 없다.
 * 2. 댓글을 `(commentId, reportId)` 로 찾는다. 없는 댓글과 **다른 보고의 댓글**은
 *    같은 404 다. 경로의 `reportId` 가 그 댓글의 것이 아니면 다른 보고를 열람할
 *    권한으로 남의 댓글을 건드릴 수 없다.
 * 3. 그 다음에 작성자 본인인지 본다(`assertCommentAuthor`, 403).
 */
async function loadOwnComment(
  client: Parameters<typeof findReportForComment>[0],
  auth: AuthContext,
  reportId: bigint,
  commentId: bigint,
) {
  const report = await findReportForComment(client, reportId);
  assertReportViewable(auth, report);

  const comment = await client.reportComment.findFirst({
    where: { commentId, reportId },
    select: { commenterId: true },
  });

  if (!comment) {
    throw new NotFoundError("댓글을 찾을 수 없습니다.");
  }

  assertCommentAuthor(auth, comment.commenterId);
}

/**
 * 댓글 수정. 본인 것만. (API 명세 4.3, TC-CMT-04)
 *
 * PUT 은 전체 교체이고 수정 가능한 필드는 `content` 하나다. 스레드 위치
 * (`parentCommentId`)는 바꾸지 못한다. `updatedAt` 컬럼이 없어 수정 시각은
 * 응답에 없다. 수정은 보고 상태와 무관하다.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const raw = await context.params;
    const reportId = parseReportIdParam(raw.reportId);
    const commentId = parseCommentIdParam(raw.commentId);
    const parsed = commentUpdateSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError(
        "필수 항목이 누락되었거나 형식이 올바르지 않습니다.",
      );
    }

    await loadOwnComment(prisma, auth, reportId, commentId);

    // 읽은 뒤 삭제되었다면 P2025 → 404 로 매핑된다.
    const updated = await prisma.reportComment.update({
      where: { commentId },
      data: { content: parsed.data.content },
      select: COMMENT_SELECT,
    });

    return apiSuccess(toCommentResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapCommentWriteError(error));
  }
}

/**
 * 댓글 삭제. 본인 것만. (API 명세 4.3, TC-CMT-05)
 *
 * 대댓글이 달린 댓글은 409 `COMMENT_HAS_REPLIES` 다. 소프트 삭제 컬럼이 없고
 * 물리 삭제는 대댓글을 루트로 승격시키기 때문이다(`assertNoReplies` 주석 참고).
 * 대상 행을 잠근 뒤 대댓글 수를 세어, 그 사이 들어오는 대댓글과 직렬화한다.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const raw = await context.params;
    const reportId = parseReportIdParam(raw.reportId);
    const commentId = parseCommentIdParam(raw.commentId);

    await prisma.$transaction(async (tx) => {
      await loadOwnComment(tx, auth, reportId, commentId);
      await lockComment(tx, commentId, "UPDATE");
      await assertNoReplies(tx, commentId);
      await tx.reportComment.delete({ where: { commentId } });
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(mapCommentWriteError(error));
  }
}
