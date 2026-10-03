import { describe, expect, it } from "vitest";
import { AuthorizationError } from "./auth";
import { apiError, apiSuccess, authorizationErrorResponse } from "./api-response";

describe("apiSuccess / apiError", () => {
  it("성공 응답은 공통 구조를 지킨다", async () => {
    const response = apiSuccess({ reportId: 10 }, 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { reportId: 10 },
      error: null,
    });
  });

  it("오류 응답은 공통 구조를 지킨다", async () => {
    const response = apiError("FORBIDDEN", "권한이 없습니다.", 403);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "권한이 없습니다." },
    });
  });
});

describe("authorizationErrorResponse — TC-SEC-05 내부 정보 미노출", () => {
  it("인가 오류의 code·message·status를 그대로 응답에 담는다", async () => {
    const response = authorizationErrorResponse(
      new AuthorizationError("FORBIDDEN", "소속 팀원이 아닙니다.", 403)
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "소속 팀원이 아닙니다." },
    });
  });

  it("401 인가 오류의 상태 코드를 유지한다", () => {
    const response = authorizationErrorResponse(
      new AuthorizationError("UNAUTHORIZED", "인증이 필요합니다.", 401)
    );

    expect(response.status).toBe(401);
  });

  it("응답 본문에 스택트레이스나 오류 이름이 실리지 않는다", async () => {
    const response = authorizationErrorResponse(
      new AuthorizationError("FORBIDDEN", "본인의 리소스가 아닙니다.", 403)
    );
    const body = JSON.stringify(await response.json());

    expect(body).not.toContain("AuthorizationError");
    expect(body).not.toContain("auth.ts");
    expect(body).not.toContain("at ");
  });

  it("인가 오류가 아니면 다시 던져 500으로 뭉개지 않는다", () => {
    const unexpected = new Error("데이터베이스 연결 실패");

    expect(() => authorizationErrorResponse(unexpected)).toThrow(unexpected);
  });
});
