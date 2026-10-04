import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

import PasswordChangePage from "./page";
import { getAccessToken, getStoredRep } from "@/lib/client/auth-storage";

const CURRENT = "temporary-password-1";
const NEW = "brand-new-password-1";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function changeSucceeds() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse(200, {
      success: true,
      data: { accessToken: "fresh.token" },
      error: null,
    })
  );
}

async function fillAndSubmit(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("현재 비밀번호"), current);
  await user.type(screen.getByLabelText("새 비밀번호"), next);
  await user.type(screen.getByLabelText("새 비밀번호 확인"), confirm);
  await user.click(screen.getByRole("button", { name: "변경" }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "temporary.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId: 5, name: "신규사원", role: "SALES_REP" })
  );
  replace.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SCR-110 비밀번호 변경 — #57", () => {
  it("입력 세 개를 보여주고 모두 가린다", () => {
    render(<PasswordChangePage />);

    for (const label of ["현재 비밀번호", "새 비밀번호", "새 비밀번호 확인"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
    }
  });

  it("성공하면 새 토큰으로 교체하고 목록으로 보낸다", async () => {
    changeSucceeds();
    render(<PasswordChangePage />);

    await fillAndSubmit(CURRENT, NEW, NEW);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reports"));
    // 교체하지 않으면 기존 토큰의 tokenVersion 이 낡아 이후 요청이 401 이 된다. (#52)
    expect(getAccessToken()).toBe("fresh.token");
  });

  it("토큰을 교체해도 사용자 정보는 유지한다", async () => {
    changeSucceeds();
    render(<PasswordChangePage />);

    await fillAndSubmit(CURRENT, NEW, NEW);

    await waitFor(() => expect(getAccessToken()).toBe("fresh.token"));
    expect(getStoredRep()).toMatchObject({ repId: 5 });
  });

  it("확인 입력이 다르면 서버를 부르지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<PasswordChangePage />);

    await fillAndSubmit(CURRENT, NEW, "different-password-1");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "새 비밀번호가 일치하지 않습니다."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("12자 미만은 서버를 부르지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<PasswordChangePage />);

    await fillAndSubmit(CURRENT, "short-11ch", "short-11ch");

    expect(await screen.findByRole("alert")).toHaveTextContent("12자 이상");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("현재 비밀번호가 틀리면 서버 메시지를 보여주고 토큰을 바꾸지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(401, {
        success: false,
        data: null,
        error: { code: "UNAUTHORIZED", message: "현재 비밀번호가 올바르지 않습니다." },
      })
    );
    render(<PasswordChangePage />);

    await fillAndSubmit("wrong-password-x", NEW, NEW);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "현재 비밀번호가 올바르지 않습니다."
    );
    expect(getAccessToken()).toBe("temporary.token");
    expect(replace).not.toHaveBeenCalled();
  });

  it("기존과 같은 비밀번호면 서버 메시지를 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(400, {
        success: false,
        data: null,
        error: { code: "INVALID_REQUEST", message: "새 비밀번호가 기존 비밀번호와 같습니다." },
      })
    );
    render(<PasswordChangePage />);

    await fillAndSubmit(CURRENT, CURRENT, CURRENT);

    expect(await screen.findByRole("alert")).toHaveTextContent("기존 비밀번호와 같습니다");
  });

  it("토큰이 없으면 로그인으로 보낸다", async () => {
    window.localStorage.clear();

    render(<PasswordChangePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
