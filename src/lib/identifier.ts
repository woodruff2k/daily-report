/**
 * 식별자 변환 규칙. (이슈 #47)
 *
 * DB 는 식별자를 BigInt 로 다루고(`rep_id`, `customer_id`, `report_id`, ...)
 * API 명세는 JSON 숫자로 적는다(2.1, 6.2). 둘을 잇는 지점을 한곳에 모은다.
 *
 * `JSON.stringify` 는 BigInt 를 그대로 던지므로 변환은 선택이 아니라 필수다.
 * 엔드포인트마다 각자 변환하면 타입이 갈린다 — 실제로 로그인 응답은 문자열,
 * 영업 마스터 응답은 숫자로 나가 화면에서 `"1" !== 1` 이 되는 상태였다.
 */

/**
 * BigInt 식별자를 JSON 숫자로 바꾼다.
 *
 * 안전 정수 범위를 넘으면 던진다. `Number()` 는 조용히 정밀도를 잃는데,
 * 식별자에서 그것은 **다른 레코드를 가리키는 값**이 되어 나간다. 500 으로
 * 실패하는 편이 틀린 식별자를 응답하는 것보다 낫다.
 *
 * 참조로 들어오는 식별자는 입력 스키마(`idSchema`)가 미리 막으므로, 여기에
 * 걸리는 경우는 자동 증가 PK 가 2^53 을 넘은 때뿐이다.
 */
export function toJsonId(id: bigint): number {
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`식별자가 안전 정수 범위를 넘습니다: ${id}`);
  }
  return Number(id);
}

/** 선택 항목인 식별자를 바꾼다. `null` 은 그대로 둔다. */
export function toJsonIdOrNull(id: bigint | null): number | null {
  return id === null ? null : toJsonId(id);
}
