import { signAccessToken } from "@/lib/jwt";
import type { Role } from "@/types/auth";

/**
 * 실제로 서명한 액세스 토큰을 `Authorization` 헤더로 만든다.
 *
 * `parseAuthContext` 가 헤더 대신 토큰 서명을 검증하므로(이슈 #102) 테스트도
 * 같은 경로를 탄다. 서명 키는 `vitest.config.ts` 가 주입하는 `TEST_JWT_SECRET`
 * 이다. 이 모듈은 `@/lib/jwt` 를 목으로 바꾸는 테스트에서 쓰지 않는다.
 */
export function bearerHeaders(
  repId: bigint | number | string,
  role: Role,
): Record<string, string> {
  const token = signAccessToken({
    repId: String(repId),
    name: "테스트사용자",
    role,
    mustChangePassword: false,
    tokenVersion: 0,
  });
  return { authorization: `Bearer ${token}` };
}
