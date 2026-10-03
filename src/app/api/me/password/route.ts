import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api-response";
import { parseAuthContext } from "@/lib/auth";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { signAccessToken } from "@/lib/jwt";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { passwordChangeSchema } from "@/schemas/auth";

/**
 * 본인 비밀번호 변경. (이슈 #44)
 *
 * 임시 비밀번호 상태를 푸는 유일한 경로다. 프록시가 이 경로만 열어 둔다.
 *
 * 현재 비밀번호를 함께 받는다. 토큰만으로 변경을 허용하면 탈취한 토큰으로
 * 비밀번호를 갈아 계정을 가져갈 수 있다.
 *
 * 변경에 성공하면 새 토큰을 돌려준다. 기존 토큰에는 mustChangePassword 가
 * true 로 박혀 있어 그대로 쓰면 계속 막힌다.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = parseAuthContext(request.headers);

    const parsed = passwordChangeSchema.safeParse(
      await request.json().catch(() => null)
    );

    if (!parsed.success) {
      throw new ValidationError(
        "현재 비밀번호와 새 비밀번호(12자 이상)를 입력하세요."
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    const rep = await prisma.salesRep.findUnique({
      where: { repId: auth.repId },
      select: { repId: true, name: true, role: true, passwordHash: true },
    });

    if (!rep) {
      throw new NotFoundError("계정을 찾을 수 없습니다.");
    }

    if (!(await verifyPassword(currentPassword, rep.passwordHash))) {
      throw new AuthorizationError(
        "UNAUTHORIZED",
        "현재 비밀번호가 올바르지 않습니다.",
        401
      );
    }

    if (newPassword === currentPassword) {
      throw new ValidationError("새 비밀번호가 기존 비밀번호와 같습니다.");
    }

    await prisma.salesRep.update({
      where: { repId: auth.repId },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
      },
    });

    return apiSuccess({
      accessToken: signAccessToken({
        repId: rep.repId.toString(),
        name: rep.name,
        role: rep.role,
        mustChangePassword: false,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
