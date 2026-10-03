import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/jwt";

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout"];

/**
 * 임시 비밀번호 상태에서도 쓸 수 있는 경로. (이슈 #44)
 *
 * 비밀번호를 바꾸는 경로 자체와 로그아웃만 열어 둔다. 화면이 변경 폼으로
 * 보내주기를 기대하지 않고 서버에서 막는다. 화면 비표시는 접근통제가 아니다.
 */
const PASSWORD_CHANGE_ALLOWED_PATHS = ["/api/auth/logout", "/api/me/password"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_API_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return NextResponse.json(
      { success: false, data: null, error: { code: "UNAUTHORIZED", message: "인증이 필요합니다." } },
      { status: 401 }
    );
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return NextResponse.json(
      { success: false, data: null, error: { code: "UNAUTHORIZED", message: "유효하지 않은 토큰입니다." } },
      { status: 401 }
    );
  }

  if (payload.mustChangePassword && !PASSWORD_CHANGE_ALLOWED_PATHS.includes(pathname)) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "임시 비밀번호를 변경한 뒤 이용할 수 있습니다.",
        },
      },
      { status: 403 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-rep-id", payload.repId);
  requestHeaders.set("x-user-role", payload.role);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: "/api/:path*",
};
