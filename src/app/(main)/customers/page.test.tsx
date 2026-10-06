import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// useRouter 는 안정된 객체를 돌려준다. 렌더마다 새 객체면 [router] 의존 효과가
// 매번 다시 돌아 테스트가 틀린 이유로 통과한다.
const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import CustomerListPage from "./page";

const ROWS = [
  {
    customerId: 1,
    customerName: "테스트고객",
    companyName: "(주)가나다",
    phone: "02-000-0000",
    grade: "A",
    assignedRepId: 2,
    assignedRepName: "홍길동",
    status: "ACTIVE",
    editable: true,
  },
  {
    customerId: 2,
    customerName: "두번째고객",
    companyName: null,
    phone: null,
    grade: null,
    assignedRepId: null,
    assignedRepName: null,
    status: "INACTIVE",
    editable: false,
  },
];

const OPTIONS = [
  { repId: 2, name: "홍길동" },
  { repId: 3, name: "김영업" },
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ok(data: unknown) {
  return json(200, { success: true, data, error: null });
}

function fail(status: number, code: string, message = "오류") {
  return json(status, { success: false, data: null, error: { code, message } });
}

function pageData(content: unknown[]) {
  return {
    content,
    page: 0,
    size: 50,
    totalElements: content.length,
    totalPages: 1,
  };
}

/** URL 로 응답을 가른다. 호출 순서에 기대지 않는다. */
function mockApi(customers: () => Response = () => ok(pageData(ROWS))) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.startsWith("/api/sales-reps/options")) {
      return Promise.resolve(ok(OPTIONS));
    }
    return Promise.resolve(customers());
  });
}

function customerCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith("/api/customers"));
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId: 2, name: "홍길동", role: "SALES_REP" }),
  );
  replace.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SCR-400 고객 마스터 목록 — #16", () => {
  it("불러온 목록을 표로 보여준다", async () => {
    mockApi();

    render(<CustomerListPage />);

    expect(await screen.findByText("테스트고객")).toBeInTheDocument();
    expect(screen.getByText("(주)가나다")).toBeInTheDocument();
    expect(screen.getByText("02-000-0000")).toBeInTheDocument();
    expect(screen.getByText("총 2건")).toBeInTheDocument();
  });

  it("담당 영업 이름과 상태를 표 안에서 한글로 보여준다", async () => {
    mockApi();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    const cells = screen
      .getAllByRole("row")
      .flatMap((row) => Array.from(row.querySelectorAll("td")))
      .map((cell) => cell.textContent);

    expect(cells).toContain("홍길동");
    expect(cells).toContain("활성");
    expect(cells).toContain("비활성");
  });

  it("목록에 이메일·주소 컬럼을 두지 않는다 (NFR-04)", async () => {
    mockApi();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);

    expect(headers).not.toContain("이메일");
    expect(headers).not.toContain("주소");
  });

  it("행의 [수정] 은 수정 화면으로 연결된다", async () => {
    mockApi();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    const links = screen.getAllByRole("link", { name: "수정" });
    expect(links[0]).toHaveAttribute("href", "/customers/1/edit");
  });

  // #68: editable 은 서버가 계산한다. 화면은 assignedRepId 로 다시 계산하지 않는다.
  it("editable: false 인 행의 [수정] 은 링크가 아니라 비활성이고 이유가 보인다", async () => {
    mockApi();
    render(<CustomerListPage />);
    await screen.findByText("두번째고객");

    // 링크는 editable 인 행 하나뿐이다.
    expect(screen.getAllByRole("link", { name: "수정" })).toHaveLength(1);
    const disabled = screen.getByRole("button", {
      name: /수정 \(담당 영업과 그 상급자만 수정할 수 있습니다\)/,
    });
    expect(disabled).toBeDisabled();
    expect(
      screen.getByTitle("담당 영업과 그 상급자만 수정할 수 있습니다"),
    ).toBeInTheDocument();
  });

  it("assignedRepId 가 내 repId 여도 editable: false 면 비활성이다 (화면이 다시 계산하지 않는다)", async () => {
    // 로그인 사용자 repId 는 2. 그 사람이 담당자인 행도 서버가 false 면 따른다.
    mockApi(() =>
      ok(pageData([{ ...ROWS[0], assignedRepId: 2, editable: false }])),
    );
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    expect(screen.queryByRole("link", { name: "수정" })).toBeNull();
    expect(screen.getByRole("button", { name: /^수정 \(/ })).toBeDisabled();
  });

  it("assignedRepId 가 남이어도 editable: true 면 링크다 (상급자)", async () => {
    mockApi(() =>
      ok(pageData([{ ...ROWS[0], assignedRepId: 9, editable: true }])),
    );
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    expect(screen.getByRole("link", { name: "수정" })).toHaveAttribute(
      "href",
      "/customers/1/edit",
    );
  });

  it("[+ 신규 등록] 은 등록 화면으로 연결된다", () => {
    mockApi();
    render(<CustomerListPage />);

    expect(screen.getByRole("link", { name: "+ 신규 등록" })).toHaveAttribute(
      "href",
      "/customers/new",
    );
  });

  it("담당 영업 필터를 options 로 채운다", async () => {
    mockApi();
    render(<CustomerListPage />);

    expect(
      await screen.findByRole("option", { name: "김영업" }),
    ).toBeInTheDocument();
  });

  it("관리자 전용 /api/sales-reps 목록을 부르지 않는다", async () => {
    const fetchMock = mockApi();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("/api/sales-reps/options");
    expect(urls.filter((url) => /^\/api\/sales-reps(\?|$)/.test(url))).toEqual(
      [],
    );
  });

  it("검색 조건 네 가지를 쿼리 파라미터로 넘긴다", async () => {
    const fetchMock = mockApi();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");
    await screen.findByRole("option", { name: "김영업" });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("고객명/회사명"), "가나");
    await user.selectOptions(screen.getByLabelText("담당 영업"), "3");
    await user.selectOptions(screen.getByLabelText("등급"), "B");
    await user.selectOptions(screen.getByLabelText("상태"), "INACTIVE");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => expect(customerCalls(fetchMock).length).toBe(2));
    const url = customerCalls(fetchMock)[1];
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("keyword")).toBe("가나");
    expect(params.get("assignedRepId")).toBe("3");
    expect(params.get("grade")).toBe("B");
    expect(params.get("status")).toBe("INACTIVE");
  });

  it("빈 조건은 쿼리에 넣지 않는다", async () => {
    const fetchMock = mockApi();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    await userEvent.setup().click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => expect(customerCalls(fetchMock).length).toBe(2));
    const params = new URL(customerCalls(fetchMock)[1], "http://localhost")
      .searchParams;
    for (const key of ["keyword", "assignedRepId", "grade", "status"]) {
      expect(params.has(key)).toBe(false);
    }
  });

  it("결과가 없으면 안내를 보여준다", async () => {
    mockApi(() => ok(pageData([])));

    render(<CustomerListPage />);

    expect(
      await screen.findByText("조회 결과가 없습니다."),
    ).toBeInTheDocument();
  });

  it("403 이면 권한 메시지를 보여주고 이동하지 않는다 (관리자)", async () => {
    window.localStorage.setItem(
      "daily-report.rep",
      JSON.stringify({ repId: 4, name: "시스템관리자", role: "ADMIN" }),
    );
    mockApi(() => fail(403, "FORBIDDEN"));

    render(<CustomerListPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "영업사원·상급자만 사용할 수 있습니다",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("401 이면 토큰을 지우고 로그인으로 보낸다", async () => {
    mockApi(() => fail(401, "UNAUTHORIZED"));

    render(<CustomerListPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem("daily-report.accessToken")).toBeNull();
  });

  it("토큰이 없으면 로그인으로 보낸다", async () => {
    window.localStorage.clear();
    mockApi();

    render(<CustomerListPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("영업사원·상급자는 이동시키지 않는다", async () => {
    for (const role of ["SALES_REP", "MANAGER"]) {
      replace.mockClear();
      window.localStorage.setItem(
        "daily-report.rep",
        JSON.stringify({ repId: 2, name: "홍길동", role }),
      );
      mockApi();

      const { unmount } = render(<CustomerListPage />);
      await screen.findByText("테스트고객");

      expect(replace).not.toHaveBeenCalled();
      unmount();
      vi.restoreAllMocks();
    }
  });
});

// #93: 뮤테이션 확인에서 검색 중 잠금을 지우거나 끝난 뒤 풀지 않아도 통과했다.
describe("SCR-400 검색 중 잠금 — #93", () => {
  it("검색하는 동안 [검색] 은 눌리지 않고 끝나면 다시 열린다", async () => {
    let release!: (response: Response) => void;
    let calls = 0;
    mockApi(() => {
      calls += 1;
      if (calls === 1) return ok(pageData(ROWS));
      return new Promise<Response>((resolve) => {
        release = resolve;
      }) as unknown as Response;
    });
    const user = userEvent.setup();
    render(<CustomerListPage />);
    await screen.findByText("테스트고객");

    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(screen.getByRole("button", { name: "검색 중…" })).toBeDisabled();
    release(ok(pageData(ROWS)));
    expect(await screen.findByRole("button", { name: "검색" })).toBeEnabled();
  });
});
