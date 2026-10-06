import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";

// 로그아웃은 공개 경로가 아니다. 토큰을 무효화하려면 누구의 토큰인지
// 알아야 한다. (이슈 #52)
const PUBLIC_API_PATHS = ["/api/auth/login"];

/**
 * 임시 비밀번호 상태에서도 쓸 수 있는 경로. (이슈 #44)
 *
 * 비밀번호를 바꾸는 경로 자체와 로그아웃만 열어 둔다. 화면이 변경 폼으로
 * 보내주기를 기대하지 않고 서버에서 막는다. 화면 비표시는 접근통제가 아니다.
 */
const PASSWORD_CHANGE_ALLOWED_PATHS = ["/api/auth/logout", "/api/me/password"];

function unauthorized(message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code: "UNAUTHORIZED", message } },
    { status: 401 },
  );
}

/**
 * API 의 1차 관문. 조기 401, 서버측 무효화 검증, 임시 비밀번호 게이트를 맡는다.
 *
 * 사용자 정보를 헤더로 넘기지 않는다. 라우트의 `parseAuthContext` 가
 * `Authorization` 의 토큰 서명을 직접 검증한다. 클라이언트가 설정할 수 있는
 * 헤더를 신뢰 경계로 쓰면 프록시 우회 시 임의 사용자 위장이 되기 때문이다.
 * (이슈 #102)
 *
 * 무효화 검증(`tokenVersion`·`status`, DB 조회 1회)은 **여기에만** 둔다.
 * 라우트까지 같은 조회를 하면 요청당 2회가 된다. 프록시가 우회되면 무효화된
 * 토큰이 통과하지만, 그것도 유효하게 서명된 토큰을 가진 사람에 한한다.
 * 이 트레이드오프의 근거는 `src/lib/auth.ts` 의 `parseAuthContext` 주석에 있다.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_API_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return unauthorized("인증이 필요합니다.");
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return unauthorized("유효하지 않은 토큰입니다.");
  }

  // 서명이 유효해도 payload 형식까지 보장되지는 않는다. 숫자가 아닌 repId 를
  // BigInt 로 넘기면 예외가 나 500 이 된다. parseAuthContext 도 같은 지점을
  // 방어한다.
  let repId: bigint;
  try {
    repId = BigInt(payload.repId);
  } catch {
    return unauthorized("유효하지 않은 토큰입니다.");
  }

  // 서명과 만료만 보면 발급 후 상태 변화를 알 수 없다. 비밀번호 변경·재발급,
  // 비활성화, 역할 변경, 로그아웃은 tokenVersion 을 올리고, 여기서 그 값을
  // 비교해 지난 토큰을 거둬들인다. 요청마다 조회 1회가 드는 대가다. (이슈 #52)
  const rep = await prisma.salesRep.findUnique({
    where: { repId },
    select: { tokenVersion: true, status: true },
  });

  if (
    !rep ||
    rep.status !== "ACTIVE" ||
    rep.tokenVersion !== payload.tokenVersion
  ) {
    return unauthorized("유효하지 않은 토큰입니다.");
  }

  if (
    payload.mustChangePassword &&
    !PASSWORD_CHANGE_ALLOWED_PATHS.includes(pathname)
  ) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "임시 비밀번호를 변경한 뒤 이용할 수 있습니다.",
        },
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
