import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import { CUSTOMER_ROLES, toCustomerResponse } from "@/lib/customer";
import { parseCustomerIdParam } from "@/lib/customer-query";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapCustomerWriteError } from "@/lib/prisma-errors";
import { customerStatusSchemaBody } from "@/schemas/customer";

interface RouteContext {
  params: Promise<{ customerId: string }>;
}

/**
 * 고객 비활성화·활성화. (NFR-03, API 명세 5.4)
 *
 * 물리 삭제 경로를 두지 않는다. 과거 방문기록이 참조하는 고객이 사라지면
 * 참조 무결성이 깨지므로 상태값만 바꾼다. (TC-CUS-04)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAnyRole(parseAuthContext(request.headers), CUSTOMER_ROLES);

    const customerId = parseCustomerIdParam((await context.params).customerId);
    const parsed = customerStatusSchemaBody.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError("status는 ACTIVE 또는 INACTIVE 여야 합니다.");
    }

    const updated = await prisma.customer.update({
      where: { customerId },
      data: { status: parsed.data.status },
    });

    return apiSuccess(toCustomerResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapCustomerWriteError(error));
  }
}
