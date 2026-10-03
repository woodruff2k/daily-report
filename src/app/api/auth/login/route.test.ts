import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_REP,
  INACTIVE_REP,
  MUST_CHANGE_REP,
  PASSWORD,
  jsonRequest,
  readBody,
} from "@/test/auth-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/jwt", () => ({
  signAccessToken: vi.fn(() => "signed.access.token"),
}));

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { signAccessToken } from "@/lib/jwt";
import { POST } from "./route";

const URL = "http://localhost/api/auth/login";

function login(body: unknown) {
  return POST(jsonRequest(URL, body));
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.findFirst).mockReset().mockResolvedValue(ACTIVE_REP);
  vi.mocked(verifyPassword).mockReset().mockResolvedValue(true);
  vi.mocked(signAccessToken).mockClear();
});

describe("POST /api/auth/login — TC-AUTH-01 정상 로그인", () => {
  it("유효한 자격증명이면 200과 accessToken 을 반환한다", async () => {
    const response = await login({ loginId: ACTIVE_REP.email, password: PASSWORD });
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      accessToken: "signed.access.token",
      rep: { repId: "1", name: "홍길동", role: "SALES_REP" },
      mustChangePassword: false,
    });
  });

  it("토큰 payload 에 repId·name·role·비밀번호 변경 여부를 담는다", async () => {
    await login({ loginId: ACTIVE_REP.email, password: PASSWORD });

    expect(signAccessToken).toHaveBeenCalledWith({
      repId: "1",
      name: "홍길동",
      role: "SALES_REP",
      mustChangePassword: false,
    });
  });

  it("사번으로도 로그인된다", async () => {
    await login({ loginId: ACTIVE_REP.empNo, password: PASSWORD });

    // 화면(SCR-100)의 입력 칸이 "이메일/사번" 하나이므로 둘 다 받아야 한다.
    expect(prisma.salesRep.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: "S2026001" }, { empNo: "S2026001" }] },
    });
  });

  it("응답에 비밀번호 해시가 들어가지 않는다", async () => {
    const response = await login({ loginId: ACTIVE_REP.email, password: PASSWORD });

    // 레코드 전체를 실어 보내는 회귀를 막는다. (NFR-04)
    expect(JSON.stringify(await readBody(response))).not.toContain("$2a$");
  });
});

describe("POST /api/auth/login — TC-AUTH-02 비밀번호 오류", () => {
  it("비밀번호가 틀리면 401 이다", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const response = await login({ loginId: ACTIVE_REP.email, password: "wrong" });

    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe("UNAUTHORIZED");
    expect(signAccessToken).not.toHaveBeenCalled();
  });

  it("계정이 없어도 같은 401 메시지를 쓴다", async () => {
    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(null);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const notFound = await readBody(await login({ loginId: "nobody@example.com", password: PASSWORD }));

    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(ACTIVE_REP);
    const wrongPassword = await readBody(await login({ loginId: ACTIVE_REP.email, password: "wrong" }));

    // 메시지가 갈리면 어느 아이디가 존재하는지 알려주게 된다.
    expect(notFound.error).toEqual(wrongPassword.error);
  });

  it("계정이 없을 때도 해시 비교를 수행한다", async () => {
    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(null);

    await login({ loginId: "nobody@example.com", password: PASSWORD });

    // 응답 시간으로 계정 존재 여부가 드러나지 않게 하는 의도적 처리다.
    // 이 호출을 "불필요한 연산"으로 보고 지우면 타이밍 노출이 생긴다.
    expect(verifyPassword).toHaveBeenCalledWith(PASSWORD, null);
  });
});

describe("POST /api/auth/login — TC-AUTH-03 비활성 계정", () => {
  it("INACTIVE 계정은 401 이다", async () => {
    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(INACTIVE_REP);

    const response = await login({ loginId: INACTIVE_REP.email, password: PASSWORD });

    expect(response.status).toBe(401);
    expect(signAccessToken).not.toHaveBeenCalled();
  });

  it("비밀번호가 맞아도 토큰을 발급하지 않는다", async () => {
    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(INACTIVE_REP);
    vi.mocked(verifyPassword).mockResolvedValue(true);

    await login({ loginId: INACTIVE_REP.email, password: PASSWORD });

    expect(signAccessToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login — 입력 검증", () => {
  it.each([
    ["본문 없음", undefined],
    ["빈 객체", {}],
    ["loginId 누락", { password: PASSWORD }],
    ["password 누락", { loginId: ACTIVE_REP.email }],
    ["loginId 빈 문자열", { loginId: "", password: PASSWORD }],
  ])("%s 이면 400 이다", async (_label, body) => {
    const response = await login(body);

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("INVALID_REQUEST");
    expect(prisma.salesRep.findFirst).not.toHaveBeenCalled();
  });

  it("JSON 이 아닌 본문도 400 으로 막는다", async () => {
    const request = new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    const response = await POST(request as never);

    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/login — 임시 비밀번호 상태 (#44)", () => {
  it("변경이 필요하면 응답과 토큰에 모두 표시한다", async () => {
    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(MUST_CHANGE_REP);

    const response = await login({ loginId: MUST_CHANGE_REP.email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toMatchObject({ mustChangePassword: true });
    expect(signAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ mustChangePassword: true })
    );
  });

  it("로그인 자체를 막지는 않는다", async () => {
    vi.mocked(prisma.salesRep.findFirst).mockResolvedValue(MUST_CHANGE_REP);

    // 토큰이 없으면 비밀번호를 바꿀 수도 없다. 다른 API 차단은 프록시가 한다.
    const body = await readBody(await login({ loginId: MUST_CHANGE_REP.email, password: PASSWORD }));

    expect(body.data?.accessToken).toBe("signed.access.token");
  });
});
