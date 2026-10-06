import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { TEST_JWT_SECRET } from "./src/test/integration/test-database";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // parseAuthContext 가 토큰 서명을 검증하므로(이슈 #102) 단위 테스트에도 서명 키가
    // 필요하다. 통합 설정(vitest.integration.config.ts)과 같은 상수를 쓴다 — 비밀이
    // 두 곳에 있으면 어느 쪽이 맞는지 헷갈린다. setup.ts 가 아니라 설정에 두는 이유:
    // 워커가 뜰 때 환경에 들어가 import 순서와 무관하고, 통합 설정과 나란히 보인다.
    env: { JWT_SECRET: TEST_JWT_SECRET },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // 통합 테스트는 실제 DB 가 필요해 npm run test:integration 으로 분리한다.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/**/*.{test,spec}.{ts,tsx}"],
      // 하한이다. **큰 후퇴만 막고 작은 변동은 통과시킨다.**
      //
      // 측정값(2026-10-06): statements 91.89 / branches 87.91 / functions 87.97 /
      // lines 92.54. 여기서 약 2점씩 내려 잡았다. 내림값에 딱 붙여 두면 무관한 PR 이
      // 깨진다 — functions 는 87 로 두면 테스트 없는 함수 5개에 CI 가 멈추고, 그때
      // 나오는 오류는 그 PR 과 상관없어 보인다. 지금 값이면 각각 58·32·17·49개까지
      // 견디므로 작은 모듈 하나를 테스트 없이 추가해도 통과하고, 큰 후퇴는 막는다.
      //
      // 높은 목표를 박지 않는다 — 숫자를 맞추려는 단언 없는 테스트가 생기고,
      // 커버리지는 "실행됐다" 만 말한다(이슈 #93). 수치가 올랐다고 임계값을 따라
      // 올리지 않아도 되고, 올린다면 올라간 이유가 의미 있는 테스트일 때만이다.
      // 통합 테스트는 합산하지 않는다(이유는 이슈 #93 보고 참조).
      thresholds: {
        statements: 89,
        branches: 85,
        functions: 85,
        lines: 90,
      },
    },
  },
});
