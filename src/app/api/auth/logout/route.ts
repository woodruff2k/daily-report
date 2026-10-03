import type { NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api-response";
import { parseAuthContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * 로그아웃. (TC-AUTH-05)
 *
 * 토큰 버전을 올려 발급된 토큰을 무효화한다. 이전에는 204 만 반환하고 서버는
 * 아무것도 하지 않아, 클라이언트가 토큰을 버리는 것에만 의존했다. 테스트 명세
 * TC-AUTH-05 의 "토큰 무효화" 를 실제로 수행한다. (이슈 #52)
 *
 * 그래서 인증이 필요해졌다. 누구의 토큰을 거둘지 알아야 한다.
 *
 * 같은 계정의 **모든 기기** 세션이 함께 끊긴다. 기기별 종료가 필요하면
 * 버전 하나로는 부족하고 세션 식별자가 필요하다.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = parseAuthContext(request.headers);

    await prisma.salesRep.update({
      where: { repId: auth.repId },
      data: { tokenVersion: { increment: 1 } },
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
