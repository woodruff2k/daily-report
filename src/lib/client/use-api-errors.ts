"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isUnauthorized } from "@/lib/client/api-client";
import { clearSession, getAccessToken } from "@/lib/client/auth-storage";

/**
 * 영업사원·상급자 화면의 공통 가드·오류 처리. (이슈 #12)
 *
 * 고객 화면(#16)에서 먼저 만들었고, 보고 화면(#12·#13·#14·#15)도 똑같이 필요해
 * 도메인마다 복제하지 않도록 공용으로 옮겼다. 도메인별 문장은 `toMessage` 로
 * 받는다 — 문장은 도메인 파일(`customer-api.ts`, `report-api.ts`)에 있다.
 *
 * `useAdminRedirect` 를 쓰지 않는다 — 그것은 ADMIN 전용 화면용이다. 역할로 가르지
 * 않고 토큰 유무만 본다.
 *
 * **접근통제가 아니다.** 관리자가 들어와도 서버가 403 으로 막으므로 데이터는
 * 보이지 않는다. 403 은 이동시키지 않고 메시지만 보여준다.
 *
 * 401 은 서버가 세션을 끊은 상태다. 저장된 토큰을 지우고 로그인으로 보낸다.
 *
 * `toMessage` 는 모듈 수준 함수를 넘겨야 한다. 렌더마다 새 함수를 주면 반환하는
 * 콜백이 매번 바뀌어 그것을 의존성으로 쓰는 효과가 다시 돈다.
 */
export function useApiErrors(
  toMessage: (caught: unknown, fallback: string) => string,
) {
  const router = useRouter();

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
    }
  }, [router]);

  /** 오류를 화면에 보여줄 문장으로 바꾼다. 401 이면 로그인으로 보낸다. */
  return useCallback(
    (caught: unknown, fallback: string): string => {
      if (isUnauthorized(caught)) {
        clearSession();
        router.replace("/login");
      }
      return toMessage(caught, fallback);
    },
    [router, toMessage],
  );
}
