import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("HttpError 응답은 로그를 남기지 않는다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    apiErrorResponse(new AuthorizationError("FORBIDDEN", "x", 403));

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("apiErrorResponse — 알 수 없는 오류 (이슈 #10, TC-SEC-05)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("던지지 않고 INTERNAL_ERROR 500 을 공통 봉투로 응답한다 (권한·검증 코드로 오인시키지 않는다)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");

    const response = apiErrorResponse(new Error("데이터베이스 연결 실패"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      data: null,
      error: { code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." },
    });
  });

  it("프로덕션에서는 detail 과 스택을 응답에 담지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");

    const response = apiErrorResponse(new Error("내부 쿼리 실패 SELECT 1"));
    const text = JSON.stringify(await response.json());

    expect(text).not.toContain("detail");
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("stack");
  });

  it("개발에서는 마스킹된 detail 을 담는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");

    const response = apiErrorResponse(
      new Error('insert failed email: "a@example.com"'),
    );
    const body = (await response.json()) as {
      error: { detail?: string };
    };

    expect(body.error.detail).toContain("insert failed");
    expect(body.error.detail).not.toContain("a@example.com");
  });

  it("서버 로그를 남기되 PII 는 마스킹한다 (TC-SEC-07)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    apiErrorResponse(
      new Error('Unique failed phone: "010-0000-0000", user x@example.com'),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("010-0000-0000");
    expect(logged).not.toContain("x@example.com");
    expect(logged).toContain("Unique failed");
  });
});
