import type { Prisma } from "@prisma/client";
import { idSchema } from "@/schemas/identifier";
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
 * 기간·상태 필터. 본인 목록과 팀 목록이 공유한다. (API 명세 3.1, 3.7)
 * 기간은 양끝을 포함한다.
 */
function buildReportFilters(
  params: URLSearchParams,
): Pick<Prisma.DailyReportWhereInput, "reportDate" | "status"> {
  const filters: Pick<Prisma.DailyReportWhereInput, "reportDate" | "status"> =
    {};

  const fromRaw = params.get("fromDate")?.trim();
  const toRaw = params.get("toDate")?.trim();
  const from = fromRaw ? parseDateParam(fromRaw, "fromDate") : null;
  const to = toRaw ? parseDateParam(toRaw, "toDate") : null;

  if (from && to && from > to) {
    throw new ValidationError("fromDate 는 toDate 보다 늦을 수 없습니다.");
  }

  if (from || to) {
    filters.reportDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const status = params.get("status")?.trim();
  if (status) {
    if (status !== "DRAFT" && status !== "SUBMITTED") {
      throw new ValidationError("status는 DRAFT 또는 SUBMITTED 여야 합니다.");
    }
    filters.status = status;
  }

  return filters;
}

/**
 * 본인 보고 목록의 조회 조건을 만든다. (API 명세 3.1)
 *
 * `repId` 는 쿼리 파라미터가 아니라 인증 컨텍스트에서 받는다. 호출자가 다른
 * 사원의 보고를 목록으로 훑을 수 있는 경로를 열어 두지 않는다. (IDOR)
 */
export function buildReportWhere(
  params: URLSearchParams,
  repId: bigint,
): Prisma.DailyReportWhereInput {
  return { repId, ...buildReportFilters(params) };
}

/**
 * `repIds` 쿼리 파라미터를 파싱한다. (API 명세 3.7)
 *
 * 반복 형식(`?repIds=1&repIds=2`)과 콤마 구분(`?repIds=1,2`)을 모두 받고 섞어
 * 써도 된다. 화면·클라이언트 라이브러리마다 배열 직렬화가 달라 한쪽만 받으면
 * 조용히 첫 값만 읽히는 사고가 나기 때문이다. 중복은 합친다.
 *
 * 값 전체가 빈 문자열(`?repIds=`)이면 "미지정"이다. 콤마 사이의 빈 조각(`1,,2`)과
 * 숫자가 아닌 값, 안전 정수 범위 밖은 400 이다. 과대 요청을 막으려 개수 상한을 둔다.
 */
const MAX_REP_IDS = 100;

export function parseRepIdsParam(params: URLSearchParams): bigint[] {
  const ids = new Map<string, bigint>();

  for (const raw of params.getAll("repIds")) {
    const value = raw.trim();
    if (value === "") {
      continue;
    }
    for (const token of value.split(",")) {
      const parsed = idSchema.safeParse(
        /^\d+$/.test(token.trim()) ? Number(token.trim()) : Number.NaN,
      );
      if (!parsed.success) {
        throw new ValidationError("repIds는 유효한 식별자 목록이어야 합니다.");
      }
      ids.set(String(parsed.data), BigInt(parsed.data));
    }
  }

  if (ids.size > MAX_REP_IDS) {
    throw new ValidationError(`repIds는 ${MAX_REP_IDS}개 이하여야 합니다.`);
  }

  return [...ids.values()];
}

/**
 * 팀 보고 목록의 조회 조건을 만든다. (API 명세 3.7)
 *
 * `repIds` 는 이미 `assertTeamScope` 를 통과한 배열이어야 한다. 이 함수는 범위를
 * 검증하지 않는다.
 *
 * `customerId` 는 "그 고객을 방문한 보고"다. 방문기록(`visits`)만 본다. 과제·계획의
 * 고객은 보지 않는다 — 명세가 "방문 고객 기준"이라고 적었다.
 */
export function buildTeamReportWhere(
  params: URLSearchParams,
  repIds: readonly bigint[],
): Prisma.DailyReportWhereInput {
  const where: Prisma.DailyReportWhereInput = {
    repId: { in: [...repIds] },
    ...buildReportFilters(params),
  };

  const customerId = params.get("customerId")?.trim();
  if (customerId) {
    where.visits = {
      some: { customerId: parseIdParam(customerId, "customerId") },
    };
  }

  return where;
}

/** 경로 파라미터의 reportId 를 BigInt 로 바꾼다. */
export function parseReportIdParam(raw: string): bigint {
  return parseIdParam(raw, "reportId");
}
