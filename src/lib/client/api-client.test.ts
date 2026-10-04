import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  isPasswordChangeRequired,
  isUnauthorized,
} from "./api-client";
import { saveSession } from "./auth-storage";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("apiFetch — #11", () => {
  it("공통 구조에서 data 만 꺼낸다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, { success: true, data: { repId: 1 }, error: null }),
    );

    await expect(apiFetch("/api/x")).resolves.toEqual({ repId: 1 });
  });

  it("저장된 토큰을 Authorization 헤더로 붙인다", async () => {
    saveSession("stored.token", {
      repId: 1,
      name: "홍길동",
      role: "SALES_REP",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: null, error: null }),
      );

    await apiFetch("/api/x");

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer stored.token",
    );
  });

  it("anonymous 요청에는 토큰을 붙이지 않는다", async () => {
    saveSession("stored.token", {
      repId: 1,
      name: "홍길동",
      role: "SALES_REP",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse(200, { success: true, data: null, error: null }),
      );

    await apiFetch("/api/auth/login", {
      method: "POST",
      body: {},
      anonymous: true,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(
      (init?.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("오류 응답을 ApiClientError 로 바꾼다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(403, {
        success: false,
        data: null,
        error: { code: "FORBIDDEN", message: "권한이 없습니다." },
      }),
    );

    await expect(apiFetch("/api/x")).rejects.toThrow(ApiClientError);
  });

  it("오류의 status·code 를 보존한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(409, {
        success: false,
        data: null,
        error: { code: "LAST_ACTIVE_ADMIN", message: "마지막 관리자입니다." },
      }),
    );

    const caught = await apiFetch("/api/x").catch((error: unknown) => error);

    expect(caught).toMatchObject({ status: 409, code: "LAST_ACTIVE_ADMIN" });
  });

  it("204 는 본문 없이 끝난다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await expect(
      apiFetch("/api/auth/logout", { method: "POST" }),
    ).resolves.toBeUndefined();
  });

  it("JSON 이 아닌 오류 응답도 ApiClientError 로 바꾼다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 500 }),
    );

    const caught = await apiFetch("/api/x").catch((error: unknown) => error);

    expect(caught).toMatchObject({ status: 500, code: "UNKNOWN" });
  });

  it("이동은 하지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: { code: "UNAUTHORIZED", message: "인증이 필요합니다." },
      }),
    );

    // 래퍼가 라우터를 들면 테스트가 라우터에 묶인다. 화면이 정한다.
    await expect(apiFetch("/api/x")).rejects.toThrow(ApiClientError);
    expect(window.location.pathname).toBe("/");
  });
});

describe("오류 판별 — #44, #52", () => {
  it("임시 비밀번호 차단을 알아본다", () => {
    const error = new ApiClientError(403, {
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "변경이 필요합니다.",
    });

    expect(isPasswordChangeRequired(error)).toBe(true);
    expect(isUnauthorized(error)).toBe(false);
  });

  it("401 을 알아본다", () => {
    const error = new ApiClientError(401, {
      code: "UNAUTHORIZED",
      message: "만료",
    });

    expect(isUnauthorized(error)).toBe(true);
    expect(isPasswordChangeRequired(error)).toBe(false);
  });

  it("다른 값에는 false 다", () => {
    expect(isUnauthorized(new Error("boom"))).toBe(false);
    expect(isPasswordChangeRequired(null)).toBe(false);
  });
});
