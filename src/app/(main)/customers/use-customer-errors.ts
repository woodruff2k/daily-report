"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isUnauthorized } from "@/lib/client/api-client";
import { clearSession, getAccessToken } from "@/lib/client/auth-storage";
import { customerErrorMessage } from "@/lib/client/customer-api";

/**
 * 고객 화면의 공통 가드·오류 처리. (이슈 #16)
 *
 * `useAdminRedirect` 를 쓰지 않는다 — 그것은 ADMIN 전용 화면용이고 고객 화면은
 * 영업사원·상급자용이라 반대다. 역할로 가르지 않고 토큰 유무만 본다.
 *
 * **접근통제가 아니다.** 관리자가 들어와도 서버가 고객 API 를 403 으로 막으므로
 * 데이터는 보이지 않는다. 403 은 이동시키지 않고 메시지만 보여준다.
 *
 * 401 은 서버가 세션을 끊은 상태다. 저장된 토큰을 지우고 로그인으로 보낸다.
 */
export function useCustomerErrors() {
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
      return customerErrorMessage(caught, fallback);
    },
    [router],
  );
}
