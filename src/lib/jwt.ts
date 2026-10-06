import jwt from "jsonwebtoken";
import type { AuthTokenPayload } from "@/types/auth";

const ACCESS_TOKEN_EXPIRES_IN = "8h";

/**
 * 설정 오류를 토큰 오류와 **구분할 수 있게** 전용 타입으로 던진다.
 *
 * 호출부가 `catch` 로 뭉개면 비밀이 주입되지 않은 배포가 모든 요청을 401 로 만든다
 * — 운영자는 "토큰이 전부 무효" 로 보고 원인을 엉뚱한 곳에서 찾고, 화면은 401 을
 * 세션 만료로 읽어 전원을 로그아웃시킨다. 명세 1.4 도 분류되지 않은 서버 오류를
 * 권한 오류로 바꾸지 말라고 적는다. (이슈 #102 검토)
 */
export class JwtConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtConfigError";
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new JwtConfigError("JWT_SECRET 환경 변수가 설정되지 않았습니다.");
  }
  return secret;
}

/**
 * 알고리즘을 **양쪽에서 고정한다**(이슈 #102).
 *
 * `jsonwebtoken` 9 는 비밀이 문자열이면 `alg=none` 을 거부하지만, **HS256 외의 HS
 * 계열(HS384·HS512)로 서명한 토큰은 받아들인다.** 지금은 비밀을 모르면 어떤 HS 로도
 * 서명할 수 없어 악용 경로가 없다. 그러나 고정해 두면
 *
 * - 비대칭 키로 바꾸는 날 HS/RS 혼동 공격의 여지가 애초에 없고,
 * - 검증이 받아들이는 입력 집합이 발급이 만드는 것과 정확히 같아진다.
 *
 * 비용이 인자 하나이고 되돌릴 이유가 없어 지금 넣는다.
 */
const ALGORITHM = "HS256" as const;

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: [ALGORITHM],
  }) as AuthTokenPayload;
}
