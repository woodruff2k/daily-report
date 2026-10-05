import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => params,
}));
const params = { customerId: "1" };

import EditCustomerPage from "./page";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DETAIL = {
  customerId: 1,
  customerName: "테스트고객",
  companyName: null,
  phone: null,
  email: "customer@example.com",
  address: null,
  grade: null,
  assignedRepId: 9,
  assignedRepName: "퇴사자",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  router.replace.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SCR-410 수정 화면 진입 — #16", () => {
  it("상세를 불러와 폼에 채우고 비활성 담당자를 표시한다", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) =>
      Promise.resolve(
        String(input) === "/api/sales-reps/options"
          ? json(200, {
              success: true,
              data: [{ repId: 2, name: "홍길동" }],
              error: null,
            })
          : json(200, { success: true, data: DETAIL, error: null }),
      ),
    );

    render(<EditCustomerPage />);

    expect(await screen.findByLabelText("고객/담당자명")).toHaveValue(
      "테스트고객",
    );
    expect(screen.getByLabelText("이메일")).toHaveValue("customer@example.com");
    expect(
      await screen.findByRole("option", { name: "퇴사자 (비활성)" }),
    ).toBeInTheDocument();
  });

  it("404 이면 읽을 수 있는 메시지를 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(404, {
        success: false,
        data: null,
        error: { code: "NOT_FOUND", message: "x" },
      }),
    );

    render(<EditCustomerPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "고객을 찾을 수 없습니다.",
    );
  });

  it("401 이면 로그인으로 보낸다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(401, {
        success: false,
        data: null,
        error: { code: "UNAUTHORIZED", message: "x" },
      }),
    );

    render(<EditCustomerPage />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });
});
