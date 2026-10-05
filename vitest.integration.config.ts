import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import {
  TEST_JWT_SECRET,
  resolveTestDatabaseUrl,
} from "./src/test/integration/test-database";

// 통합 테스트 설정. 실제 PostgreSQL(테스트 전용 DB)에 붙어 목 없이 검증한다.
// `npm test` 와 분리한 이유: DB 가 없는 환경과 CI 의 단위 테스트 단계가 깨지지 않게 한다.
//
// 설정 파일을 읽는 시점에 DB 이름 검사가 돈다(`resolveTestDatabaseUrl`).
// `_test` 로 끝나지 않으면 테스트를 시작하기 전에 여기서 실패한다.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./src/test/integration/global-setup.ts"],
    setupFiles: ["./src/test/integration/setup.ts"],
    // @/lib/prisma 가 import 시점에 읽는 값이라 워커 시작 시 주입한다.
    // 셸에 DATABASE_URL 이 있어도(개발 DB 일 수 있다) 이 값이 덮어쓴다.
    env: {
      DATABASE_URL: resolveTestDatabaseUrl(),
      JWT_SECRET: TEST_JWT_SECRET,
    },
    // 모든 테스트 파일이 한 DB 를 공유하고 각 테스트 전에 전체 테이블을 TRUNCATE 한다.
    // 파일을 병렬로 돌리면 한 파일의 TRUNCATE 가 다른 파일이 방금 만든 데이터를 지운다.
    // 그래서 파일은 직렬로 돌린다. 동시성 테스트는 한 테스트 안에서 요청 둘을
    // 동시에 띄워 검증한다.
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
