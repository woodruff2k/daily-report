import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, assertOwner, parseAuthContext } from "@/lib/auth";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { toJsonId } from "@/lib/identifier";
import { prisma } from "@/lib/prisma";
import { mapReportWriteError } from "@/lib/prisma-errors";
import { REPORT_ROLES, lockDraftReport } from "@/lib/report";
import { parseReportIdParam } from "@/lib/report-query";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

/**
 * 일일보고 제출. (FR-08, API 명세 3.5, TC-SUB-01·02)
 *
 * 작성자 본인만 제출한다. 상급자도 팀원 보고를 대신 제출할 수 없다.
 *
 * 이미 제출된 보고의 재호출은 409 `REPORT_ALREADY_SUBMITTED` 다. 멱등 200 은
 * 화면이 DRAFT 로 알고 있던 불일치를 조용히 덮고, 400 은 요청 본문 유효성 실패
 * 자리다. 이 저장소는 상태 충돌에 일관되게 409 를 쓴다.
 *
 * 방문 0건은 400 `VISITS_REQUIRED` 다. 저장(PUT)은 0건을 허용하고 제출만 막는다.
 * 방문 수는 상태를 바꾼 뒤 같은 트랜잭션에서 센다. 잠금을 먼저 잡아야 그 사이
 * PUT 이 방문을 지우지 못하고, 0건이면 예외로 트랜잭션이 롤백되어 상태가 돌아간다.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const reportId = parseReportIdParam((await context.params).reportId);

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.dailyReport.findUnique({
        where: { reportId },
        select: { repId: true, status: true },
      });

      if (!current) {
        throw new NotFoundError("보고를 찾을 수 없습니다.");
      }

      // 본인 검사가 상태 검사보다 먼저다. 남의 보고의 제출 여부를 알려주지 않는다.
      assertOwner(auth, current.repId);

      if (current.status === "SUBMITTED") {
        throw new ConflictError(
          "REPORT_ALREADY_SUBMITTED",
          "이미 제출된 보고입니다.",
        );
      }

      const submittedAt = new Date();
      try {
        await lockDraftReport(tx, reportId, {
          status: "SUBMITTED",
          submittedAt,
        });
      } catch (error) {
        // 읽은 뒤 다른 요청이 먼저 제출한 경우다. 이 API 의 의미로는 중복 제출이다.
        if (error instanceof ConflictError) {
          throw new ConflictError(
            "REPORT_ALREADY_SUBMITTED",
            "이미 제출된 보고입니다.",
          );
        }
        throw error;
      }

      const visitCount = await tx.visitRecord.count({ where: { reportId } });
      if (visitCount < 1) {
        throw new ValidationError(
          "방문기록이 1건 이상이어야 제출할 수 있습니다.",
          "VISITS_REQUIRED",
        );
      }

      return { reportId, status: "SUBMITTED" as const, submittedAt };
    });

    return apiSuccess({
      reportId: toJsonId(result.reportId),
      status: result.status,
      submittedAt: result.submittedAt.toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(mapReportWriteError(error));
  }
}
