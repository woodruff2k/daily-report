import type { Role } from "@prisma/client";

export type { Role };

export interface AuthTokenPayload {
  repId: string;
  name: string;
  role: Role;
  /**
   * 임시 비밀번호 상태. true 면 프록시가 비밀번호 변경 외의 API 를 막는다.
   * 토큰에 담는 이유는 요청마다 DB 를 보지 않고 프록시에서 판정하기 위함이다.
   * 비밀번호를 바꾸면 새 토큰이 발급된다. (이슈 #44)
   */
  mustChangePassword: boolean;
  /**
   * 발급 시점의 `SalesRep.tokenVersion`. 프록시가 DB 값과 비교해 다르면
   * 무효화된 토큰으로 보고 401 로 막는다. (이슈 #52)
   */
  tokenVersion: number;
}
