import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import SalesRepListPage from "./page";

const ROWS = [
  {
    repId: 2,
    empNo: "S2026002",
    name: "홍길동",
    department: "영업1팀",
    position: "대리",
    managerId: 1,
    managerName: "김부장",
    role: "SALES_REP",
    status: "ACTIVE",
  },
  {
    repId: 3,
    empNo: "S2026003",
    name: "이순신",
    department: null,
    position: null,
    managerId: null,
    managerName: null,
    role: "MANAGER",
    status: "INACTIVE",
  },
];

function pageResponse(content: unknown[]) {
  return new Response(
    JSON.stringify({
      success: true,
      data: { content, page: 0, size: 50, totalElements: content.length, totalPages: 1 },
      error: null,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function loginAs(role: string) {
  window.localStorage.setItem("daily-report.accessToken", "admin.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId: 4, name: "시스템관리자", role })
  );
}

beforeEach(() => {
  window.localStorage.clear();
  replace.mockClear();
  loginAs("ADMIN");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SCR-500 영업 마스터 목록 — #17", () => {
  it("불러온 목록을 표로 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse(ROWS));

    render(<SalesRepListPage />);

    expect(await screen.findByText("S2026002")).toBeInTheDocument();
    expect(screen.getByText("이순신")).toBeInTheDocument();
    expect(screen.getByText("총 2건")).toBeInTheDocument();
  });

  it("상급자 이름을 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse(ROWS));

    render(<SalesRepListPage />);

    // 식별자가 아니라 이름이 보여야 한다. (SCR-500)
    expect(await screen.findByText("김부장")).toBeInTheDocument();
  });

  it("상급자가 없으면 대시로 표시한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse([ROWS[1]]));

    render(<SalesRepListPage />);

    await screen.findByText("이순신");
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("역할·상태를 한글로 표시한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse(ROWS));

    render(<SalesRepListPage />);

    // 데이터가 들어온 뒤에 본다. 빈 상태 행만 있을 때 통과하면 안 된다.
    await screen.findByText("S2026002");

    // 상태 필터 select 의 option 과 겹치므로 표 안에서만 찾는다.
    const rows = screen.getAllByRole("row");
    const cells = rows.flatMap((row) => Array.from(row.querySelectorAll("td")));
    const texts = cells.map((cell) => cell.textContent);

    expect(texts).toContain("영업사원");
    expect(texts).toContain("상급자");
    expect(texts).toContain("비활성");
  });

  it("검색 조건을 쿼리로 넘긴다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse(ROWS));
    render(<SalesRepListPage />);
    await screen.findByText("S2026002");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("이름/사번"), "홍길");
    await user.selectOptions(screen.getByLabelText("상태"), "ACTIVE");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    const [url] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(url)).toContain("keyword=%ED%99%8D%EA%B8%B8");
    expect(String(url)).toContain("status=ACTIVE");
  });

  it("빈 조건은 쿼리에 넣지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse(ROWS));
    render(<SalesRepListPage />);
    await screen.findByText("S2026002");

    await userEvent.setup().click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    const [url] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(url)).not.toContain("keyword=");
    expect(String(url)).not.toContain("status=");
  });

  it("결과가 없으면 안내를 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse([]));

    render(<SalesRepListPage />);

    expect(await screen.findByText("조회 결과가 없습니다.")).toBeInTheDocument();
  });

  it("조회가 실패하면 오류를 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          data: null,
          error: { code: "FORBIDDEN", message: "권한이 없습니다." },
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    render(<SalesRepListPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("목록을 불러올 수 없습니다.");
  });

  it("관리자가 아니면 내보낸다", async () => {
    loginAs("SALES_REP");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse([]));

    render(<SalesRepListPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reports"));
  });

  it("토큰이 없으면 로그인으로 보낸다", async () => {
    window.localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(pageResponse([]));

    render(<SalesRepListPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
