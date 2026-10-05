import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import {
  CUSTOMER_ROLES,
  assertAssignedRepValid,
  toCustomerResponse,
} from "@/lib/customer";
import { parseCustomerIdParam } from "@/lib/customer-query";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapCustomerWriteError } from "@/lib/prisma-errors";
import { customerUpdateSchema } from "@/schemas/customer";

interface RouteContext {
  params: Promise<{ customerId: string }>;
}

/** 영업사원과 상급자만 허용한다. 관리자는 고객 마스터 담당이 아니다. */
/** 고객 상세. (API 명세 5.3) */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    assertAnyRole(parseAuthContext(request.headers), CUSTOMER_ROLES);

    const customerId = parseCustomerIdParam((await context.params).customerId);
    const customer = await prisma.customer.findUnique({
      where: { customerId },
      // 담당 영업 이름을 함께 읽는다. 이름만 읽는다(NFR-04).
      include: { assignedRep: { select: { name: true } } },
    });

    if (!customer) {
      throw new NotFoundError("고객을 찾을 수 없습니다.");
    }

    return apiSuccess(toCustomerResponse(customer));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 고객 수정. (API 명세 5.3) 전체 교체다.
 *
 * 선택 항목을 생략하면 null 로 비워진다. `status` 는 필수라 생략하면 400이다.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    assertAnyRole(parseAuthContext(request.headers), CUSTOMER_ROLES);

    const customerId = parseCustomerIdParam((await context.params).customerId);
    const parsed = customerUpdateSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError(
        "필수 항목이 누락되었거나 형식이 올바르지 않습니다.",
      );
    }

    const { assignedRepId, ...fields } = parsed.data;

    const current = await prisma.customer.findUnique({
      where: { customerId },
      select: { assignedRepId: true },
    });

    if (!current) {
      throw new NotFoundError("고객을 찾을 수 없습니다.");
    }

    // 담당 영업이 바뀔 때만 검증한다. 담당자가 나중에 비활성화된 고객은
    // 연락처만 고치려는 요청까지 막히면 안 된다. (영업 마스터 #49 와 같은 규칙)
    const nextRepId = BigInt(assignedRepId);
    if (nextRepId !== current.assignedRepId) {
      await assertAssignedRepValid(nextRepId);
    }

    const updated = await prisma.customer.update({
      where: { customerId },
      data: { ...fields, assignedRepId: nextRepId },
      // 담당 영업 이름을 함께 읽는다. 이름만 읽는다(NFR-04).
      include: { assignedRep: { select: { name: true } } },
    });

    return apiSuccess(toCustomerResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapCustomerWriteError(error));
  }
}
