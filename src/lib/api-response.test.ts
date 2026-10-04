import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError } from "./errors";
import { apiError, apiErrorResponse, apiSuccess } from "./api-response";

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

describe("apiErrorResponse — TC-SEC-05 내부 정보 미노출", () => {
  it("인가 오류의 code·message·status를 그대로 응답에 담는다", async () => {
    const response = apiErrorResponse(
      new AuthorizationError("FORBIDDEN", "소속 팀원이 아닙니다.", 403),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "소속 팀원이 아닙니다." },
    });
  });

  it("401 인가 오류의 상태 코드를 유지한다", () => {
    const response = apiErrorResponse(
      new AuthorizationError("UNAUTHORIZED", "인증이 필요합니다.", 401),
    );

    expect(response.status).toBe(401);
  });

  it("응답 본문에 code·message 외의 항목이 실리지 않는다", async () => {
    const response = apiErrorResponse(
      new AuthorizationError("FORBIDDEN", "본인의 리소스가 아닙니다.", 403),
    );
    const body = (await response.json()) as { error: Record<string, unknown> };

    // 키 집합을 고정해 name·stack 같은 내부 정보가 덧붙는 회귀를 막는다.
    expect(Object.keys(body).sort()).toEqual(["data", "error", "success"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });

  it("상태 충돌도 같은 경로로 변환한다", async () => {
    const response = apiErrorResponse(
      new ConflictError("REPORT_LOCKED", "제출된 보고는 수정할 수 없습니다."),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      data: null,
      error: {
        code: "REPORT_LOCKED",
        message: "제출된 보고는 수정할 수 없습니다.",
      },
    });
  });

  it("HttpError가 아니면 다시 던져 500으로 뭉개지 않는다", () => {
    const unexpected = new Error("데이터베이스 연결 실패");

    expect(() => apiErrorResponse(unexpected)).toThrow(unexpected);
  });
});
