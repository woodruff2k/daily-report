import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ACTIVE_REP, readBody } from "@/test/auth-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn((password: string) =>
    Promise.resolve(`hashed:${password}`),
  ),
  verifyPassword: vi.fn(),
}));

// 서명 검증(verifyAccessToken)은 실제 구현을 쓴다. 발급만 목으로 바꾼다.
vi.mock("@/lib/jwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jwt")>()),
  signAccessToken: vi.fn(() => "fresh.access.token"),
}));

import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { signAccessToken } from "@/lib/jwt";
import { PUT } from "./route";

const URL = "http://localhost/api/me/password";
const CURRENT = "current-password-1";
const NEW = "brand-new-password-1";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(URL, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * 서명된 토큰을 단 요청. 이 파일은 `signAccessToken` 을 목으로 바꾸므로(새 토큰
 * 발급 단언용) 요청용 토큰은 실제 구현으로 서명한다.
 */
const { signAccessToken: signActual } =
  await vi.importActual<typeof import("@/lib/jwt")>("@/lib/jwt");

function asSelf(body: unknown) {
  const token = signActual({
    repId: "1",
    name: "홍길동",
    role: "SALES_REP",
    mustChangePassword: false,
    tokenVersion: 0,
  });
  return request(body, { authorization: `Bearer ${token}` });
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.findUnique)
    .mockReset()
    .mockResolvedValue({
      repId: ACTIVE_REP.repId,
      name: ACTIVE_REP.name,
      role: ACTIVE_REP.role,
      passwordHash: ACTIVE_REP.passwordHash,
    } as never);
  vi.mocked(prisma.salesRep.update)
    .mockReset()
    .mockResolvedValue({ tokenVersion: 1 } as never);
  vi.mocked(verifyPassword).mockReset().mockResolvedValue(true);
  vi.mocked(hashPassword).mockClear();
  vi.mocked(signAccessToken).mockClear();
});

describe("PUT /api/me/password — 본인 변경 (#44)", () => {
  it("현재 비밀번호가 맞으면 새 해시로 바꾼다", async () => {
    const response = await PUT(
      asSelf({ currentPassword: CURRENT, newPassword: NEW }),
    );

    expect(response.status).toBe(200);
    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: {
        passwordHash: `hashed:${NEW}`,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
      select: { tokenVersion: true },
    });
  });

  it("변경 강제 플래그를 내린다", async () => {
    await PUT(asSelf({ currentPassword: CURRENT, newPassword: NEW }));

    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).toMatchObject({ mustChangePassword: false });
  });

  it("새 토큰을 돌려준다", async () => {
    const response = await PUT(
      asSelf({ currentPassword: CURRENT, newPassword: NEW }),
    );

    // 기존 토큰에는 mustChangePassword 가 true 로 박혀 있어 그대로 쓰면 계속 막힌다.
    expect((await readBody(response)).data).toEqual({
      accessToken: "fresh.access.token",
    });
    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ mustChangePassword: false }),
    );
  });

  it("현재 비밀번호가 틀리면 401 이다", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await PUT(
      asSelf({ currentPassword: "wrong-password", newPassword: NEW }),
    );

    expect(response.status).toBe(401);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("새 비밀번호가 기존과 같으면 400 이다", async () => {
    const response = await PUT(
      asSelf({ currentPassword: CURRENT, newPassword: CURRENT }),
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it.each([
    ["본문 없음", undefined],
    ["현재 비밀번호 누락", { newPassword: NEW }],
    ["새 비밀번호 누락", { currentPassword: CURRENT }],
    [
      "새 비밀번호 12자 미만",
      { currentPassword: CURRENT, newPassword: "short-11ch" },
    ],
  ])("잘못된 요청(%s)은 400 이다", async (_label, body) => {
    const response = await PUT(asSelf(body));

    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("인증 헤더가 없으면 401 이다", async () => {
    const response = await PUT(
      request({ currentPassword: CURRENT, newPassword: NEW }),
    );

    expect(response.status).toBe(401);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });

  it("토큰의 계정이 사라졌으면 404 다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    expect(
      (await PUT(asSelf({ currentPassword: CURRENT, newPassword: NEW })))
        .status,
    ).toBe(404);
  });

  it("응답에 비밀번호나 해시가 실리지 않는다", async () => {
    const response = await PUT(
      asSelf({ currentPassword: CURRENT, newPassword: NEW }),
    );

    const body = JSON.stringify(await readBody(response));
    expect(body).not.toContain(NEW);
    expect(body).not.toContain("hashed:");
  });
});

describe("PUT /api/me/password — 기존 토큰 무효화 (#52)", () => {
  it("토큰 버전을 올린다", async () => {
    await PUT(asSelf({ currentPassword: CURRENT, newPassword: NEW }));

    // 다른 기기에 남아 있던 세션도 끊는다.
    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).toMatchObject({ tokenVersion: { increment: 1 } });
  });

  it("새 토큰에 올라간 버전을 담는다", async () => {
    await PUT(asSelf({ currentPassword: CURRENT, newPassword: NEW }));

    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ tokenVersion: 1 }),
    );
  });
});
