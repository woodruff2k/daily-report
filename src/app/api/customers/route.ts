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
    const auth = parseAuthContext(request.headers);
    assertAnyRole(auth, CUSTOMER_ROLES);

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
        // 이름은 목록 컬럼이고, repId·managerId 는 `editable` 판정에만 쓴다
        // (응답에는 담지 않는다). 그 밖의 필드는 읽지 않는다. (NFR-04)
        include: {
          assignedRep: { select: { name: true, repId: true, managerId: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return apiSuccess(
      pageResponse(
        customers.map((customer) => toCustomerListItem(customer, auth)),
        totalElements,
        pageRequest,
      ),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 고객 등록. (FR-01, API 명세 5.2, TC-CUS-01·02)
 *
 * 담당 영업을 누구로 지정하든 허용한다. (이슈 #68) 등록은 남의 데이터를 고치는
 * 것이 아니라 새 데이터를 더하는 것이고, 상급자가 팀원 몫을 미리 등록하는 것도
 * 정상 업무다. 남을 담당으로 지정하면 등록자는 그 고객을 바로 수정할 수 없다 —
 * 수정 범위(`assertCustomerWritable`)는 담당자와 그 상급자뿐이다.
 */
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
      // 담당 영업 이름을 함께 읽는다. 이름만 읽는다(NFR-04).
      include: { assignedRep: { select: { name: true } } },
    });

    return apiSuccess(toCustomerResponse(created), 201);
  } catch (error) {
    return apiErrorResponse(mapCustomerWriteError(error));
  }
}
