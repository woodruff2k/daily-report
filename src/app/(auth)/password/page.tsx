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
import { ApiClientError, apiFetch } from "@/lib/client/api-client";
import { getAccessToken, replaceAccessToken } from "@/lib/client/auth-storage";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

interface PasswordChangeResponse {
  accessToken: string;
}

/**
 * SCR-110 비밀번호 변경.
 *
 * 임시 비밀번호 상태를 푸는 유일한 경로다. (이슈 #44, #57)
 *
 * 성공 시 **응답의 새 토큰으로 기존 토큰을 교체해야 한다.** 기존 토큰에는
 * `mustChangePassword` 가 true 로, `tokenVersion` 이 이전 값으로 박혀 있어
 * 그대로 쓰면 이후 모든 요청이 401 이 된다(#52).
 */
export default function PasswordChangePage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
    }
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      return;
    }

    // 확인 입력은 화면에서만 본다. 서버는 받지 않는다.
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch<PasswordChangeResponse>("/api/me/password", {
        method: "PUT",
        body: { currentPassword, newPassword },
      });

      replaceAccessToken(data.accessToken);
      router.replace("/reports");
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "비밀번호를 변경할 수 없습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm" noValidate>
        <h1 className="mb-2 text-center text-xl font-semibold">
          비밀번호 변경
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          임시 비밀번호를 바꾸기 전에는 다른 기능을 쓸 수 없습니다.
        </p>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="currentPassword">현재 비밀번호</FieldLabel>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="newPassword">새 비밀번호</FieldLabel>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="confirmPassword">새 비밀번호 확인</FieldLabel>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>

          {error === null ? null : (
            <FieldError role="alert">{error}</FieldError>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? "변경 중…" : "변경"}
          </Button>
        </FieldGroup>
      </form>
    </main>
  );
}
