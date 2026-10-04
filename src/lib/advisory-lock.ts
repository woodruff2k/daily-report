import type { DbClient } from "./prisma";

/**
 * 관리자 역할·상태 변경을 직렬화하는 권고 잠금 키. (이슈 #55)
 *
 * 값 자체에 의미는 없다. 같은 키를 쓰는 트랜잭션끼리만 줄을 선다.
 */
const ADMIN_MUTATION_LOCK_KEY = 55;

/**
 * 관리자 역할·상태를 바꾸는 트랜잭션을 직렬화한다.
 *
 * "마지막 활성 관리자" 판정은 count 를 읽고 쓰기 때문에, 판정과 쓰기 사이에
 * 다른 요청이 끼면 둘 다 통과해 관리자가 0명이 될 수 있다.
 *
 * ```
 * 요청1: A 강등 → count(A 제외)=1 → 통과
 * 요청2: B 강등 → count(B 제외)=1 → 통과
 * 요청1·2: update → ADMIN 0명
 * ```
 *
 * 직렬화 트랜잭션(Serializable)도 방법이지만 재시도 처리가 따라온다. 이 경합은
 * "관리자 역할·상태 변경" 이라는 좁은 경로에만 있고 빈도가 낮아, 그 경로만
 * 잠금으로 줄 세우는 편이 변경 범위가 작고 추론하기 쉽다.
 *
 * `pg_advisory_xact_lock` 은 트랜잭션이 끝나면 자동으로 풀린다. 명시적 해제가
 * 없어 예외 경로에서 잠금이 남지 않는다.
 */
export async function lockAdminMutations(tx: DbClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_MUTATION_LOCK_KEY})`;
}
