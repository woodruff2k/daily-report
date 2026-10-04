"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api-client";
import { clearSession, getStoredRep, type StoredRep } from "@/lib/client/auth-storage";

/**
 * 공통 헤더. 로그인한 사용자와 로그아웃을 둔다. (이슈 #17)
 *
 * 메뉴는 역할에 따라 다르게 보여주지만 **접근통제가 아니다.** 서버가 모든
 * 요청을 검증한다(NFR-01).
 */
export default function AppHeader() {
  const router = useRouter();
  const [rep, setRep] = useState<StoredRep | null>(null);

  // 저장소는 브라우저에만 있다. 서버 렌더링 결과와 갈리지 않도록 마운트 뒤에
  // 읽는다. await 뒤에 상태를 바꿔 효과 본문의 동기 setState 를 피한다.
  useEffect(() => {
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (!cancelled) {
        setRep(getStoredRep());
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    // 서버가 토큰을 무효화한다(#52). 실패해도 로컬 세션은 지운다.
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    clearSession();
    router.replace("/login");
  }

  return (
    <header className="flex items-center justify-between border-b px-8 py-4">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/reports" className="font-semibold">
          영업 일일 보고
        </Link>
        {rep?.role === "ADMIN" ? <Link href="/sales-reps">영업 마스터</Link> : null}
        {rep?.role === "MANAGER" ? <Link href="/team">팀 보고</Link> : null}
        <Link href="/customers">고객</Link>
      </nav>

      <div className="flex items-center gap-3 text-sm">
        {rep === null ? null : <span>{rep.name}</span>}
        <Button type="button" variant="ghost" size="sm" onClick={() => void handleLogout()}>
          로그아웃
        </Button>
      </div>
    </header>
  );
}
