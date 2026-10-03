import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertRole, parseAuthContext } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { pageResponse, parsePageRequest } from "@/lib/pagination";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { mapSalesRepWriteError } from "@/lib/prisma-errors";
import { assertManagerExists, toSalesRepResponse } from "@/lib/sales-rep";
import {
  SALES_REP_SORT_FIELDS,
  buildSalesRepWhere,
} from "@/lib/sales-rep-query";
import { salesRepCreateSchema } from "@/schemas/sales-rep";

/**
 * 영업 마스터 목록. (FR-02, API 명세 6.1)
 *
 * 관리자 전용이다. 영업사원·상급자가 호출하면 403으로 막는다. (TC-SEC-03)
 */
export async function GET(request: NextRequest) {
  try {
    assertRole(parseAuthContext(request.headers), "ADMIN");

    const params = request.nextUrl.searchParams;
    const pageRequest = parsePageRequest(params, SALES_REP_SORT_FIELDS, {
      createdAt: "desc",
    });
    const where = buildSalesRepWhere(params);

    const [reps, totalElements] = await Promise.all([
      prisma.salesRep.findMany({
        where,
        skip: pageRequest.skip,
        take: pageRequest.take,
        orderBy: pageRequest.orderBy,
      }),
      prisma.salesRep.count({ where }),
    ]);

    return apiSuccess(
      pageResponse(reps.map(toSalesRepResponse), totalElements, pageRequest)
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 영업 마스터 등록. (FR-02, API 명세 6.2)
 *
 * 사번·이메일이 중복이면 409다. (TC-REP-02)
 * `managerId`를 주면 자기참조 상급자 관계로 저장한다. (TC-REP-03)
 */
export async function POST(request: NextRequest) {
  try {
    assertRole(parseAuthContext(request.headers), "ADMIN");

    const parsed = salesRepCreateSchema.safeParse(
      await request.json().catch(() => null)
    );

    if (!parsed.success) {
      throw new ValidationError("필수 항목이 누락되었거나 형식이 올바르지 않습니다.");
    }

    const { password, managerId, ...fields } = parsed.data;

    if (managerId !== undefined) {
      await assertManagerExists(BigInt(managerId));
    }

    const created = await prisma.salesRep.create({
      data: {
        ...fields,
        managerId: managerId === undefined ? null : BigInt(managerId),
        // 비밀번호를 받지 않았으면 아무도 모르는 값으로 채운다. 고정값을 두면
        // 등록된 계정 전체가 같은 비밀번호로 로그인 가능해진다.
        passwordHash: await hashPassword(
          password ?? randomBytes(32).toString("hex")
        ),
      },
    });

    return apiSuccess(toSalesRepResponse(created), 201);
  } catch (error) {
    return apiErrorResponse(mapSalesRepWriteError(error));
  }
}
