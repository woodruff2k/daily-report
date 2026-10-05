import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, assertCanComment, parseAuthContext } from "@/lib/auth";
import {
  COMMENT_ORDER_BY,
  COMMENT_SELECT,
  COMMENT_TREE_SELECT,
  assertReplyParent,
  findReportForComment,
  toCommentResponse,
  toCommentThread,
} from "@/lib/comment";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapCommentWriteError } from "@/lib/prisma-errors";
import { REPORT_ROLES, assertReportViewable } from "@/lib/report";
import { parseReportIdParam } from "@/lib/report-query";
import { commentCreateSchema } from "@/schemas/comment";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

/**
 * 댓글 목록. (API 명세 4.1, TC-CMT-03)
 *
 * 응답 `data` 는 배열이다. 명세가 페이지네이션을 두지 않았다. 루트 댓글을 작성순
 * 으로, 각 `replies` 도 작성순으로 담는다. 한 쿼리로 읽는다.
 *
 * 열람 권한은 보고와 같다(`assertReportViewable`): 작성자 본인 또는 직속 상급자.
 * 상태로 제한하지 않으므로 댓글이 없는 보고·작성중 보고는 404 가 아니라 빈 배열
 * 200 이다. 댓글 작성이 SUBMITTED 를 요구해 작성중 보고에는 댓글이 있을 수 없다.
 * ADMIN 은 보고가 담당 범위가 아니므로 403 이다.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const reportId = parseReportIdParam((await context.params).reportId);
    assertReportViewable(auth, await findReportForComment(prisma, reportId));

    const roots = await prisma.reportComment.findMany({
      where: { reportId, parentCommentId: null },
      orderBy: COMMENT_ORDER_BY,
      select: COMMENT_TREE_SELECT,
    });

    return apiSuccess(roots.map(toCommentThread));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 댓글 작성. (FR-09, API 명세 4.2, TC-CMT-01·02, TC-SEC-04)
 *
 * 직속 상급자는 댓글·대댓글, 보고 작성자 본인은 대댓글만 쓴다. 보고가 SUBMITTED 가
 * 아니면 409 `REPORT_NOT_SUBMITTED` 다. 권한이 상태보다 먼저다(`assertCanComment`)
 * — 권한 없는 호출자에게 보고가 작성중이라는 사실이 새지 않는다. 작성자는 본문이
 * 아니라 인증 컨텍스트에서 정한다.
 *
 * 대댓글은 1단계까지, 부모는 같은 보고의 루트 댓글이어야 한다(`assertReplyParent`).
 * 부모 확인과 쓰기는 한 트랜잭션이고 부모 행을 잠가 동시 삭제와 직렬화한다.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const reportId = parseReportIdParam((await context.params).reportId);
    const parsed = commentCreateSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError(
        "필수 항목이 누락되었거나 형식이 올바르지 않습니다.",
      );
    }

    const { content, parentCommentId: rawParentId } = parsed.data;
    const parentCommentId = rawParentId === null ? null : BigInt(rawParentId);

    const created = await prisma.$transaction(async (tx) => {
      const report = await findReportForComment(tx, reportId);

      assertCanComment(
        auth,
        {
          author: { repId: report.repId, managerId: report.rep.managerId },
          status: report.status,
        },
        parentCommentId,
      );

      if (parentCommentId !== null) {
        await assertReplyParent(tx, reportId, parentCommentId);
      }

      return tx.reportComment.create({
        data: {
          reportId,
          commenterId: auth.repId,
          parentCommentId,
          content,
        },
        select: COMMENT_SELECT,
      });
    });

    return apiSuccess(toCommentResponse(created), 201);
  } catch (error) {
    return apiErrorResponse(mapCommentWriteError(error));
  }
}
