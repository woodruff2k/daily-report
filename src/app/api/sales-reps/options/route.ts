import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { parseAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSalesRepOption } from "@/lib/sales-rep";

/**
 * 영업 Select 옵션. (FR-01 고객 담당 영업 Select, API 명세 6.6)
 *
 * 6.1(`GET /api/sales-reps`)과 따로 둔 이유는 두 가지다.
 *
 * - 필드: `repId`·`name` 만 준다. 6.1 은 사번·부서·역할을 담아 관리자 전용이다.
 *   그 권한을 넓히면 전 직원에게 그 정보가 보인다. (NFR-04)
 * - 역할: SCR-400·410 의 접근 권한은 영업사원/상급자인데, 담당 영업 Select 를
 *   채울 API 가 관리자 전용이라 화면을 명세대로 만들 수 없었다.
 *
 * **역할 검사(`assertRole`)를 일부러 생략한다.** 인증된 모든 역할(SALES_REP·
 * MANAGER·ADMIN)이 호출할 수 있다. 페이로드가 활성 사원의 이름뿐이고 ADMIN 은
 * 이미 6.1 로 더 많은 것을 보므로 역할별로 가릴 이유가 없다. 토큰이 없으면
 * 프록시가 401 로 막고, `parseAuthContext` 가 헤더 부재를 한 번 더 401 로 막는다.
 *
 * - ACTIVE 만 반환한다. 새 고객의 담당자로 비활성 사원을 고를 수 없어야 한다.
 *   기존 담당자가 이미 비활성인 고객의 수정 화면은 이 목록에 그 값이 없다.
 * - 페이지네이션이 없다. Select 는 전체가 필요하고, 페이지로 자르면 빠지는
 *   사원이 생긴다. 조직이 커지면 검색형 Select 로 바꿔야 한다.
 */
export async function GET(request: NextRequest) {
  try {
    parseAuthContext(request.headers);

    const reps = await prisma.salesRep.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { repId: true, name: true },
    });

    return apiSuccess(reps.map(toSalesRepOption));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
