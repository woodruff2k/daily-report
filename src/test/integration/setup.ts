import { afterAll, beforeEach } from "vitest";
import { assertTestDatabaseUrl } from "./test-database";

/**
 * 통합 테스트 공통 설정. 테스트 파일보다 먼저 실행된다.
 *
 * import 순서에 의존하는 부분: `@/lib/prisma` 는 import 시점에 `new PrismaClient()` 로
 * `DATABASE_URL` 을 읽는다. DB 접속 문자열은 vitest.integration.config.ts 의
 * `test.env` 가 워커 시작 시 주입하므로, 이 파일이나 테스트 파일이 prisma 를 import
 * 하는 시점에는 이미 테스트 DB 로 바뀌어 있다. 그래도 여기서 prisma 를 정적 import
 * 하지 않고, 검사를 통과한 뒤 동적 import 한다.
 */

/** public 스키마의 모든 테이블을 한 문장으로 비운다. 마이그레이션 이력은 남긴다. */
async function truncateAllTables() {
  // TRUNCATE 보다 먼저, 매번 검사한다.
  assertTestDatabaseUrl(process.env.DATABASE_URL);

  const { prisma } = await import("@/lib/prisma");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) {
    throw new Error(
      "테스트 DB 에 테이블이 없습니다. 마이그레이션을 확인하세요.",
    );
  }

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

assertTestDatabaseUrl(process.env.DATABASE_URL);

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
});
