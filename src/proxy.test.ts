import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jwt", () => ({
  verifyAccessToken: vi.fn(),
}));

import { verifyAccessToken } from "@/lib/jwt";
import { proxy } from "./proxy";

const PAYLOAD = { repId: "1", name: "홍길동", role: "SALES_REP" as const };

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

async function errorBody(response: Response) {
  const body = (await response.json()) as {
    error: { code: string; message: string } | null;
  };
  return body.error;
}

beforeEach(() => {
  vi.mocked(verifyAccessToken).mockReset().mockReturnValue(PAYLOAD);
});

describe("proxy — TC-AUTH-04 토큰 없이 보호 API 호출", () => {
  it("Authorization 헤더가 없으면 401 이다", async () => {
    const response = proxy(request("/api/reports"));

    expect(response.status).toBe(401);
    expect((await errorBody(response))?.code).toBe("UNAUTHORIZED");
  });

  it("Bearer 접두사가 없으면 401 이다", () => {
    const response = proxy(request("/api/reports", { authorization: "signed.token" }));

    expect(response.status).toBe(401);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("토큰 검증이 실패하면 401 이다", async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error("jwt expired");
    });

    const response = proxy(request("/api/reports", { authorization: "Bearer expired.token" }));

    expect(response.status).toBe(401);
    expect((await errorBody(response))?.message).toBe("유효하지 않은 토큰입니다.");
  });

  it("검증 실패 응답에 내부 오류 메시지가 실리지 않는다", async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error("jwt malformed: secret mismatch");
    });

    const response = proxy(request("/api/reports", { authorization: "Bearer bad.token" }));

    expect(JSON.stringify(await errorBody(response))).not.toContain("secret");
  });
});

describe("proxy — 유효 토큰", () => {
  it("검증한 사용자 정보를 요청 헤더에 심는다", () => {
    const response = proxy(request("/api/reports", { authorization: "Bearer valid.token" }));

    // parseAuthContext 가 읽는 두 헤더다. 이름이 바뀌면 인가 전체가 401 로 막힌다.
    expect(response.headers.get("x-middleware-override-headers")).toContain("x-user-rep-id");
    expect(response.headers.get("x-middleware-request-x-user-rep-id")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-user-role")).toBe("SALES_REP");
  });

  it("토큰 문자열만 떼어 검증에 넘긴다", () => {
    proxy(request("/api/reports", { authorization: "Bearer valid.token" }));

    expect(verifyAccessToken).toHaveBeenCalledWith("valid.token");
  });

  it("401 응답이 아니다", () => {
    expect(proxy(request("/api/reports", { authorization: "Bearer valid.token" })).status).toBe(
      200
    );
  });
});

describe("proxy — 공개 경로", () => {
  it.each(["/api/auth/login", "/api/auth/logout"])(
    "%s 는 토큰 없이 통과한다",
    (path) => {
      const response = proxy(request(path));

      expect(response.status).toBe(200);
      expect(verifyAccessToken).not.toHaveBeenCalled();
    }
  );

  it("공개 경로가 아닌 /api/auth 하위는 보호된다", () => {
    // PUBLIC_API_PATHS 는 완전 일치다. 접두사 일치로 바뀌면 전부 열린다.
    expect(proxy(request("/api/auth/anything-else")).status).toBe(401);
  });
});
