import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { signAccessToken } from "@/lib/jwt";
import { apiError, apiSuccess } from "@/lib/api-response";
import { loginRequestSchema } from "@/schemas/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginRequestSchema.safeParse(body);

  if (!parsed.success) {
    return apiError("INVALID_REQUEST", "필수 항목 누락", 400);
  }

  const { loginId, password } = parsed.data;

  const rep = await prisma.salesRep.findFirst({
    where: { OR: [{ email: loginId }, { empNo: loginId }] },
  });

  // Always run the hash comparison, even when no account is found, so response
  // timing doesn't reveal whether the loginId exists (see verifyPassword).
  const passwordValid = await verifyPassword(password, rep?.passwordHash ?? null);

  if (!rep || !passwordValid) {
    return apiError("UNAUTHORIZED", "아이디 또는 비밀번호가 올바르지 않습니다.", 401);
  }

  if (rep.status !== "ACTIVE") {
    return apiError("UNAUTHORIZED", "비활성화된 계정입니다.", 401);
  }

  const accessToken = signAccessToken({
    repId: rep.repId.toString(),
    name: rep.name,
    role: rep.role,
  });

  return apiSuccess({
    accessToken,
    rep: { repId: rep.repId.toString(), name: rep.name, role: rep.role },
  });
}
