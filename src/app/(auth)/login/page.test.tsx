import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const push = vi.fn();
// 같은 객체를 돌려준다. 매 렌더 새 객체를 주면 [router] 의존 효과가 계속 다시
// 돌아, 화면이 하지 않은 이동까지 호출된 것처럼 보인다.
const router = { replace, push };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import LoginPage from "./page";
import { getAccessToken, getStoredRep } from "@/lib/client/auth-storage";

const REP = { repId: 4, name: "시스템관리자", role: "ADMIN" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function loginSucceeds(mustChangePassword = false) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(200, {
      success: true,
      data: { accessToken: "issued.token", rep: REP, mustChangePassword },
      error: null,
    }),
  );
}

async function fillAndSubmit(loginId: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("이메일/사번"), loginId);
  await user.type(screen.getByLabelText("비밀번호"), password);
  await user.click(screen.getByRole("button", { name: "로그인" }));
}

beforeEach(() => {
  window.localStorage.clear();
  replace.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SCR-100 로그인 — #11", () => {
  it("입력 항목과 버튼을 보여준다", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText("이메일/사번")).toBeInTheDocument();
    expect(screen.getByLabelText("비밀번호")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
  });

  it("비밀번호 입력은 가려진다", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText("비밀번호")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("관리자는 영업 마스터 목록으로 보낸다 (TC-AUTH-01)", async () => {
    loginSucceeds();
    render(<LoginPage />);

    await fillAndSubmit("test-admin@example.com", "seed-dev-only-Passw0rd!");

    // 관리자는 SCR-200(본인 보고 목록)의 접근 권한이 없다. (#17)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales-reps"));
    expect(getAccessToken()).toBe("issued.token");
    expect(getStoredRep()).toEqual(REP);
  });

  it("영업사원은 일일보고 목록으로 보낸다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          accessToken: "issued.token",
          rep: { repId: 2, name: "홍길동", role: "SALES_REP" },
          mustChangePassword: false,
        },
        error: null,
      }),
    );
    render(<LoginPage />);

    await fillAndSubmit("hong@example.com", "seed-dev-only-Passw0rd!");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reports"));
  });

  it("임시 비밀번호 상태면 비밀번호 변경으로 보낸다 (#44)", async () => {
    loginSucceeds(true);
    render(<LoginPage />);

    await fillAndSubmit("new@example.com", "temporary-password-1");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/password"));
  });

  it("실패하면 오류를 보여주고 머문다 (TC-AUTH-02)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: {
          code: "UNAUTHORIZED",
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        },
      }),
    );
    render(<LoginPage />);

    await fillAndSubmit("test-admin@example.com", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이메일/사번 또는 비밀번호가 올바르지 않습니다.",
    );
    expect(replace).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
  });

  it("계정 없음과 비밀번호 오류를 구분해 알려주지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: {
          code: "UNAUTHORIZED",
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        },
      }),
    );
    render(<LoginPage />);

    await fillAndSubmit("nobody@example.com", "whatever-pass");

    // 메시지가 갈리면 어느 아이디가 존재하는지 알려주게 된다.
    const message = (await screen.findByRole("alert")).textContent ?? "";
    expect(message).not.toContain("계정");
    expect(message).not.toContain("없");
  });

  it("빈 입력은 서버를 부르지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<LoginPage />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("이미 로그인한 상태로 들어오면 목록으로 보낸다", async () => {
    window.localStorage.setItem("daily-report.accessToken", "existing.token");

    render(<LoginPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reports"));
  });

  it("로그인 요청에는 토큰을 붙이지 않는다", async () => {
    window.localStorage.setItem("daily-report.accessToken", "stale.token");
    const fetchMock = loginSucceeds();
    render(<LoginPage />);

    await fillAndSubmit("test-admin@example.com", "seed-dev-only-Passw0rd!");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(
      (init?.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });
});
