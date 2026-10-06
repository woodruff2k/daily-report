import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { toJsonId } from "@/lib/identifier";
import { pageResponse, parsePageRequest } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { mapReportWriteError } from "@/lib/prisma-errors";
import { REPORT_ROLES, toDbDate, toReportListItem } from "@/lib/report";
import { REPORT_SORT_FIELDS, buildReportWhere } from "@/lib/report-query";
import { reportCreateSchema } from "@/schemas/report";

/** 본인 보고 목록. (FR-10, API 명세 3.1, TC-RPT-03·04) */
export async function GET(request: NextRequest) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const params = request.nextUrl.searchParams;
    const pageRequest = parsePageRequest(
      params,
      REPORT_SORT_FIELDS,
      {
        reportDate: "desc",
      },
      "reportId",
    );
    // 조회 대상은 항상 호출자 본인이다. 사원 식별자를 쿼리로 받지 않는다.
    const where = buildReportWhere(params, auth.repId);

    const [reports, totalElements] = await Promise.all([
      prisma.dailyReport.findMany({
        where,
        skip: pageRequest.skip,
        take: pageRequest.take,
        // 정렬 키가 status·grade·department 처럼 값 종류가 적으면 거의 모든 행이
        // 동순위라, 보조 키가 없으면 쪽 경계에서 행이 중복·누락된다.
        // 보조 키(식별자)는 1차 정렬과 무관하게 안정성만 보장하므로 방향은 desc 로 통일한다.
        orderBy: pageRequest.orderBy,
        // 건수는 _count 로 한 번에 읽는다. 보고마다 따로 세지 않는다.
        select: {
          reportId: true,
          reportDate: true,
          status: true,
          updatedAt: true,
          _count: { select: { visits: true, comments: true } },
        },
      }),
      prisma.dailyReport.count({ where }),
    ]);

    return apiSuccess(
      pageResponse(reports.map(toReportListItem), totalElements, pageRequest),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 일일보고 생성. (FR-03, API 명세 3.2, TC-RPT-01·02)
 *
 * 같은 일자의 보고가 있으면 409 `REPORT_ALREADY_EXISTS` 다. 명세는 "409 또는 기존
 * 보고 반환"을 허용하지만 이슈 수용 기준이 409 로 정했다. 기존 보고를 돌려주면
 * 화면이 새로 만든 줄 알고 제출된 보고를 덮어쓰려 할 수 있다.
 *
 * 중복 판정은 사전 조회가 아니라 DB 유니크 제약(`repId`, `reportDate`)에 맡긴다.
 * 조회 후 생성은 동시 요청 둘이 모두 통과한다.
 *
 * `reportDate` 는 임의 날짜를 받는다. 명세가 제약을 두지 않았고 선작성을 막지 않는다.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, REPORT_ROLES);

    const parsed = reportCreateSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError(
        "필수 항목이 누락되었거나 형식이 올바르지 않습니다.",
      );
    }

    // 작성자는 본문이 아니라 인증 컨텍스트에서 정한다.
    const created = await prisma.dailyReport.create({
      data: { repId: auth.repId, reportDate: toDbDate(parsed.data.reportDate) },
      select: { reportId: true, status: true },
    });

    return apiSuccess(
      { reportId: toJsonId(created.reportId), status: created.status },
      201,
    );
  } catch (error) {
    return apiErrorResponse(mapReportWriteError(error));
  }
}
