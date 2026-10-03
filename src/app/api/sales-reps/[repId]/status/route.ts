import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertRole, parseAuthContext } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapSalesRepWriteError } from "@/lib/prisma-errors";
import { toSalesRepResponse } from "@/lib/sales-rep";
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

    const updated = await prisma.salesRep.update({
      where: { repId },
      data: { status: parsed.data.status },
    });

    return apiSuccess(toSalesRepResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapSalesRepWriteError(error));
  }
}
