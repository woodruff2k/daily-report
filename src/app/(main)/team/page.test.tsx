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

import TeamReportsPage from "./page";

/**
 * SCR-300 팀 보고 조회 (이슈 #15). 오늘은 2026-10-05 로 고정한다.
 *
 * 덮는 TC (테스트명세서 FR-10 조회/검색 행): **TC-RPT-03**(기간 조회·페이지네이션)
 * 과 **TC-RPT-04**(상태 필터)의 화면 쪽, **TC-SEC-02**(팀 범위 밖 조회 차단 — 이
 * 화면에서는 403 문장을 보이고 이동하지 않는 것)다. 그 세 TC 의 서버 쪽은
 * `src/app/api/reports/team/route.ts` 가 덮는다.
 */
const TEAM = [
  { repId: 1, name: "김팀원", status: "ACTIVE" },
  { repId: 2, name: "이영업", status: "ACTIVE" },
  { repId: 7, name: "박퇴사", status: "INACTIVE" },
];

const ROWS = [
  {
    reportId: 10,
    reportDate: "2026-10-05",
    visitCount: 3,
    status: "SUBMITTED",
    commentCount: 2,
    updatedAt: new Date(2026, 9, 5, 18, 10).toISOString(),
    rep: { repId: 1, name: "김팀원" },
  },
  {
    reportId: 9,
    reportDate: "2026-09-28",
    visitCount: 2,
    status: "DRAFT",
    commentCount: 0,
    updatedAt: new Date(2026, 8, 28, 17, 40).toISOString(),
    rep: { repId: 2, name: "이영업" },
  },
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const ok = (data: unknown) => json(200, { success: true, data, error: null });
const fail = (status: number, code: string, message: string) =>
  json(status, { success: false, data: null, error: { code, message } });

function pageData(content: unknown[], page = 0, totalPages = 1, total = 0) {
  return {
    content,
    page,
    size: 20,
    totalElements: total || content.length,
    totalPages,
  };
}

type Handler = (url: URL) => Response;

function mockApi(handlers: { team?: Handler; list?: Handler } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/sales-reps/team") {
      return Promise.resolve((handlers.team ?? (() => ok(TEAM)))(url));
    }
    if (url.pathname === "/api/customers") {
      return Promise.resolve(
        ok(
          pageData([
            { customerId: 5, customerName: "가나다", companyName: "라마상사" },
          ]),
        ),
      );
    }
    return Promise.resolve((handlers.list ?? (() => ok(pageData(ROWS))))(url));
  });
}

function listCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls
    .map(([url]) => new URL(String(url), "http://localhost"))
    .filter((url) => url.pathname === "/api/reports/team");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 5, 20, 0) });
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId: 3, name: "최상급", role: "MANAGER" }),
  );
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SCR-300 팀 보고 조회 — #15", () => {
  it("MANAGER 는 목록을 보고 작성자 컬럼이 있다", async () => {
    mockApi();
    render(<TeamReportsPage />);

    expect(await screen.findByText("2026-10-05")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "작성자" }),
    ).toBeInTheDocument();
    const row = screen.getByText("2026-10-05").closest("tr")!;
    const cells = within(row)
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
    expect(cells.slice(0, 6)).toEqual([
      "김팀원",
      "2026-10-05",
      "3",
      "제출",
      "2",
      "18:10",
    ]);
  });

  it("기본 요청은 최근 1개월·reportDate,desc 이고 repIds 를 보내지 않는다", async () => {
    const fetchMock = mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    const url = listCalls(fetchMock)[0];
    expect(url.searchParams.get("fromDate")).toBe("2026-09-05");
    expect(url.searchParams.get("toDate")).toBe("2026-10-05");
    expect(url.searchParams.get("sort")).toBe("reportDate,desc");
    expect(url.searchParams.has("repIds")).toBe(false);
    expect(url.searchParams.has("customerId")).toBe(false);
  });

  it("팀원을 여러 명 고르면 repIds=1,2 로 전달한다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    await user.click(await screen.findByRole("checkbox", { name: "이영업" }));
    await user.click(screen.getByRole("checkbox", { name: "김팀원" }));
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(listCalls(fetchMock).at(-1)!.searchParams.get("repIds")).toBe(
        "1,2",
      ),
    );
  });

  it("골랐다가 모두 해제하면 repIds 를 다시 보내지 않는다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    const box = await screen.findByRole("checkbox", { name: "김팀원" });
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(listCalls(fetchMock).at(-1)!.searchParams.get("repIds")).toBe("1"),
    );

    await user.click(box);
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() =>
      expect(listCalls(fetchMock).at(-1)!.searchParams.has("repIds")).toBe(
        false,
      ),
    );
  });

  it("기간·상태 필터를 fromDate·toDate·status 로 전달한다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    await user.clear(screen.getByLabelText("시작일"));
    await user.type(screen.getByLabelText("시작일"), "2026-01-01");
    await user.clear(screen.getByLabelText("종료일"));
    await user.type(screen.getByLabelText("종료일"), "2026-01-31");
    await user.selectOptions(screen.getByLabelText("상태"), "DRAFT");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => {
      const last = listCalls(fetchMock).at(-1)!;
      expect(last.searchParams.get("fromDate")).toBe("2026-01-01");
      expect(last.searchParams.get("toDate")).toBe("2026-01-31");
      expect(last.searchParams.get("status")).toBe("DRAFT");
    });
  });

  it("고객을 골라 검색하면 customerId 를 전달한다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    await user.type(screen.getByRole("textbox", { name: "고객 검색" }), "가나");
    await user.click(
      await screen.findByRole("button", { name: "가나다 (라마상사)" }),
    );
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() =>
      expect(listCalls(fetchMock).at(-1)!.searchParams.get("customerId")).toBe(
        "5",
      ),
    );
  });

  it("[상세] 링크가 /reports/{id} 로 간다", async () => {
    mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");
    const links = screen.getAllByRole("link", { name: "상세" });
    expect(links[0]).toHaveAttribute("href", "/reports/10");
    expect(links[1]).toHaveAttribute("href", "/reports/9");
  });

  it("영업사원이 URL 로 들어오면 403 문장을 보이고 이동하지 않는다", async () => {
    window.localStorage.setItem(
      "daily-report.rep",
      JSON.stringify({ repId: 2, name: "홍길동", role: "SALES_REP" }),
    );
    const forbidden = () =>
      fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
    mockApi({ team: forbidden, list: forbidden });
    render(<TeamReportsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이 작업을 수행할 권한이 없습니다.",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("2026-10-05")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("401 이면 로그인으로 보낸다", async () => {
    mockApi({
      list: () => fail(401, "UNAUTHORIZED", "인증이 필요합니다."),
    });
    render(<TeamReportsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("비활성 팀원도 선택지에 있고 (비활성) 으로 표시된다", async () => {
    mockApi();
    render(<TeamReportsPage />);
    expect(
      await screen.findByRole("checkbox", { name: "박퇴사 (비활성)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "김팀원" }),
    ).toBeInTheDocument();
  });

  it("팀원이 없으면 빈 상태 문구를 보이고 오류가 아니다", async () => {
    mockApi({ team: () => ok([]), list: () => ok(pageData([])) });
    render(<TeamReportsPage />);

    expect(await screen.findByText("조회 결과가 없습니다.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // 고를 것이 없으므로 "선택하지 않으면 팀 전체를 조회합니다" 는 거짓이다.
    expect(screen.getByText("팀원이 없습니다.")).toBeVisible();
    expect(
      screen.queryByText("선택하지 않으면 팀 전체를 조회합니다."),
    ).not.toBeInTheDocument();
  });

  it("팀원이 있으면 체크를 비우는 뜻을 안내한다", async () => {
    // 안내 문구는 고를 것이 있을 때 필요하다 — 체크를 모두 비우면 팀 전체를
    // 조회한다는 뜻을 알려 주는 문구다.
    mockApi();
    render(<TeamReportsPage />);

    await screen.findByText("2026-10-05");
    expect(
      screen.getByText("선택하지 않으면 팀 전체를 조회합니다."),
    ).toBeVisible();
    expect(screen.queryByText("팀원이 없습니다.")).not.toBeInTheDocument();
  });

  it("팀원 목록을 못 불러오면 팀원이 없다고 단정하지 않는다", async () => {
    // 목록 조회가 실패해도 team 은 빈 배열이 된다. 그때 "팀원이 없습니다" 라고
    // 말하면 사실이 아닌 것을 단정한다 — 사유는 위의 알림이 말한다.
    mockApi({ team: () => fail(500, "INTERNAL_ERROR", "서버 오류") });
    render(<TeamReportsPage />);

    // 500 은 코드가 매핑되지 않아 기본 문구로 간다(서버 문장은 403 과 지정 코드만).
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "팀원 목록을 불러올 수 없습니다.",
    );
    expect(screen.queryByText("팀원이 없습니다.")).not.toBeInTheDocument();
  });

  it("조회 전에는 빈 결과 문구 대신 불러오는 중을 보인다", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    render(<TeamReportsPage />);
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByText("조회 결과가 없습니다.")).not.toBeInTheDocument();
  });

  it("조회가 실패하면 이전 결과와 건수를 치운다", async () => {
    const user = userEvent.setup();
    let failNext = false;
    mockApi({
      list: () =>
        failNext
          ? fail(
              400,
              "INVALID_REQUEST",
              "fromDate 는 toDate 보다 늦을 수 없습니다.",
            )
          : ok(pageData(ROWS, 0, 3, 55)),
    });
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");
    expect(screen.getByText("총 55건")).toBeInTheDocument();

    failNext = true;
    await user.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "늦을 수 없습니다",
    );
    expect(screen.queryByText("2026-10-05")).not.toBeInTheDocument();
    expect(screen.getByText("총 0건")).toBeInTheDocument();
  });

  it("필터를 바꾸면 페이지가 0 으로 돌아간다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      list: (url) =>
        ok(pageData(ROWS, Number(url.searchParams.get("page")), 3)),
    });
    render(<TeamReportsPage />);
    await screen.findByText("1 / 3 페이지");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("2 / 3 페이지");
    expect(listCalls(fetchMock).at(-1)!.searchParams.get("page")).toBe("1");

    await user.selectOptions(screen.getByLabelText("상태"), "DRAFT");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("1 / 3 페이지");
    const last = listCalls(fetchMock).at(-1)!;
    expect(last.searchParams.get("page")).toBe("0");
    expect(last.searchParams.get("status")).toBe("DRAFT");
  });

  // 위의 403 테스트는 두 호출이 **같은 문장**으로 실패하므로, 한쪽 경로를 고정
  // 문장으로 덮어도 다른 쪽 문장이 떠서 통과한다. 경로마다 다른 문장으로 가른다.

  it("팀원 목록만 403 이면 그 호출의 사유를 보여준다", async () => {
    mockApi({
      team: () => fail(403, "FORBIDDEN", "팀 보고를 조회할 권한이 없습니다."),
    });
    render(<TeamReportsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "팀 보고를 조회할 권한이 없습니다.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("보고 조회만 403 이면 그 호출의 사유를 보여준다", async () => {
    mockApi({
      list: () => fail(403, "FORBIDDEN", "소속 팀원 범위를 벗어난 조회입니다."),
    });
    render(<TeamReportsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "소속 팀원 범위를 벗어난 조회입니다.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("고객 검색이 비활성 고객도 찾는다 (status 를 좁히지 않는다)", async () => {
    // 마스터를 지우지 않고 비활성화하는 이유가 과거 보고와의 참조 유지(NFR-03)다.
    // 그 고객으로 필터할 수 없으면 보존한 이력에 닿을 수 없다.
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    await user.type(screen.getByLabelText("고객 검색"), "가나");

    await waitFor(() => {
      const search = fetchMock.mock.calls
        .map(([url]) => new URL(String(url), "http://localhost"))
        .find((url) => url.pathname === "/api/customers");
      expect(search).toBeDefined();
      expect(search!.searchParams.get("keyword")).toBe("가나");
      expect(search!.searchParams.has("status")).toBe(false);
    });
  });

  it("조회가 실패하면 빈 결과 문구와 쪽수를 보여주지 않는다", async () => {
    // 질의가 거절된 것은 "결과가 없는" 것이 아니다. 오류 옆에 "조회 결과가
    // 없습니다" 를 붙이면 거짓을 말하고, totalPages 가 0 이 된 채 pageIndex 가
    // 남아 "1 / 1 페이지" 같은 뜻 없는 값이 보인다.
    mockApi({
      list: () =>
        fail(
          400,
          "INVALID_REQUEST",
          "fromDate 는 toDate 보다 늦을 수 없습니다.",
        ),
    });
    render(<TeamReportsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "늦을 수 없습니다",
    );
    expect(screen.queryByText("조회 결과가 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+ 페이지/)).not.toBeInTheDocument();
  });
});

// #93: totalPages 를 비우는 코드를 지워도 기존 테스트가 통과했다. 쪽수 문구는 오류 중에
// "-" 로 가려져 값이 보이지 않고, 보이는 곳은 [다음] 의 활성 여부다.
describe("SCR-300 — #93 보강", () => {
  it("조회가 실패하면 [다음] 이 없어진 결과 집합을 넘기지 못한다", async () => {
    const user = userEvent.setup();
    let failNext = false;
    mockApi({
      list: () =>
        failNext
          ? fail(
              400,
              "INVALID_REQUEST",
              "fromDate 는 toDate 보다 늦을 수 없습니다.",
            )
          : ok(pageData(ROWS, 0, 3, 55)),
    });
    render(<TeamReportsPage />);
    await screen.findByText("1 / 3 페이지");
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();

    failNext = true;
    await user.click(screen.getByRole("button", { name: "검색" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
  });

  it("이전·다음이 page 를 바꾸고 양 끝에서 비활성이다", async () => {
    // 이 화면의 쪽 이동은 필터 초기화 테스트에서 [다음] 만 쓰였고 [이전] 은 한 번도
    // 눌리지 않았다. [이전] 의 비활성 조건을 뒤집어도 통과했다(#93).
    const user = userEvent.setup();
    const fetchMock = mockApi({
      list: (url) =>
        ok(pageData(ROWS, Number(url.searchParams.get("page")), 3)),
    });
    render(<TeamReportsPage />);
    await screen.findByText("1 / 3 페이지");

    expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("2 / 3 페이지");
    expect(screen.getByRole("button", { name: "이전" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "다음" }));
    await screen.findByText("3 / 3 페이지");
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "이전" }));
    await screen.findByText("2 / 3 페이지");
    expect(listCalls(fetchMock).at(-1)!.searchParams.get("page")).toBe("1");
  });

  it("조회하는 동안 [검색] 은 눌리지 않고 끝나면 다시 열린다", async () => {
    let release!: (response: Response) => void;
    let calls = 0;
    mockApi({
      list: () => {
        calls += 1;
        if (calls === 1) return ok(pageData(ROWS));
        return new Promise<Response>((resolve) => {
          release = resolve;
        }) as unknown as Response;
      },
    });
    const user = userEvent.setup();
    render(<TeamReportsPage />);
    await screen.findByText("2026-10-05");

    await user.click(screen.getByRole("button", { name: "검색" }));

    // 비활성만으로는 조회가 돌고 있는지 알 수 없다. 다른 목록 화면(SCR-200·400·500)
    // 과 같이 문구도 바뀐다 — 팀 화면만 빠져 있었다(#93 검토).
    const pending = screen.getByRole("button", { name: "검색 중…" });
    expect(pending).toBeDisabled();
    release(ok(pageData(ROWS)));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "검색" })).toBeEnabled(),
    );
  });
});
