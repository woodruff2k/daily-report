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
  /**
   * Prisma `orderBy`. **항상 2원소다** — 요청한 정렬 뒤에 식별자 보조 키가 붙는다.
   *
   * SQL 은 동순위 행 사이의 순서를 보장하지 않는다. `skip`/`take` 로 쪽을 자르면
   * 같은 행이 두 쪽에 나오거나 어떤 행이 어느 쪽에도 안 나온다. 정렬 가능 필드에
   * `status`(두 가지)·`grade`(세 가지)·`department` 처럼 값 종류가 적은 것이 있어
   * **그 필드로 정렬하면 거의 모든 행이 동순위**이고, 흔들림이 기본 동작이 된다.
   *
   * 보조 키를 호출부가 아니라 **여기서 붙인다.** 호출부에 맡겼더니 네 라우트 중
   * 셋이 빠뜨린 채로 배포됐다(이슈 #95). 새 목록 라우트가 같은 실수를 반복할 수
   * 없게 구조로 보장한다.
   */
  orderBy: [Record<string, SortDirection>, Record<string, SortDirection>];
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
  /**
   * 동순위 보조 키로 쓸 식별자 필드(기본키). `orderBy` 의 두 번째 원소가 된다.
   * 방향은 `desc` 로 고정한다 — 1차 정렬과 무관하게 **안정성만** 보장하면 되고,
   * 네 라우트의 기본 정렬이 모두 최신순이라 그쪽과도 어울린다.
   */
  idField: string,
): PageRequest {
  // 정렬 가능 필드에 식별자가 있으면 `[{id:"asc"},{id:"desc"}]` 처럼 같은 컬럼이
  // 두 번 들어가 뒤의 것이 무시된다. 지금은 어느 목록도 식별자를 정렬 대상으로
  // 두지 않지만, 넣으면 보조 키가 조용히 죽으므로 여기서 막는다.
  if (allowedSortFields.includes(idField)) {
    throw new Error(
      `정렬 가능 필드에 보조 키(${idField})를 넣을 수 없다. 보조 키가 무시된다.`,
    );
  }

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
    orderBy: [
      parseSort(params.get("sort"), allowedSortFields, defaultSort),
      { [idField]: "desc" },
    ],
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
