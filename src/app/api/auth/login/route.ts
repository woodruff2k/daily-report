import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { signAccessToken } from "@/lib/jwt";
import { apiError, apiSuccess } from "@/lib/api-response";
import { toJsonId } from "@/lib/identifier";
import { loginRequestSchema } from "@/schemas/auth";

function isWellTypedCredentials(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const { loginId, password } = body as Record<string, unknown>;
  return (
    typeof loginId === "string" &&
    loginId.length > 0 &&
    typeof password === "string" &&
    password.length > 0
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginRequestSchema.safeParse(body);

  if (!parsed.success) {
    // 형식은 맞는데 길이·문자 제한만 어긴 입력은 비밀번호 오류와 같은 401 로
    // 응답한다. 계정 조회·해시 비교에는 들어가지 않으며(어떤 계정에도 일치할 수
    // 없다), 응답이 "입력 제한"과 "자격 증명 오류"를 구분해 알려주지 않게 한다.
    if (isWellTypedCredentials(body)) {
      return apiError(
        "UNAUTHORIZED",
        "아이디 또는 비밀번호가 올바르지 않습니다.",
        401,
      );
    }
    return apiError("INVALID_REQUEST", "필수 항목 누락", 400);
  }

  const { loginId, password } = parsed.data;

  const rep = await prisma.salesRep.findFirst({
    where: { OR: [{ email: loginId }, { empNo: loginId }] },
  });

  // Always run the hash comparison, even when no account is found, so response
  // timing doesn't reveal whether the loginId exists (see verifyPassword).
  const passwordValid = await verifyPassword(
    password,
    rep?.passwordHash ?? null,
  );

  if (!rep || !passwordValid) {
    return apiError(
      "UNAUTHORIZED",
      "아이디 또는 비밀번호가 올바르지 않습니다.",
      401,
    );
  }

  if (rep.status !== "ACTIVE") {
    return apiError("UNAUTHORIZED", "비활성화된 계정입니다.", 401);
  }

  const accessToken = signAccessToken({
    repId: rep.repId.toString(),
    name: rep.name,
    role: rep.role,
    mustChangePassword: rep.mustChangePassword,
    tokenVersion: rep.tokenVersion,
  });

  // mustChangePassword 가 true 면 화면은 비밀번호 변경으로 보내야 한다.
  // 화면을 믿지 않고 프록시가 다른 API 를 막는다. (NFR-01, 이슈 #44)
  return apiSuccess({
    accessToken,
    // 응답 식별자는 JSON 숫자다(API 명세 1.2). 토큰 payload 는 문자열로
    // 두는데, JWT 클레임은 외부 응답이 아니고 프록시가 BigInt 로 되돌린다.
    rep: { repId: toJsonId(rep.repId), name: rep.name, role: rep.role },
    mustChangePassword: rep.mustChangePassword,
  });
}
