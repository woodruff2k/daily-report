import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, assertTeamScope, parseAuthContext } from "@/lib/auth";
import { pageResponse, parsePageRequest } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { toTeamReportListItem } from "@/lib/report";
import {
  REPORT_SORT_FIELDS,
  buildTeamReportWhere,
  parseRepIdsParam,
} from "@/lib/report-query";

/**
 * 팀 보고 조회. (FR-10, API 명세 3.7, SCR-300, TC-SEC-02·RPT-03·04)
 *
 * 팀원은 **직속 부하**만이다. 재귀(CTE)로 손자 팀원까지 넓히지 않는다.
 * 열람 판정(`assertReportViewable` → `isManagerOf`)이 직속만 보므로, 목록에 손자의
 * 보고를 넣으면 목록에는 나오는데 열면 403 인 모순이 생긴다.
 *
 * 범위 밖 `repIds` 는 결과에서 조용히 빼지 않고 403 이다. 빼면 호출자가 왜 비었는지
 * 알 수 없다.
 *
 * 작성중(DRAFT) 보고도 조회된다. SCR-300 의 검색 조건과 명세 3.7 의 `status` 가
 * DRAFT 를 받고, 상세 열람도 상태로 제한하지 않는다. 제출 여부로 갈리는 것은 댓글
 * 작성이다(FR-09).
 *
 * 팀원이 없으면 빈 페이지 200 이다. 404 가 아니다.
 *
 * 역할 검사를 입력 검증보다 먼저 한다. 상급자가 아닌 호출자가 400/403 차이로
 * 파라미터 처리 방식을 탐색하지 못하게 한다.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, ["MANAGER"]);

    const params = request.nextUrl.searchParams;
    const pageRequest = parsePageRequest(
      params,
      REPORT_SORT_FIELDS,
      {
        reportDate: "desc",
      },
      "reportId",
    );
    const requestedRepIds = parseRepIdsParam(params);

    const subordinates = await prisma.salesRep.findMany({
      where: { managerId: auth.repId },
      select: { repId: true },
    });
    const repIds = assertTeamScope(
      auth,
      requestedRepIds,
      subordinates.map((rep) => rep.repId),
    );

    // 필터 검증(400)은 범위 검증 뒤에 와도 되지만 DB 를 타기 전에 끝내는 편이 낫다.
    const where = buildTeamReportWhere(params, repIds);

    // `in: []` 는 Prisma 가 빈 결과로 처리하지만 DB 왕복이 필요 없다. 명시적으로 뺀다.
    if (repIds.length === 0) {
      return apiSuccess(pageResponse([], 0, pageRequest));
    }

    const [reports, totalElements] = await Promise.all([
      prisma.dailyReport.findMany({
        where,
        skip: pageRequest.skip,
        take: pageRequest.take,
        // 같은 일자에 여러 팀원의 보고가 있어 정렬 키만으로는 페이지 경계가 흔들린다.
        orderBy: pageRequest.orderBy,
        select: {
          reportId: true,
          reportDate: true,
          status: true,
          updatedAt: true,
          rep: { select: { repId: true, name: true } },
          _count: { select: { visits: true, comments: true } },
        },
      }),
      prisma.dailyReport.count({ where }),
    ]);

    return apiSuccess(
      pageResponse(
        reports.map(toTeamReportListItem),
        totalElements,
        pageRequest,
      ),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
