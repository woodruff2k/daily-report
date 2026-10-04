import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import {
  assertAnyRole,
  assertReportEditable,
  parseAuthContext,
} from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapReportWriteError } from "@/lib/prisma-errors";
import {
  REPORT_DETAIL_INCLUDE,
  REPORT_ROLES,
  assertReportViewable,
  lockDraftReport,
  replaceReportContent,
  toReportDetail,
} from "@/lib/report";
import { parseReportIdParam } from "@/lib/report-query";
import { reportSaveSchema } from "@/schemas/report";

interface RouteContext {
  params: Promise<{ reportId: string }>;
}

/**
 * 일일보고 상세. (API 명세 3.3, TC-RPT-05, TC-SEC-01)
 *
 * 없는 보고는 404, 있지만 호출자가 볼 수 없는 보고는 403 이다. 명세는 TC-SEC-01
 * 에서 403/404 둘 다 허용한다. 판정은 `assertReportViewable` 이 한다.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const reportId = parseReportIdParam((await context.params).reportId);
    // 상급자 판정에 작성자의 managerId 가 필요해 관계로 함께 읽는다.
    const report = await prisma.dailyReport.findUnique({
      where: { reportId },
      include: REPORT_DETAIL_INCLUDE,
    });

    if (!report) {
      throw new NotFoundError("보고를 찾을 수 없습니다.");
    }

    assertReportViewable(auth, report);

    return apiSuccess(toReportDetail(report));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 일일보고 저장. (FR-04·06·07, API 명세 3.4) 방문·과제·계획 전체 교체다.
 *
 * 작성자 본인의 DRAFT 보고만 허용한다. 타인 보고는 403, 제출된 보고는 409
 * `REPORT_LOCKED` 다. (TC-SUB-03, `assertReportEditable`)
 *
 * 읽기·검증·삭제·갱신·생성을 한 트랜잭션에 묶는다. 보고 행을 `lockDraftReport`
 * 로 먼저 잠가 동시 PUT·제출과 직렬화하고, 그 뒤에 자식 행을 읽는다.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const reportId = parseReportIdParam((await context.params).reportId);
    const parsed = reportSaveSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError(
        "필수 항목이 누락되었거나 형식이 올바르지 않습니다.",
      );
    }

    const saved = await prisma.$transaction(async (tx) => {
      const current = await tx.dailyReport.findUnique({
        where: { reportId },
        select: { repId: true, status: true },
      });

      if (!current) {
        throw new NotFoundError("보고를 찾을 수 없습니다.");
      }

      assertReportEditable(auth, current);
      // 위 판정은 읽은 시점의 값이다. 잠그며 DRAFT 를 다시 확인한다.
      await lockDraftReport(tx, reportId);
      await replaceReportContent(tx, reportId, parsed.data);

      return tx.dailyReport.findUniqueOrThrow({
        where: { reportId },
        include: REPORT_DETAIL_INCLUDE,
      });
    });

    return apiSuccess(toReportDetail(saved));
  } catch (error) {
    return apiErrorResponse(mapReportWriteError(error));
  }
}
