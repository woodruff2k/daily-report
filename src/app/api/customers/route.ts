import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertAnyRole, parseAuthContext } from "@/lib/auth";
import {
  CUSTOMER_ROLES,
  assertAssignedRepValid,
  toCustomerListItem,
  toCustomerResponse,
} from "@/lib/customer";
import { CUSTOMER_SORT_FIELDS, buildCustomerWhere } from "@/lib/customer-query";
import { ValidationError } from "@/lib/errors";
import { pageResponse, parsePageRequest } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { mapCustomerWriteError } from "@/lib/prisma-errors";
import { customerCreateSchema } from "@/schemas/customer";

/** 고객 목록. (FR-01, API 명세 5.1) 목록에는 이메일을 담지 않는다. (NFR-04) */
export async function GET(request: NextRequest) {
  try {
    assertAnyRole(parseAuthContext(request.headers), CUSTOMER_ROLES);

    const params = request.nextUrl.searchParams;
    const pageRequest = parsePageRequest(params, CUSTOMER_SORT_FIELDS, {
      createdAt: "desc",
    });
    const where = buildCustomerWhere(params);

    const [customers, totalElements] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: pageRequest.skip,
        take: pageRequest.take,
        orderBy: pageRequest.orderBy,
        // 목록 컬럼이 담당 영업 이름이다. 이름만 읽는다.
        include: { assignedRep: { select: { name: true } } },
      }),
      prisma.customer.count({ where }),
    ]);

    return apiSuccess(
      pageResponse(
        customers.map(toCustomerListItem),
        totalElements,
        pageRequest,
      ),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** 고객 등록. (FR-01, API 명세 5.2, TC-CUS-01·02) */
export async function POST(request: NextRequest) {
  try {
    assertAnyRole(parseAuthContext(request.headers), CUSTOMER_ROLES);

    const parsed = customerCreateSchema.safeParse(
      await request.json().catch(() => null),
    );

    if (!parsed.success) {
      throw new ValidationError(
        "필수 항목이 누락되었거나 형식이 올바르지 않습니다.",
      );
    }

    const { assignedRepId, ...fields } = parsed.data;
    await assertAssignedRepValid(BigInt(assignedRepId));

    const created = await prisma.customer.create({
      data: { ...fields, assignedRepId: BigInt(assignedRepId) },
    });

    return apiSuccess(toCustomerResponse(created), 201);
  } catch (error) {
    return apiErrorResponse(mapCustomerWriteError(error));
  }
}
