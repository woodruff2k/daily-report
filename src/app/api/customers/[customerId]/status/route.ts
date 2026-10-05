import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import {
  CUSTOMER_ROLES,
  assertCustomerWritable,
  toCustomerResponse,
} from "@/lib/customer";
import { parseCustomerIdParam } from "@/lib/customer-query";
import { NotFoundError, ValidationError } from "@/lib/errors";
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
 *
 * 담당 영업 본인과 그 직속 상급자만 허용한다. (이슈 #68, TC-SEC-08)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, CUSTOMER_ROLES);

    const customerId = parseCustomerIdParam((await context.params).customerId);
    const parsed = customerStatusSchemaBody.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError("status는 ACTIVE 또는 INACTIVE 여야 합니다.");
    }

    const current = await prisma.customer.findUnique({
      where: { customerId },
      select: { assignedRep: { select: { repId: true, managerId: true } } },
    });

    // 404 가 403 보다 먼저다. 조회가 전사에 열려 있어 존재 여부는 비밀이 아니다.
    if (!current) {
      throw new NotFoundError("고객을 찾을 수 없습니다.");
    }
    assertCustomerWritable(auth, current);

    const updated = await prisma.customer.update({
      where: { customerId },
      data: { status: parsed.data.status },
      // 담당 영업 이름을 함께 읽는다. 이름만 읽는다(NFR-04).
      include: { assignedRep: { select: { name: true } } },
    });

    return apiSuccess(toCustomerResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapCustomerWriteError(error));
  }
}
