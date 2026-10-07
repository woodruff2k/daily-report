import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSalesRepTeamOption } from "@/lib/sales-rep";

/**
 * 팀원 Select 옵션. (SCR-300 팀원 다중 선택, API 명세 6.7)
 *
 * 6.6(`/options`)과 따로 둔 이유: 6.6 은 전사 활성 사원을 주므로 팀원이 아닌 사람을
 * 고를 수 있고, 고르면 팀 보고 조회(3.7)의 `assertTeamScope` 가 403 을 준다.
 * 6.1 은 관리자 전용이라 상급자가 부를 수 없다.
 *
 * **범위는 `reports/team` 이 팀원을 구하는 조건과 같아야 한다.** 직속(`managerId`)
 * 이고, 재귀로 손자를 넓히지 않는다.
 *
 * **`status` 로 거르지 않는다. 6.6 은 `ACTIVE` 만 주지만 여기서는 같은 규칙을 쓰면
 * 안 된다.** `reports/team` 이 팀원을 `status` 로 거르지 않아 비활성 팀원의 과거
 * 보고가 목록에 나온다. 여기서 `ACTIVE` 만 주면 그 보고가 목록에는 있는데 그 사람으로
 * 필터할 수 없다. 6.6 이 거르는 이유(새 고객의 담당자로 비활성 사원 선택 방지)는 이
 * 화면과 무관하다. "일관성" 을 이유로 `ACTIVE` 필터를 넣지 말 것. 화면이 "(비활성)"
 * 을 표시할 수 있게 `status` 를 응답에 담는다.
 *
 * 역할은 MANAGER 만이다. 6.6 은 페이로드가 이름뿐이라 역할 검사를 생략했지만, 이쪽은
 * "누가 누구의 부하인가" 라는 조직 구조라 상급자 본인에게만 준다.
 *
 * 팀원이 없으면 빈 배열 200 이다(404 아님). 페이지네이션이 없다 — Select 는 전체가
 * 필요하다. 사번·이메일·부서·직급은 담지 않는다. (NFR-04)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, ["MANAGER"]);

    const reps = await prisma.salesRep.findMany({
      where: { managerId: auth.repId },
      // 동명이인이 있으면 이름만으로는 순서가 정해지지 않아 새로고침마다 Select
      // 항목이 뒤바뀐다. 페이지네이션이 없어 누락·중복은 없지만 흔들림은 보인다.
      // (이슈 #95 검토)
      orderBy: [{ name: "asc" }, { repId: "asc" }],
      select: { repId: true, name: true, status: true },
    });

    return apiSuccess(reps.map(toSalesRepTeamOption));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
