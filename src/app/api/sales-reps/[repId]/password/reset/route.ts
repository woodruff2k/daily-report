import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertRole, parseAuthContext } from "@/lib/auth";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { mapSalesRepWriteError } from "@/lib/prisma-errors";
import { parseRepIdParam } from "@/lib/sales-rep-query";

interface RouteContext {
  params: Promise<{ repId: string }>;
}

/**
 * 임시 비밀번호 재발급. 관리자 전용. (이슈 #44)
 *
 * 비밀번호를 잊은 사원의 계정을 다시 쓸 수 있게 한다. 관리자는 기존 비밀번호를
 * 알 수 없고(해시만 저장한다), 알 필요도 없다.
 *
 * 평문은 이 응답에 1회만 담긴다. 저장하지도 로그에 남기지도 않는다. (NFR-04)
 * 발급 후에는 mustChangePassword 가 서고, 본인이 바꿀 때까지 프록시가 다른
 * API 를 막는다.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertRole(parseAuthContext(request.headers), "ADMIN");

    const repId = parseRepIdParam((await context.params).repId);
    const temporaryPassword = generateTemporaryPassword();

    const updated = await prisma.salesRep.update({
      where: { repId },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
      },
      select: { repId: true, empNo: true },
    });

    return apiSuccess({
      repId: Number(updated.repId),
      empNo: updated.empNo,
      temporaryPassword,
    });
  } catch (error) {
    return apiErrorResponse(mapSalesRepWriteError(error));
  }
}
