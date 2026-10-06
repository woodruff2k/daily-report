import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jwt", () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { findUnique: vi.fn() } },
}));

import { verifyAccessToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { proxy } from "./proxy";

const PAYLOAD = {
  repId: "1",
  name: "홍길동",
  role: "SALES_REP" as const,
  mustChangePassword: false,
  tokenVersion: 0,
};

/** 프록시가 조회하는 계정 상태. */
const ACCOUNT = { tokenVersion: 0, status: "ACTIVE" as const };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

function bearer(path: string) {
  return request(path, { authorization: "Bearer valid.token" });
}

async function errorBody(response: Response) {
  const body = (await response.json()) as {
    success: boolean;
    data: unknown;
    error: { code: string; message: string } | null;
  };
  // 클라이언트(apiFetch)는 `success` 로 성공·실패를 가른다. 프록시가 직접 만드는
  // 401·403 도 공통 응답 구조(API 명세 1.2)를 따라야 한다. 이 단언이 없을 때
  // `success: false` 를 `true` 로 바꿔도 테스트가 통과했다(#93 뮤테이션 확인).
  expect(body.success).toBe(false);
  expect(body.data).toBeNull();
  return body.error;
}

beforeEach(() => {
  vi.mocked(verifyAccessToken).mockReset().mockReturnValue(PAYLOAD);
  vi.mocked(prisma.salesRep.findUnique)
    .mockReset()
    .mockResolvedValue(ACCOUNT as never);
});

describe("proxy — TC-AUTH-04 토큰 없이 보호 API 호출", () => {
  it("Authorization 헤더가 없으면 401 이다", async () => {
    const response = await proxy(request("/api/reports"));

    expect(response.status).toBe(401);
    expect((await errorBody(response))?.code).toBe("UNAUTHORIZED");
  });

  it("Bearer 접두사가 없으면 401 이다", async () => {
    const response = await proxy(
      request("/api/reports", { authorization: "signed.token" }),
    );

    expect(response.status).toBe(401);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("토큰 검증이 실패하면 401 이다", async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error("jwt expired");
    });

    const response = await proxy(bearer("/api/reports"));

    expect(response.status).toBe(401);
    expect((await errorBody(response))?.message).toBe(
      "유효하지 않은 토큰입니다.",
    );
  });

  it("검증 실패 응답에 내부 오류 메시지가 실리지 않는다", async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error("jwt malformed: secret mismatch");
    });

    const response = await proxy(bearer("/api/reports"));

    expect(JSON.stringify(await errorBody(response))).not.toContain("secret");
  });

  it("서명이 깨진 토큰에는 DB 를 조회하지 않는다", async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error("invalid signature");
    });

    await proxy(bearer("/api/reports"));

    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });
});

describe("proxy — 유효 토큰", () => {
  it("사용자 정보를 요청 헤더에 심지 않는다 (#102)", async () => {
    const response = await proxy(bearer("/api/reports"));

    // 라우트가 토큰 서명을 직접 검증한다. 헤더를 신뢰 경계로 쓰지 않는다.
    expect(response.headers.get("x-middleware-override-headers")).toBeNull();
    expect(
      response.headers.get("x-middleware-request-x-user-rep-id"),
    ).toBeNull();
    expect(response.headers.get("x-middleware-request-x-user-role")).toBeNull();
  });

  it("위조 헤더만 보내고 토큰이 없으면 401 이다 (#102)", async () => {
    const response = await proxy(
      request("/api/reports", {
        "x-user-rep-id": "1",
        "x-user-role": "ADMIN",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("토큰 문자열만 떼어 검증에 넘긴다", async () => {
    await proxy(bearer("/api/reports"));

    expect(verifyAccessToken).toHaveBeenCalledWith("valid.token");
  });

  it("401 응답이 아니다", async () => {
    expect((await proxy(bearer("/api/reports"))).status).toBe(200);
  });
});

describe("proxy — 공개 경로", () => {
  it("/api/auth/login 은 토큰 없이 통과한다", async () => {
    const response = await proxy(request("/api/auth/login"));

    expect(response.status).toBe(200);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("/api/auth/logout 은 토큰을 요구한다 (#52)", async () => {
    // 토큰을 무효화하려면 누구의 토큰인지 알아야 한다.
    expect((await proxy(request("/api/auth/logout"))).status).toBe(401);
  });

  it("공개 경로가 아닌 /api/auth 하위는 보호된다", async () => {
    // PUBLIC_API_PATHS 는 완전 일치다. 접두사 일치로 바뀌면 전부 열린다.
    expect((await proxy(request("/api/auth/anything-else"))).status).toBe(401);
  });

  it("공개 경로에는 DB 를 조회하지 않는다", async () => {
    await proxy(request("/api/auth/login"));

    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });
});

describe("proxy — 임시 비밀번호 상태 차단 (#44)", () => {
  beforeEach(() => {
    vi.mocked(verifyAccessToken).mockReturnValue({
      ...PAYLOAD,
      mustChangePassword: true,
    });
  });

  it.each(["/api/reports", "/api/sales-reps", "/api/customers"])(
    "%s 는 403 으로 막는다",
    async (path) => {
      const response = await proxy(bearer(path));

      // 화면이 변경 폼으로 보내주기를 기대하지 않고 서버에서 막는다.
      expect(response.status).toBe(403);
      expect((await errorBody(response))?.code).toBe(
        "PASSWORD_CHANGE_REQUIRED",
      );
    },
  );

  it("비밀번호 변경 경로는 통과시킨다", async () => {
    // 이 경로까지 막으면 임시 비밀번호 상태를 풀 방법이 없다.
    expect((await proxy(bearer("/api/me/password"))).status).toBe(200);
  });

  it("로그아웃은 통과시킨다", async () => {
    expect((await proxy(bearer("/api/auth/logout"))).status).toBe(200);
  });

  it("플래그가 내려가면 다시 통과한다", async () => {
    vi.mocked(verifyAccessToken).mockReturnValue(PAYLOAD);

    expect((await proxy(bearer("/api/sales-reps"))).status).toBe(200);
  });
});

describe("proxy — 토큰 무효화 (#52)", () => {
  it("토큰 버전이 DB 와 같으면 통과한다", async () => {
    expect((await proxy(bearer("/api/reports"))).status).toBe(200);
  });

  it("DB 의 버전이 더 높으면 401 이다", async () => {
    // 비밀번호 변경·재발급·역할 변경·로그아웃이 버전을 올린다.
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...ACCOUNT,
      tokenVersion: 1,
    } as never);

    const response = await proxy(bearer("/api/reports"));

    expect(response.status).toBe(401);
    expect((await errorBody(response))?.code).toBe("UNAUTHORIZED");
  });

  it("비활성화된 계정의 토큰은 401 이다", async () => {
    // 비활성화는 즉시 효력이 있어야 한다. 토큰 만료를 기다리지 않는다.
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...ACCOUNT,
      status: "INACTIVE",
    } as never);

    expect((await proxy(bearer("/api/reports"))).status).toBe(401);
  });

  it("계정이 사라졌으면 401 이다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    expect((await proxy(bearer("/api/reports"))).status).toBe(401);
  });

  it("조회는 repId 로 하고 필요한 두 필드만 가져온다", async () => {
    await proxy(bearer("/api/reports"));

    expect(prisma.salesRep.findUnique).toHaveBeenCalledWith({
      where: { repId: 1n },
      select: { tokenVersion: true, status: true },
    });
  });

  it("repId 가 숫자가 아닌 토큰은 401 이다", async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({
      ...PAYLOAD,
      repId: "not-a-number",
    });

    // 서명이 유효해도 payload 형식까지 보장되지는 않는다. BigInt 변환이
    // 예외를 내면 500 이 된다.
    const response = await proxy(bearer("/api/reports"));

    expect(response.status).toBe(401);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });

  it("무효화 응답에 사유를 자세히 적지 않는다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...ACCOUNT,
      tokenVersion: 9,
    } as never);

    // 버전 불일치·비활성·계정 없음을 구분해 알려주면 계정 상태가 드러난다.
    const body = await errorBody(await proxy(bearer("/api/reports")));
    expect(body?.message).toBe("유효하지 않은 토큰입니다.");
  });
});
