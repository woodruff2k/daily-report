"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";
import {
  getAccessToken,
  saveSession,
  type StoredRep,
} from "@/lib/client/auth-storage";
import { loginRequestSchema } from "@/schemas/auth";

interface LoginResponse {
  accessToken: string;
  rep: StoredRep;
  mustChangePassword: boolean;
}

/**
 * SCR-100 로그인.
 *
 * 인증 실패 사유를 구분해 알려주지 않는다. "이메일이 없음" 과 "비밀번호 오류" 를
 * 나누면 어느 아이디가 존재하는지 알려주게 된다. 서버도 같은 메시지를 쓴다.
 */
export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 이미 로그인한 상태로 들어오면 목록으로 보낸다.
  useEffect(() => {
    if (getAccessToken()) {
      router.replace("/reports");
    }
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = loginRequestSchema.safeParse({ loginId, password });
    if (!parsed.success) {
      setError("이메일/사번과 비밀번호를 입력하세요.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: parsed.data,
        anonymous: true,
      });

      saveSession(data.accessToken, data.rep);

      // 임시 비밀번호 상태면 비밀번호 변경으로 보낸다. 서버도 다른 API 를
      // 403 으로 막으므로(#44) 이 분기를 놓쳐도 접근통제는 유지된다.
      if (data.mustChangePassword) {
        router.replace("/password");
        return;
      }

      // 관리자는 SCR-200(본인 보고 목록)의 접근 권한이 없다(화면정의서 1).
      // 영업 마스터 목록으로 보낸다. (이슈 #17)
      router.replace(data.rep.role === "ADMIN" ? "/sales-reps" : "/reports");
    } catch {
      setError("이메일/사번 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm" noValidate>
        <h1 className="mb-6 text-center text-xl font-semibold">
          영업 일일 보고 시스템
        </h1>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="loginId">이메일/사번</FieldLabel>
            <Input
              id="loginId"
              name="loginId"
              autoComplete="username"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="password">비밀번호</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error === null ? null : (
            <FieldError role="alert">{error}</FieldError>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? "로그인 중…" : "로그인"}
          </Button>
        </FieldGroup>
      </form>
    </main>
  );
}
