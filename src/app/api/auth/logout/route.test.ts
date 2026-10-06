import { beforeEach, describe, expect, it, vi } from "vitest";
import { bearerHeaders } from "@/test/auth-headers";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { update: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const URL = "http://localhost/api/auth/logout";

function asSelf() {
  return new NextRequest(URL, {
    method: "POST",
    headers: bearerHeaders(1, "SALES_REP"),
  });
}

function withoutAuth() {
  return new NextRequest(URL, { method: "POST" });
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.update)
    .mockReset()
    .mockResolvedValue({} as never);
});

describe("POST /api/auth/logout — TC-AUTH-05", () => {
  it("204 를 반환한다", async () => {
    expect((await POST(asSelf())).status).toBe(204);
  });

  it("본문이 없다", async () => {
    const response = await POST(asSelf());

    expect(response.body).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });

  it("토큰을 무효화한다 (#52)", async () => {
    await POST(asSelf());

    // 명세의 기대 결과는 "204, 토큰 무효화" 다. 204 만으로는 절반이다.
    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: { tokenVersion: { increment: 1 } },
    });
  });

  it("인증 헤더가 없으면 401 이다", async () => {
    // 누구의 토큰을 거둘지 알아야 하므로 공개 경로가 아니다.
    const response = await POST(withoutAuth());

    expect(response.status).toBe(401);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });
});
