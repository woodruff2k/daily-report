// 통합 테스트(실제 PostgreSQL). 인증 계층 `proxy()` 를 직접 호출해 응답 상태로 검증한다.
// 핸들러 테스트는 헤더를 직접 세팅해 부르므로, 토큰 검증과 DB 대조(tokenVersion·상태)는
// 여기서만 확인된다.
// 덮는 TC: TC-AUTH-04, TC-AUTH-05(토큰 무효화), 이슈 #44(임시 비밀번호), 이슈 #52(tokenVersion)
import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { prisma } from "@/lib/prisma";
import { TEST_PASSWORD, createRep } from "@/test/integration/factories";
import { call, tokenFor } from "@/test/integration/http";

function request(path: string, token?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

async function errorCodeOf(response: Response) {
  return (await response.json()).error.code;
}

describe("proxy 인증 (실제 DB)", () => {
  it("TC-AUTH-04: Authorization 헤더 없이 보호 API 를 호출하면 401 이다", async () => {
    const response = await proxy(request("/api/reports"));

    expect(response.status).toBe(401);
    expect(await errorCodeOf(response)).toBe("UNAUTHORIZED");
  });

  it("서명이 틀린 토큰은 401 이다", async () => {
    const rep = await createRep();
    const forged = jwt.sign(
      {
        repId: rep.repId.toString(),
        name: rep.name,
        role: rep.role,
        mustChangePassword: false,
        tokenVersion: rep.tokenVersion,
      },
      "some-other-secret",
    );

    const response = await proxy(request("/api/reports", forged));

    expect(response.status).toBe(401);
  });

  it("유효한 토큰과 활성 계정이면 통과한다(401·403 이 아니다)", async () => {
    const rep = await createRep();

    const response = await proxy(request("/api/reports", tokenFor(rep)));

    expect(response.status).toBe(200);
  });

  it("tokenVersion 이 DB 보다 낮은 지난 토큰은 401 이다", async () => {
    const rep = await createRep();
    const staleToken = tokenFor(rep);
    await prisma.salesRep.update({
      where: { repId: rep.repId },
      data: { tokenVersion: { increment: 1 } },
    });

    const response = await proxy(request("/api/reports", staleToken));

    expect(response.status).toBe(401);
  });

  it("비활성화된 계정의 토큰은 서명이 유효해도 401 이다", async () => {
    const rep = await createRep();
    const token = tokenFor(rep);
    await prisma.salesRep.update({
      where: { repId: rep.repId },
      data: { status: "INACTIVE" },
    });

    const response = await proxy(request("/api/reports", token));

    expect(response.status).toBe(401);
  });

  it("DB 에 없는 사원의 토큰은 401 이다", async () => {
    const rep = await createRep();
    const token = tokenFor(rep);
    await prisma.salesRep.delete({ where: { repId: rep.repId } });

    const response = await proxy(request("/api/reports", token));

    expect(response.status).toBe(401);
  });

  it("임시 비밀번호 상태의 토큰은 일반 API 에서 403 PASSWORD_CHANGE_REQUIRED 이다", async () => {
    const rep = await createRep({ mustChangePassword: true });
    const token = tokenFor(rep, { mustChangePassword: true });

    const response = await proxy(request("/api/reports", token));

    expect(response.status).toBe(403);
    expect(await errorCodeOf(response)).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it.each(["/api/me/password", "/api/auth/logout"])(
    "임시 비밀번호 상태에서도 %s 는 통과한다",
    async (path) => {
      const rep = await createRep({ mustChangePassword: true });
      const token = tokenFor(rep, { mustChangePassword: true });

      const response = await proxy(request(path, token));

      expect(response.status).toBe(200);
    },
  );

  it("TC-AUTH-05: 실제 로그인 토큰은 로그아웃 뒤 프록시에서 401 이 된다", async () => {
    const rep = await createRep();
    const loggedIn = await call(login, "POST", "/api/auth/login", {
      body: { loginId: rep.empNo, password: TEST_PASSWORD },
    });
    const token = loggedIn.body.data.accessToken as string;
    expect((await proxy(request("/api/reports", token))).status).toBe(200);

    const loggedOut = await call(logout, "POST", "/api/auth/logout", {
      as: rep,
    });
    expect(loggedOut.status).toBe(204);

    expect((await proxy(request("/api/reports", token))).status).toBe(401);
  });
});
