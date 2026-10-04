import type { Prisma } from "@prisma/client";
import { dateOnlySchema } from "@/schemas/report";
import { ValidationError } from "./errors";
import { parseIdParam } from "./customer-query";
import { toDbDate } from "./report";

/** 정렬 가능한 필드. 임의 컬럼명이 Prisma 로 넘어가지 않게 화이트리스트로 둔다. */
export const REPORT_SORT_FIELDS = [
  "reportDate",
  "status",
  "createdAt",
  "updatedAt",
] as const;

function parseDateParam(raw: string, field: string): Date {
  const parsed = dateOnlySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`${field}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  return toDbDate(parsed.data);
}

/**
 * 본인 보고 목록의 조회 조건을 만든다. (API 명세 3.1)
 *
 * `repId` 는 쿼리 파라미터가 아니라 인증 컨텍스트에서 받는다. 호출자가 다른
 * 사원의 보고를 목록으로 훑을 수 있는 경로를 열어 두지 않는다. (IDOR)
 * 기간은 양끝을 포함한다.
 */
export function buildReportWhere(
  params: URLSearchParams,
  repId: bigint,
): Prisma.DailyReportWhereInput {
  const where: Prisma.DailyReportWhereInput = { repId };

  const fromRaw = params.get("fromDate")?.trim();
  const toRaw = params.get("toDate")?.trim();
  const from = fromRaw ? parseDateParam(fromRaw, "fromDate") : null;
  const to = toRaw ? parseDateParam(toRaw, "toDate") : null;

  if (from && to && from > to) {
    throw new ValidationError("fromDate 는 toDate 보다 늦을 수 없습니다.");
  }

  if (from || to) {
    where.reportDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const status = params.get("status")?.trim();
  if (status) {
    if (status !== "DRAFT" && status !== "SUBMITTED") {
      throw new ValidationError("status는 DRAFT 또는 SUBMITTED 여야 합니다.");
    }
    where.status = status;
  }

  return where;
}

/** 경로 파라미터의 reportId 를 BigInt 로 바꾼다. */
export function parseReportIdParam(raw: string): bigint {
  return parseIdParam(raw, "reportId");
}
