import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import {
  CUSTOMER_ROLES,
  assertAssignedRepValid,
  assertCustomerWritable,
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
 *
 * 담당 영업 본인과 그 직속 상급자만 수정할 수 있다. 담당 이관도 이 경로다 —
 * 현재 담당자가 `assignedRepId` 를 바꾸면 받은 사람이 그 뒤로 수정할 수 있다.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, CUSTOMER_ROLES);

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
      select: {
        assignedRepId: true,
        // 쓰기 범위 판정에 담당 사원의 직속 상급자가 필요하다.
        assignedRep: { select: { repId: true, managerId: true } },
      },
    });

    // 404 를 403 보다 먼저 판정한다. 조회가 전사에 열려 있어(정책 C) 고객의
    // 존재 여부는 비밀이 아니다. 권한 판정은 현재 담당자가 필요해 조회 뒤에 온다.
    // 본문 검증(400)은 DB 를 보지 않으므로 그보다 앞선다.
    if (!current) {
      throw new NotFoundError("고객을 찾을 수 없습니다.");
    }
    assertCustomerWritable(auth, current);

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
