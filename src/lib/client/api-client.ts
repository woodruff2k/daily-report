import { getAccessToken } from "./auth-storage";

/**
 * 공통 응답 구조(API 명세 1.2)를 다루는 fetch 래퍼. (이슈 #11)
 *
 * 화면이 `success`·`error` 를 매번 풀어보지 않도록 여기서 한 번만 한다.
 * **이동(리다이렉트)은 하지 않는다.** 401·403 을 받았을 때 어디로 보낼지는
 * 화면이 정한다 — 래퍼가 라우터를 들고 있으면 테스트가 라우터에 묶인다.
 */

export interface ApiError {
  code: string;
  message: string;
}

/** 서버가 공통 구조로 돌려준 오류. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = error.code;
  }
}

/** 임시 비밀번호를 바꿔야 해서 막힌 상태인지. (#44) */
export function isPasswordChangeRequired(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "PASSWORD_CHANGE_REQUIRED";
}

/** 토큰이 없거나 무효화된 상태인지. (#52) */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 로그인처럼 토큰 없이 부르는 요청. */
  anonymous?: boolean;
}

export async function apiFetch<T>(
  path: string,
  { method = "GET", body, anonymous = false }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (!anonymous) {
    const token = getAccessToken();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as {
    success: boolean;
    data: T | null;
    error: ApiError | null;
  } | null;

  if (!response.ok || !payload?.success) {
    throw new ApiClientError(
      response.status,
      payload?.error ?? { code: "UNKNOWN", message: "요청을 처리할 수 없습니다." }
    );
  }

  return payload.data as T;
}
