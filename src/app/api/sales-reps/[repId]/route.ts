import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { assertRole, parseAuthContext } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapSalesRepWriteError } from "@/lib/prisma-errors";
import { assertManagerExists, toSalesRepResponse } from "@/lib/sales-rep";
import { parseRepIdParam } from "@/lib/sales-rep-query";
import { salesRepUpdateSchema } from "@/schemas/sales-rep";

interface RouteContext {
  params: Promise<{ repId: string }>;
}

/** 영업 마스터 상세. (API 명세 6.3) 관리자 전용. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    assertRole(parseAuthContext(request.headers), "ADMIN");

    const repId = parseRepIdParam((await context.params).repId);
    const rep = await prisma.salesRep.findUnique({ where: { repId } });

    if (!rep) {
      throw new NotFoundError("영업사원을 찾을 수 없습니다.");
    }

    return apiSuccess(toSalesRepResponse(rep));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * 영업 마스터 수정. (API 명세 6.3) 관리자 전용.
 *
 * 비밀번호는 이 경로로 바꾸지 않는다. 입력 스키마에서 제외되어 있어
 * 요청에 섞여 들어와도 무시된다.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    assertRole(parseAuthContext(request.headers), "ADMIN");

    const repId = parseRepIdParam((await context.params).repId);
    const parsed = salesRepUpdateSchema.safeParse(
      await request.json().catch(() => null)
    );

    if (!parsed.success) {
      throw new ValidationError("필수 항목이 누락되었거나 형식이 올바르지 않습니다.");
    }

    const { managerId, ...fields } = parsed.data;

    if (managerId !== undefined) {
      await assertManagerExists(BigInt(managerId), repId);
    }

    const updated = await prisma.salesRep.update({
      where: { repId },
      data: {
        ...fields,
        managerId: managerId === undefined ? null : BigInt(managerId),
      },
    });

    return apiSuccess(toSalesRepResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapSalesRepWriteError(error));
  }
}
