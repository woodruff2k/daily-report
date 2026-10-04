import type { Prisma } from "@prisma/client";
import { ValidationError } from "./errors";

/** 정렬 가능한 필드. 임의 컬럼명이 Prisma로 넘어가지 않게 화이트리스트로 둔다. */
export const SALES_REP_SORT_FIELDS = [
  "empNo",
  "name",
  "department",
  "status",
  "createdAt",
] as const;

/**
 * 목록 조회 필터를 Prisma where 로 바꾼다. (API 명세 6.1)
 *
 * `keyword`는 이름과 사번을 함께 본다. 화면(SCR-500)의 검색 조건이 "이름/사번"
 * 한 칸이기 때문이다. 대소문자는 구분하지 않는다.
 */
export function buildSalesRepWhere(
  params: URLSearchParams,
): Prisma.SalesRepWhereInput {
  const where: Prisma.SalesRepWhereInput = {};

  const keyword = params.get("keyword")?.trim();
  if (keyword) {
    where.OR = [
      { name: { contains: keyword, mode: "insensitive" } },
      { empNo: { contains: keyword, mode: "insensitive" } },
    ];
  }

  const department = params.get("department")?.trim();
  if (department) {
    where.department = department;
  }

  // 상급자 Select 는 MANAGER 만 골라야 한다(SCR-510). 전부 받아 화면에서
  // 거르면 페이지네이션에 걸려 빠지는 사원이 생긴다. (이슈 #17)
  const role = params.get("role")?.trim();
  if (role) {
    if (role !== "SALES_REP" && role !== "MANAGER" && role !== "ADMIN") {
      throw new ValidationError(
        "role은 SALES_REP, MANAGER, ADMIN 중 하나여야 합니다.",
      );
    }
    where.role = role;
  }

  const status = params.get("status")?.trim();
  if (status) {
    if (status !== "ACTIVE" && status !== "INACTIVE") {
      throw new ValidationError("status는 ACTIVE 또는 INACTIVE 여야 합니다.");
    }
    where.status = status;
  }

  return where;
}

/** 경로 파라미터의 repId를 BigInt로 바꾼다. 숫자가 아니면 400. */
export function parseRepIdParam(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError("repId는 숫자여야 합니다.");
  }
  return BigInt(raw);
}
