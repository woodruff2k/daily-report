import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// useRouter 는 안정된 객체를 돌려준다. 렌더마다 새 객체면 [router] 의존 효과가
// 매번 다시 돌아 테스트가 틀린 이유로 통과한다.
const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import ReportListPage from "./page";

// 이슈 #12 SCR-200 수용 기준. 오늘은 2026-10-05 로 고정한다.
const ROWS = [
  {
    reportId: 10,
    reportDate: "2026-10-05",
    visitCount: 3,
    status: "SUBMITTED",
    commentCount: 2,
    updatedAt: new Date(2026, 9, 5, 18, 10).toISOString(),
  },
  {
    reportId: 9,
    reportDate: "2026-09-28",
    visitCount: 2,
    status: "DRAFT",
    commentCount: 0,
    updatedAt: new Date(2026, 8, 28, 17, 40).toISOString(),
  },
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const ok = (data: unknown, status = 200) =>
  json(status, { success: true, data, error: null });
const fail = (status: number, code: string, message = "오류") =>
  json(status, {
    success: false,
    data: null,
    error: { code, message },
  });

function pageData(
  content: unknown[],
  page = 0,
  totalPages = 1,
  totalElements = content.length,
) {
  return {
    content,
    page,
    size: 20,
    totalElements,
    totalPages,
  };
}

type Handler = (url: string, init?: RequestInit) => Response;

function mockApi(handler: Handler = () => ok(pageData(ROWS))) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) =>
      Promise.resolve(handler(String(input), init)),
    );
}

function getCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === "GET")
    .map(([url]) => new URL(String(url), "http://localhost"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 5, 20, 0) });
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId: 2, name: "홍길동", role: "SALES_REP" }),
  );
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SCR-200 일일보고 목록 — #12", () => {
  it("본인 보고를 보고일자·방문건수·댓글·최종수정과 함께 보여준다", async () => {
    mockApi();
    render(<ReportListPage />);

    expect(await screen.findByText("2026-10-05")).toBeInTheDocument();
    const row = screen.getByText("2026-10-05").closest("tr")!;
    const cells = within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    // 오늘 고친 보고는 시각만
    expect(cells.slice(0, 5)).toEqual([
      "2026-10-05",
      "3",
      "제출",
      "2",
      "18:10",
    ]);
  });

  it("오늘이 아닌 최종수정은 날짜를 붙인다", async () => {
    mockApi();
    render(<ReportListPage />);
    const row = (await screen.findByText("2026-09-28")).closest("tr")!;
    expect(within(row).getByText("09-28 17:40")).toBeInTheDocument();
  });

  it("기본 기간은 최근 1개월이고 reportDate 내림차순으로 요청한다", async () => {
    const fetchMock = mockApi();
    render(<ReportListPage />);
    await screen.findByText("2026-10-05");

    const url = getCalls(fetchMock)[0];
    expect(url.pathname).toBe("/api/reports");
    expect(url.searchParams.get("fromDate")).toBe("2026-09-05");
    expect(url.searchParams.get("toDate")).toBe("2026-10-05");
    expect(url.searchParams.get("sort")).toBe("reportDate,desc");
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.has("status")).toBe(false);
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-09-05");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-10-05");
  });

  it("기간·상태 필터를 쿼리로 전달한다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<ReportListPage />);
    await screen.findByText("2026-10-05");

    await user.clear(screen.getByLabelText("시작일"));
    await user.type(screen.getByLabelText("시작일"), "2026-01-01");
    await user.clear(screen.getByLabelText("종료일"));
    await user.type(screen.getByLabelText("종료일"), "2026-01-31");
    await user.selectOptions(screen.getByLabelText("상태"), "DRAFT");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => {
      const last = getCalls(fetchMock).at(-1)!;
      expect(last.searchParams.get("fromDate")).toBe("2026-01-01");
      expect(last.searchParams.get("toDate")).toBe("2026-01-31");
      expect(last.searchParams.get("status")).toBe("DRAFT");
    });
  });

  it("상태 전체는 쿼리에 넣지 않는다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<ReportListPage />);
    await screen.findByText("2026-10-05");

    await user.selectOptions(screen.getByLabelText("상태"), "SUBMITTED");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(getCalls(fetchMock).at(-1)!.searchParams.get("status")).toBe(
        "SUBMITTED",
      ),
    );

    await user.selectOptions(screen.getByLabelText("상태"), "");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(getCalls(fetchMock).at(-1)!.searchParams.has("status")).toBe(
        false,
      ),
    );
  });

  it("상태 뱃지가 작성중·제출을 다르게 보여준다", async () => {
    mockApi();
    render(<ReportListPage />);
    const draft = await screen.findByText("작성중", { selector: "span" });
    const submitted = screen.getByText("제출", { selector: "span" });
    expect(draft.className).not.toBe(submitted.className);
  });

  it("상세 링크가 /reports/{id} 로 간다", async () => {
    mockApi();
    render(<ReportListPage />);
    await screen.findByText("2026-10-05");
    const links = screen.getAllByRole("link", { name: "상세" });
    expect(links[0]).toHaveAttribute("href", "/reports/10");
    expect(links[1]).toHaveAttribute("href", "/reports/9");
  });

  describe("페이지네이션", () => {
    function paged(url: string) {
      const page = Number(
        new URL(url, "http://localhost").searchParams.get("page"),
      );
      return ok(pageData(ROWS, page, 3));
    }

    it("이전·다음이 page 를 바꾸고 양 끝에서 비활성이다", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi(paged);
      render(<ReportListPage />);
      await screen.findByText("1 / 3 페이지");

      expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "다음" }));
      await screen.findByText("2 / 3 페이지");
      expect(getCalls(fetchMock).at(-1)!.searchParams.get("page")).toBe("1");

      await user.click(screen.getByRole("button", { name: "다음" }));
      await screen.findByText("3 / 3 페이지");
      expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "이전" }));
      await screen.findByText("2 / 3 페이지");
      expect(getCalls(fetchMock).at(-1)!.searchParams.get("page")).toBe("1");
    });

    it("필터를 바꾸면 페이지가 0 으로 돌아간다", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi(paged);
      render(<ReportListPage />);
      await screen.findByText("1 / 3 페이지");
      await user.click(screen.getByRole("button", { name: "다음" }));
      await screen.findByText("2 / 3 페이지");

      await user.selectOptions(screen.getByLabelText("상태"), "DRAFT");
      await user.click(screen.getByRole("button", { name: "검색" }));

      await screen.findByText("1 / 3 페이지");
      const last = getCalls(fetchMock).at(-1)!;
      expect(last.searchParams.get("page")).toBe("0");
      expect(last.searchParams.get("status")).toBe("DRAFT");
    });
  });

  // 조회가 실패하면 묵은 결과를 남기지 않는다. 남기면 지금 필터와 맞지 않는 행과
  // 건수가 오류 옆에 그대로 보이고, 다음 버튼이 없어진 결과 집합을 넘긴다.
  it("조회가 실패하면 이전 결과와 건수를 치운다", async () => {
    const user = userEvent.setup();
    let failNext = false;
    mockApi(() =>
      failNext
        ? fail(
            400,
            "INVALID_REQUEST",
            "fromDate 는 toDate 보다 늦을 수 없습니다.",
          )
        : ok(pageData(ROWS, 0, 3, 55)),
    );
    render(<ReportListPage />);
    await screen.findByText("2026-10-05");
    expect(screen.getByText("총 55건")).toBeInTheDocument();

    failNext = true;
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "늦을 수 없습니다",
    );
    expect(screen.queryByText("2026-10-05")).not.toBeInTheDocument();
    expect(screen.queryByText("총 55건")).not.toBeInTheDocument();
    expect(screen.getByText("총 0건")).toBeInTheDocument();
  });

  describe("[+ 오늘 보고 작성]", () => {
    it("201 이면 새 보고의 편집으로 이동한다", async () => {
      const user = userEvent.setup();
      const fetchMock = mockApi((url, init) =>
        init?.method === "POST"
          ? ok({ reportId: 77, status: "DRAFT" }, 201)
          : ok(pageData(ROWS)),
      );
      render(<ReportListPage />);
      await screen.findByText("2026-10-05");

      await user.click(
        screen.getByRole("button", { name: "+ 오늘 보고 작성" }),
      );

      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/reports/77/edit"),
      );
      const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
      expect(JSON.parse(String(post[1]!.body))).toEqual({
        reportDate: "2026-10-05",
      });
    });

    // 409 는 오류가 아니다. 다만 찾은 보고의 상태로 목적지가 갈린다 — SCR-210 은
    // DRAFT 전용이고 서버의 lockDraftReport 가 제출된 보고의 저장을 409
    // REPORT_LOCKED 로 막으므로, 제출본을 작성 화면에 데려다 놓으면 저장할 수
    // 없는 화면이 된다.
    function todayLookup(todays: unknown) {
      return mockApi((url, init) => {
        if (init?.method === "POST") {
          return fail(409, "REPORT_ALREADY_EXISTS");
        }
        const params = new URL(url, "http://localhost").searchParams;
        return params.get("fromDate") === "2026-10-05" &&
          params.get("toDate") === "2026-10-05"
          ? ok(pageData([todays]))
          : ok(pageData(ROWS));
      });
    }

    it("409 이고 오늘자가 DRAFT 면 작성 화면으로 보낸다", async () => {
      const user = userEvent.setup();
      const fetchMock = todayLookup({ ...ROWS[0], status: "DRAFT" });
      render(<ReportListPage />);
      await screen.findByText("2026-09-28");

      await user.click(
        screen.getByRole("button", { name: "+ 오늘 보고 작성" }),
      );

      await waitFor(() =>
        expect(push).toHaveBeenCalledWith("/reports/10/edit"),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(getCalls(fetchMock).length).toBeGreaterThanOrEqual(2);
    });

    it("409 이고 오늘자가 제출됐으면 작성 화면이 아니라 상세로 보낸다", async () => {
      const user = userEvent.setup();
      todayLookup(ROWS[0]); // ROWS[0] 은 SUBMITTED 다
      render(<ReportListPage />);
      await screen.findByText("2026-09-28");

      await user.click(
        screen.getByRole("button", { name: "+ 오늘 보고 작성" }),
      );

      await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/10"));
      expect(push).not.toHaveBeenCalledWith("/reports/10/edit");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("그 밖의 오류는 메시지로 보여주고 이동하지 않는다", async () => {
      const user = userEvent.setup();
      mockApi((url, init) =>
        init?.method === "POST"
          ? fail(400, "INVALID_REQUEST", "보고일자 형식이 올바르지 않습니다.")
          : ok(pageData(ROWS)),
      );
      render(<ReportListPage />);
      await screen.findByText("2026-10-05");

      await user.click(
        screen.getByRole("button", { name: "+ 오늘 보고 작성" }),
      );

      // INVALID_REQUEST 는 조건이 여러 개라 화면이 단정하지 않고 서버 문장을 쓴다.
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "보고일자 형식이 올바르지 않습니다.",
      );
      expect(push).not.toHaveBeenCalled();
    });
  });

  // 403 은 서버가 조건별로 정확한 문장을 준다(역할 불일치, 조회 범위 밖, …). 모두
  // 코드 `FORBIDDEN` 하나로 오므로 화면이 한 문장으로 덮으면 맞지 않는 안내가
  // 나간다 — 조회 범위 밖의 보고를 연 상급자에게 "영업사원·상급자만" 은 거짓이다.
  it("403 이면 서버가 준 사유를 보여주고 이동하지 않는다 (관리자)", async () => {
    window.localStorage.setItem(
      "daily-report.rep",
      JSON.stringify({ repId: 4, name: "시스템관리자", role: "ADMIN" }),
    );
    // ADMIN 은 역할로 막힌다 — assertAnyRole 이 주는 실제 문장이다.
    mockApi(() => fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다."));
    render(<ReportListPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이 작업을 수행할 권한이 없습니다.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("403 에 문장이 없으면 기본 권한 문구로 돌아간다", async () => {
    mockApi(() => fail(403, "FORBIDDEN", ""));
    render(<ReportListPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "영업사원·상급자만 사용할 수 있습니다",
    );
  });

  it("401 이면 토큰을 지우고 로그인으로 보낸다", async () => {
    mockApi(() => fail(401, "UNAUTHORIZED"));
    render(<ReportListPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem("daily-report.accessToken")).toBeNull();
  });

  it("토큰이 없으면 로그인으로 보낸다", async () => {
    window.localStorage.clear();
    mockApi();
    render(<ReportListPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  // 이 화면의 loaded 주석은 "조회 실패에서 '조회 결과가 없습니다' 가 뜬다" 를 막는
  // 것이라고 적었지만, setLoaded(true) 가 finally 에 있어 실패도 "불러왔다" 로
  // 읽혔다. (#15 검토에서 발견)
  it("조회가 실패하면 빈 결과 문구와 쪽수를 보여주지 않는다", async () => {
    const user = userEvent.setup();
    let failNext = false;
    mockApi(() =>
      failNext
        ? fail(
            400,
            "INVALID_REQUEST",
            "fromDate 는 toDate 보다 늦을 수 없습니다.",
          )
        : ok(pageData(ROWS, 0, 3, 55)),
    );
    render(<ReportListPage />);
    await screen.findByText("2026-10-05");

    failNext = true;
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "늦을 수 없습니다",
    );
    expect(screen.queryByText("조회 결과가 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+ 페이지/)).not.toBeInTheDocument();
  });
});
