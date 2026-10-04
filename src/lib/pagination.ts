import { ValidationError } from "./errors";

/** 정렬 방향. */
export type SortDirection = "asc" | "desc";

/** 목록 조회 요청의 페이지네이션·정렬 정보. (API 명세 1.3) */
export interface PageRequest {
  /** 0부터 시작하는 페이지 번호 */
  page: number;
  size: number;
  /** Prisma skip/take */
  skip: number;
  take: number;
  orderBy: Record<string, SortDirection>;
}

/** 목록 조회 응답 본문. (API 명세 1.3) */
export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

const DEFAULT_SIZE = 20;
const MAX_SIZE = 100;

function parseNonNegativeInt(
  raw: string | null,
  fallback: number,
  field: string,
): number {
  if (raw === null || raw === "") {
    return fallback;
  }

  // Number()는 "1.5"나 " 1 "도 통과시키므로 정수 표기만 받는다.
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError(`${field} 값이 올바르지 않습니다.`);
  }

  return Number(raw);
}

/**
 * `page`·`size`·`sort` 쿼리 파라미터를 Prisma 조회 조건으로 바꾼다.
 *
 * `sort`는 `필드명,방향` 형식(예: `name,asc`)이다. 정렬 가능한 필드를
 * 화이트리스트로 받는 이유는 임의 컬럼명이 그대로 Prisma에 넘어가면
 * 의도하지 않은 필드로 정렬되거나 오류가 나기 때문이다.
 *
 * 형식이 어긋나면 400으로 막는다. 조용히 기본값으로 되돌리면 호출자는
 * 자기 요청이 무시된 것을 모른다.
 */
export function parsePageRequest(
  params: URLSearchParams,
  allowedSortFields: readonly string[],
  defaultSort: Record<string, SortDirection>,
): PageRequest {
  const page = parseNonNegativeInt(params.get("page"), 0, "page");
  const size = parseNonNegativeInt(params.get("size"), DEFAULT_SIZE, "size");

  if (size < 1 || size > MAX_SIZE) {
    throw new ValidationError(`size는 1 이상 ${MAX_SIZE} 이하여야 합니다.`);
  }

  return {
    page,
    size,
    skip: page * size,
    take: size,
    orderBy: parseSort(params.get("sort"), allowedSortFields, defaultSort),
  };
}

function parseSort(
  raw: string | null,
  allowedSortFields: readonly string[],
  defaultSort: Record<string, SortDirection>,
): Record<string, SortDirection> {
  if (!raw) {
    return defaultSort;
  }

  const [field, direction = "asc"] = raw
    .split(",", 2)
    .map((part) => part.trim());

  if (!allowedSortFields.includes(field)) {
    throw new ValidationError(
      `sort 가능한 필드는 ${allowedSortFields.join(", ")} 입니다.`,
    );
  }

  if (direction !== "asc" && direction !== "desc") {
    throw new ValidationError("sort 방향은 asc 또는 desc 여야 합니다.");
  }

  return { [field]: direction };
}

/** 조회 결과를 공통 목록 응답 구조로 감싼다. */
export function pageResponse<T>(
  content: T[],
  totalElements: number,
  request: PageRequest,
): PageResponse<T> {
  return {
    content,
    page: request.page,
    size: request.size,
    totalElements,
    totalPages: Math.ceil(totalElements / request.size),
  };
}
