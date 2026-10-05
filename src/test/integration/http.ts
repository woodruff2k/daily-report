import { NextRequest } from "next/server";
import type { SalesRep } from "@prisma/client";
import { signAccessToken } from "@/lib/jwt";

/**
 * 핸들러를 직접 호출하는 헬퍼.
 *
 * 인증 계층(`proxy.ts`)을 거치지 않고 프록시가 주입하는 `x-user-rep-id`·
 * `x-user-role` 헤더를 직접 세팅한다. `NextResponse.next({request:{headers}})` 에서
 * 주입된 헤더를 꺼내는 것은 Next 내부 구현에 의존해 깨지기 쉽다. 그래서 프록시는
 * `proxy.integration.test.ts` 에서 응답 상태로 따로 검증하고, 핸들러 TC 는 이
 * 헬퍼로 헤더를 세팅해 부른다. 두 계층을 나눠 둔 것이다.
 */
/** 호출자. 프록시가 주입하는 헤더의 원천이다. */
export type Actor = Pick<SalesRep, "repId" | "role">;

export interface CallOptions {
  /** 호출자. 생략하면 인증 헤더 없이 호출한다. */
  as?: Actor;
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
  if (options.as) {
    headers.set("x-user-rep-id", options.as.repId.toString());
    headers.set("x-user-role", options.as.role);
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

/** 프록시 검증용. 실제 서명된 토큰을 만든다. 클레임은 덮어쓸 수 있다. */
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
