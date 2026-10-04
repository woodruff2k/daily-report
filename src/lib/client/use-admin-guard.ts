"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken, getStoredRep } from "./auth-storage";

/**
 * 관리자 전용 화면에서 권한 없는 사용자를 내보낸다. (이슈 #17)
 *
 * **접근통제가 아니다.** 서버가 모든 요청을 `assertRole` 로 검증하므로(NFR-01)
 * 이 훅을 우회해도 데이터는 보이지 않는다. 권한 없는 사용자에게 빈 화면과 403
 * 오류를 보여주는 대신 적절한 곳으로 보내는 것이 목적이다.
 *
 * 상태를 두지 않는다. 저장소는 브라우저에만 있어서 서버 렌더링 결과와 갈리고,
 * 그걸 상태로 들고 있으면 하이드레이션이 어긋난다. 화면은 평소처럼 그려지고
 * 데이터가 없으면 서버가 막는다.
 */
export function useAdminRedirect(): void {
  const router = useRouter();

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }

    if (getStoredRep()?.role !== "ADMIN") {
      router.replace("/reports");
    }
  }, [router]);
}
