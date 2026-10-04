import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { lockAdminMutations } from "@/lib/advisory-lock";
import { assertRole, parseAuthContext } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { mapSalesRepWriteError } from "@/lib/prisma-errors";
import {
  assertManagerAssignable,
  assertNotLastActiveAdmin,
  toSalesRepResponse,
} from "@/lib/sales-rep";
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

    // 현재 값을 먼저 읽는다. 토큰 무효화 판단(#52)과 상급자 재검증 여부(#49)
    // 모두 바뀐 항목이 무엇인지에 달려 있다.
    const current = await prisma.salesRep.findUnique({
      where: { repId },
      select: { role: true, status: true, managerId: true },
    });

    if (!current) {
      throw new NotFoundError("영업사원을 찾을 수 없습니다.");
    }

    // 상급자가 바뀔 때만 검증한다. 매번 검증하면 상급자가 나중에 비활성화된
    // 사원은 이름·부서만 고치려는 요청까지 막힌다. (이슈 #49)
    const nextManagerId = managerId === undefined ? null : BigInt(managerId);

    if (nextManagerId !== null && nextManagerId !== current.managerId) {
      await assertManagerAssignable(nextManagerId, repId);
    }

    // 마지막 관리자 판정과 쓰기를 한 트랜잭션에 묶고 잠금으로 직렬화한다.
    // 상급자 검증(체인 추적)은 잠금 밖에 둔다 — 조회가 여러 번이라 잠금을
    // 오래 잡고, 그쪽 경합은 관리자 잠금과 다른 문제다. (이슈 #55)
    const updated = await prisma.$transaction(async (tx) => {
      await lockAdminMutations(tx);
      await assertNotLastActiveAdmin(tx, repId, {
        role: fields.role,
        status: fields.status,
      });

      // 역할·상태를 트랜잭션 안에서 다시 읽는다. 바깥에서 읽은 값으로
      // 토큰 무효화를 판단하면 그 사이의 변경을 놓친다. (이슈 #52)
      const locked = await tx.salesRep.findUnique({
        where: { repId },
        select: { role: true, status: true },
      });

      if (!locked) {
        throw new NotFoundError("영업사원을 찾을 수 없습니다.");
      }

      const revokeTokens =
        locked.role !== fields.role ||
        (locked.status !== fields.status && fields.status === "INACTIVE");

      return tx.salesRep.update({
        where: { repId },
        data: {
          ...fields,
          managerId: nextManagerId,
          tokenVersion: revokeTokens ? { increment: 1 } : undefined,
        },
      });
    });

    return apiSuccess(toSalesRepResponse(updated));
  } catch (error) {
    return apiErrorResponse(mapSalesRepWriteError(error));
  }
}
