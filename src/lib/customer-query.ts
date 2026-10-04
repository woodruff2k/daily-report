import type { Prisma } from "@prisma/client";
import { ValidationError } from "./errors";

/** 정렬 가능한 필드. 임의 컬럼명이 Prisma 로 넘어가지 않게 화이트리스트로 둔다. */
export const CUSTOMER_SORT_FIELDS = [
  "customerName",
  "companyName",
  "grade",
  "status",
  "createdAt",
] as const;

/**
 * 목록 조회 필터를 Prisma where 로 바꾼다. (API 명세 5.1)
 *
 * `keyword` 는 고객명과 회사명을 함께 본다. 대소문자는 구분하지 않는다.
 */
export function buildCustomerWhere(
  params: URLSearchParams,
): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};

  const keyword = params.get("keyword")?.trim();
  if (keyword) {
    where.OR = [
      { customerName: { contains: keyword, mode: "insensitive" } },
      { companyName: { contains: keyword, mode: "insensitive" } },
    ];
  }

  const assignedRepId = params.get("assignedRepId")?.trim();
  if (assignedRepId) {
    where.assignedRepId = parseIdParam(assignedRepId, "assignedRepId");
  }

  const grade = params.get("grade")?.trim();
  if (grade) {
    where.grade = grade;
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

/**
 * 문자열 식별자를 BigInt 로 바꾼다. 숫자가 아니거나 안전 정수를 넘으면 400.
 *
 * 응답으로 나갈 때 `toJsonId` 가 같은 범위를 요구하므로 입력에서 먼저 막는다.
 */
export function parseIdParam(raw: string, field: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError(`${field}는 숫자여야 합니다.`);
  }

  const id = BigInt(raw);

  if (id < 1n || id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError(`${field}가 허용 범위를 벗어났습니다.`);
  }

  return id;
}

/** 경로 파라미터의 customerId 를 BigInt 로 바꾼다. */
export function parseCustomerIdParam(raw: string): bigint {
  return parseIdParam(raw, "customerId");
}
