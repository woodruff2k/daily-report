/**
 * 통합 테스트 DB 접속 정보와 안전장치.
 *
 * 통합 테스트는 매 테스트 전에 모든 테이블을 TRUNCATE 한다. 설정이 어긋나 개발
 * DB(`daily_report`)를 가리키면 개발 데이터가 사라진다. 그래서 접속 문자열을
 * 해석하는 곳(설정 파일, globalSetup, setup 파일, TRUNCATE 직전)마다
 * `assertTestDatabaseUrl` 을 먼저 통과시킨다. 통과하지 못하면 즉시 던진다.
 */

/**
 * 로컬 docker-compose 의 PostgreSQL(고정 포트 5433, 고정 자격증명)을 가리키는
 * 기본값이다. 이 자격증명은 이미 `docker-compose.yml` 에 평문으로 있는 로컬 전용
 * 값이고, DB 이름이 `_test` 로 끝나 개발 DB 와 분리된다. 운영 자격증명이 아니다.
 * CI 나 다른 환경은 `DATABASE_URL_TEST` 로 덮어쓴다.
 */
const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5433/daily_report_test?schema=public";

/** 테스트 전용 더미 서명 키. 실제 시크릿이 아니다. */
export const TEST_JWT_SECRET = "integration-test-only-jwt-secret-not-a-secret";

export function resolveTestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.DATABASE_URL_TEST || DEFAULT_TEST_DATABASE_URL;
  assertTestDatabaseUrl(url);
  return url;
}

/**
 * DB 이름이 `_test` 로 끝나는 PostgreSQL 접속 문자열만 허용한다.
 * 전체 문자열이 아니라 DB 이름만 본다 — 비밀번호나 호스트에 `_test` 가 들어 있다고
 * 통과시키면 안전장치가 아니다. 오류 메시지에는 접속 문자열을 담지 않는다.
 */
export function assertTestDatabaseUrl(url: string | undefined): void {
  if (!url) {
    throw new Error("통합 테스트 DB 접속 문자열이 비어 있습니다.");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  } catch {
    throw new Error("통합 테스트 DB 접속 문자열을 해석할 수 없습니다.");
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `통합 테스트는 이름이 "_test" 로 끝나는 DB 에서만 실행합니다. (현재 DB: "${databaseName}") 개발 DB 데이터 보호를 위해 중단합니다.`,
    );
  }
}
