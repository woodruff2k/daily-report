import { execFileSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "./test-database";

/**
 * 전체 실행 전에 한 번, 테스트 DB 스키마를 마이그레이션에 맞춘다.
 * 테스트마다 `migrate reset` 하지 않는다(느리다). 데이터 비우기는 setup.ts 가 한다.
 *
 * DB 이름 검사가 `migrate deploy` 보다 먼저다(`resolveTestDatabaseUrl`).
 * Prisma CLI 에는 검사된 URL 을 명시적으로 넘긴다 — 셸 환경의 DATABASE_URL 이
 * 개발 DB 를 가리켜도 그쪽에 마이그레이션이 적용되지 않는다.
 */
export default function setup() {
  const databaseUrl = resolveTestDatabaseUrl();

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}
