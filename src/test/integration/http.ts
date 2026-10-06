import { NextRequest } from "next/server";
import type { SalesRep } from "@prisma/client";
import { signAccessToken } from "@/lib/jwt";

/**
 * 핸들러를 직접 호출하는 헬퍼.
 *
 * 프록시(`proxy.ts`)를 거치지 않고 라우트 핸들러만 부른다. 라우트의
 * `parseAuthContext` 가 `Authorization: Bearer` 토큰의 서명을 직접 검증하므로
 * (이슈 #102) 호출자마다 실제로 서명한 토큰을 단다. 프록시는
 * `proxy.integration.test.ts` 에서 응답 상태로 따로 검증한다. 두 계층을 나눠 둔 것이다.
 */
/** 호출자. 이 사원의 토큰을 서명해 단다. */
export type Actor = Pick<SalesRep, "repId" | "role">;

export interface CallOptions {
  /** 호출자. 생략하면 인증 헤더 없이 호출한다. */
  as?: Actor;
  /** 요청에 그대로 얹는 추가 헤더. 위조 헤더 테스트용이다. */
  headers?: Record<string, string>;
  /** `as` 대신 이 `Authorization` 값을 그대로 쓴다. 잘못된 토큰 테스트용이다. */
  authorization?: string;
  body?: unknown;
  query?: Record<string, string>;
  /** 라우트 경로 파라미터. */
  params?: Record<string, string | number | bigint>;
}

export interface CallResult<T = unknown> {
  status: number;
  /** 본문이 없으면(204) null. */
  body: T;
  raw: string;
}

type Handler = (
  request: NextRequest,
  context: { params: Promise<never> },
) => Promise<Response> | Response;

// 응답 본문은 테스트마다 모양이 달라 느슨하게 둔다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  handler: unknown,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const url = new URL(`http://localhost${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers = new Headers();
  if (options.authorization !== undefined) {
    headers.set("authorization", options.authorization);
  } else if (options.as) {
    const token = signAccessToken({
      repId: options.as.repId.toString(),
      name: "테스트사용자",
      role: options.as.role,
      mustChangePassword: false,
      tokenVersion: 0,
    });
    headers.set("authorization", `Bearer ${token}`);
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const request = new NextRequest(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const params = Object.fromEntries(
    Object.entries(options.params ?? {}).map(([k, v]) => [k, String(v)]),
  );
  const response = await (handler as Handler)(request, {
    params: Promise.resolve(params) as Promise<never>,
  });
  const raw = await response.text();

  return {
    status: response.status,
    body: (raw === "" ? null : JSON.parse(raw)) as T,
    raw,
  };
}

/** 실제 서명된 토큰을 만든다. 클레임은 덮어쓸 수 있다. */
export function tokenFor(
  rep: Pick<SalesRep, "repId" | "name" | "role" | "tokenVersion">,
  overrides: { mustChangePassword?: boolean; tokenVersion?: number } = {},
): string {
  return signAccessToken({
    repId: rep.repId.toString(),
    name: rep.name,
    role: rep.role,
    mustChangePassword: overrides.mustChangePassword ?? false,
    tokenVersion: overrides.tokenVersion ?? rep.tokenVersion,
  });
}
