import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { lockAdminMutations } from "@/lib/advisory-lock";
import { assertRole, parseAuthContext } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapSalesRepWriteError } from "@/lib/prisma-errors";
import { assertNotLastActiveAdmin, toSalesRepResponse } from "@/lib/sales-rep";
import { parseRepIdParam } from "@/lib/sales-rep-query";
import { salesRepStatusSchema } from "@/schemas/sales-rep";

interface RouteContext {
  params: Promise<{ repId: string }>;
}

/**
 * 영업 마스터 비활성화·활성화. (NFR-03, API 명세 6.4)
 *
 * 물리 삭제 경로를 두지 않는다. 과거 보고가 참조하는 사원이 사라지면
 * 참조 무결성이 깨지므로 상태값만 바꾼다. (TC-REP-04)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertRole(parseAuthContext(request.headers), "ADMIN");

    const repId = parseRepIdParam((await context.params).repId);
    const parsed = salesRepStatusSchema.safeParse(
      await request.json().catch(() => null)
    );

    if (!parsed.success) {
      throw new ValidationError("status는 ACTIVE 또는 INACTIVE 여야 합니다.");
    }

    // 판정과 쓰기를 한 트랜잭션에 묶고 잠금으로 직렬화한다. 나누면 동시
    // 요청이 둘 다 "다른 관리자가 있다" 를 보고 통과한다. (이슈 #55)
    const updated = await prisma.$transaction(async (tx) => {
      await lockAdminMutations(tx);
      await assertNotLastActiveAdmin(tx, repId, { status: parsed.data.status });

      return tx.salesRep.update({
        where: { repId },
        data: {
          status: parsed.data.status,
          // 비활성화는 즉시 효력이 있어야 한다. 버전을 올려 그 계정의 기존
          // 토큰을 끊는다. 재활성화는 끊을 이유가 없다. (이슈 #52)
          tokenVersion: parsed.data.status === "INACTIVE" ? { increment: 1 } : undefined,
        },
      });
    });

    return apiSuccess(toSalesRepResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapSalesRepWriteError(error));
  }
}
