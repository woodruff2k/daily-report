import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, assertOwner, parseAuthContext } from "@/lib/auth";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toJsonId } from "@/lib/identifier";
import { prisma } from "@/lib/prisma";
import { mapReportWriteError } from "@/lib/prisma-errors";
import { REPORT_ROLES, lockSubmittedReport } from "@/lib/report";
import { parseReportIdParam } from "@/lib/report-query";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

const NOT_SUBMITTED = () =>
  new ConflictError("REPORT_NOT_SUBMITTED", "제출된 보고가 아닙니다.");

/**
 * 일일보고 회수. (FR-08, API 명세 3.6, 이슈 #109, TC-WDR-01~)
 *
 * 작성자 본인이 SUBMITTED 보고를 DRAFT 로 되돌린다. 상급자도 대신 회수할 수 없다.
 * **댓글이 1건이라도 있으면 409 `REPORT_HAS_COMMENTS`** 다 — 상급자가 이미 본
 * 보고를 작성자가 조용히 바꾸지 못하게 한다. 소프트 삭제된 댓글(`deletedAt`)도
 * 센다: 행과 스레드가 남아 있고 상급자가 봤다는 사실은 변하지 않는다. 그 경우의
 * 해법은 상급자 반려이고 이 이슈의 범위 밖이다.
 *
 * 한계: 상태 이력 테이블이 없다. `submittedAt` 은 단일 컬럼이라 회수 때 null 이
 * 되고 재제출 때 새 시각으로 덮인다 — **최초 제출 시각은 남지 않고 마지막 제출
 * 시각만 남는다.** NFR-02 의 이력 요구를 이 범위에서는 다 채우지 못한다. 필요해지면
 * `report_status_history` 테이블(마이그레이션)을 별도 이슈로 올린다.
 *
 * 동시성. 순서가 중요하다.
 * 1. `status = SUBMITTED` 조건부 UPDATE 로 행 잠금을 잡고 전환한다. 동시에 온 두
 *    회수는 여기서 줄을 서고, 늦은 쪽은 0행이라 409 `REPORT_NOT_SUBMITTED` 다.
 * 2. **같은 트랜잭션에서** 그 뒤에 댓글을 센다. 밖에서 세면 check-then-write 다.
 *    1 개 이상이면 예외로 던져 전환을 롤백한다(제출의 방문 수 검사와 같은 방식).
 * 3. 댓글 작성(4.2)과의 경합은 댓글 쪽이 상태를 읽기 전에 보고 행을 `FOR SHARE`
 *    로 잠가 막는다(`lockReportShared`). 그것이 없으면 "댓글이 SUBMITTED 를 읽음
 *    → 회수가 댓글 0건을 세고 커밋 → 댓글이 INSERT" 로 DRAFT 보고에 댓글이 달린다.
 *    댓글이 먼저 잠그면 1 의 UPDATE 가 기다렸다가 커밋된 댓글을 세고, 회수가 먼저면
 *    댓글이 기다렸다가 DRAFT 를 보고 409 가 된다. 어느 순서든 "DRAFT + 댓글 있음"
 *    은 생기지 않는다.
 *
 * PUT 저장(3.4)과의 경합은 이미 안전하다 — 둘 다 같은 행을 UPDATE 로 잠근다.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const reportId = parseReportIdParam((await context.params).reportId);

    await prisma.$transaction(async (tx) => {
      const current = await tx.dailyReport.findUnique({
        where: { reportId },
        select: { repId: true, status: true },
      });

      if (!current) {
        throw new NotFoundError("보고를 찾을 수 없습니다.");
      }

      // 본인 검사가 상태 검사보다 먼저다. 남의 보고의 제출 여부를 알려주지 않는다.
      assertOwner(auth, current.repId);

      if (current.status === "DRAFT") {
        throw NOT_SUBMITTED();
      }

      // 읽은 뒤 다른 요청이 먼저 회수한 경우 0행이다.
      const switched = await lockSubmittedReport(tx, reportId, {
        status: "DRAFT",
        submittedAt: null,
      });
      if (!switched) {
        throw NOT_SUBMITTED();
      }

      // deletedAt 으로 거르지 않는다. 소프트 삭제된 댓글도 댓글이다.
      const commentCount = await tx.reportComment.count({
        where: { reportId },
      });
      if (commentCount > 0) {
        throw new ConflictError(
          "REPORT_HAS_COMMENTS",
          "댓글이 달린 보고는 회수할 수 없습니다.",
        );
      }
    });

    return apiSuccess({
      reportId: toJsonId(reportId),
      status: "DRAFT" as const,
      submittedAt: null,
    });
  } catch (error) {
    return apiErrorResponse(mapReportWriteError(error));
  }
}
