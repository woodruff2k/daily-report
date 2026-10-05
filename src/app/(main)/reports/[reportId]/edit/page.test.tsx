import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// useRouter·useParams 는 안정된 객체를 돌려준다. 렌더마다 새 객체면 [router] 의존
// 효과가 매번 다시 돌아 테스트가 틀린 이유로 통과한다.
const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };
const params = { reportId: "10" };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => params,
}));

import ReportEditPage from "./page";

// 이슈 #13 SCR-210 수용 기준. 오늘은 2026-10-05 로 고정한다.
const visit = (visitId: number, customerId: number, name: string) => ({
  visitId,
  customer: { customerId, customerName: name },
  visitTime: "10:00",
  visitType: "VISIT",
  content: `내용${visitId}`,
  result: null,
  sortOrder: visitId - 99,
});

function detail(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 10,
    rep: { repId: 2, name: "합성사원" },
    reportDate: "2026-10-05",
    status: "DRAFT",
    submittedAt: null,
    visits: [visit(100, 5, "에이상사")],
    problems: [
      {
        problemId: 200,
        customerId: 6,
        content: "납기 문의",
        status: "OPEN",
        sortOrder: 1,
      },
    ],
    plans: [
      {
        planId: 300,
        customerId: 7,
        plannedDate: "2026-10-06",
        content: "견적 발송",
        sortOrder: 1,
      },
    ],
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const ok = (data: unknown) => json(200, { success: true, data, error: null });
const fail = (status: number, code: string, message = "오류") =>
  json(status, { success: false, data: null, error: { code, message } });

const CUSTOMER_ROWS = [
  {
    customerId: 8,
    customerName: "비마트",
    companyName: "비주식회사",
    status: "ACTIVE",
  },
];

type Handler = (url: URL, init?: RequestInit) => Response | undefined;

/** 기본 서버. `handler` 가 먼저 응답하고, 없으면 기본 응답을 쓴다. */
function mockApi(handler: Handler = () => undefined, initial = detail()) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const custom = handler(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.pathname === "/api/reports/10" && method === "GET")
      return Promise.resolve(ok(initial));
    if (url.pathname === "/api/reports/10" && method === "PUT")
      return Promise.resolve(ok(initial));
    if (url.pathname === "/api/reports/10/submit")
      return Promise.resolve(
        ok({ reportId: 10, status: "SUBMITTED", submittedAt: "x" }),
      );
    if (url.pathname === "/api/customers" && method === "GET")
      return Promise.resolve(
        ok({
          content: CUSTOMER_ROWS,
          page: 0,
          size: 20,
          totalElements: 1,
          totalPages: 1,
        }),
      );
    const one = url.pathname.match(/^\/api\/customers\/(\d+)$/);
    if (one)
      return Promise.resolve(
        ok({ customerId: Number(one[1]), customerName: `고객${one[1]}` }),
      );
    return Promise.resolve(fail(404, "NOT_FOUND"));
  });
}

/** PUT/POST 호출만 (메서드, 경로, 본문) 순서대로. */
function writes(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") !== "GET")
    .map(([url, init]) => ({
      method: init?.method,
      path: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 5, 20, 0) });
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  // 작성자 본인으로 로그인한다(상세의 rep.repId 와 같다). 편집 화면은 작성자만
  // 들어갈 수 있어 이것이 없으면 모든 테스트가 상세로 돌려보내진다.
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId: 2, name: "합성사원", role: "SALES_REP" }),
  );
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openForm() {
  render(<ReportEditPage />);
  await screen.findByRole("button", { name: "임시저장" });
}

describe("SCR-210 일일보고 작성·수정 — #13", () => {
  it("헤더와 기존 행을 보여주고, 과제·계획의 고객 이름을 getCustomer 로 채운다", async () => {
    mockApi();
    await openForm();

    expect(screen.getByText("보고일자: 2026-10-05")).toBeInTheDocument();
    expect(screen.getByText("작성자: 합성사원")).toBeInTheDocument();
    expect(screen.getByText("상태: 작성중")).toBeInTheDocument();
    expect(screen.getByLabelText("방문 1행 방문내용")).toHaveValue("내용100");
    // 과제·계획 응답에는 이름이 없다.
    const problemRow = screen.getByLabelText("과제 1행 내용").closest("tr")!;
    expect(within(problemRow).getByText("고객6")).toBeInTheDocument();
    const planRow = screen.getByLabelText("계획 1행 내용").closest("tr")!;
    expect(within(planRow).getByText("고객7")).toBeInTheDocument();
  });

  it("이름 조회가 실패하면 화면을 막지 않고 그 칸만 식별자로 둔다", async () => {
    mockApi((url) =>
      /^\/api\/customers\/\d+$/.test(url.pathname)
        ? fail(500, "INTERNAL")
        : undefined,
    );
    await openForm();
    expect(screen.getByText("고객 #6")).toBeInTheDocument();
    expect(screen.getByText("고객 #7")).toBeInTheDocument();
  });

  it("[+ 행 추가] 는 세 섹션에 빈 행을 더한다 (예정일 기본값은 보고일자의 익일)", async () => {
    const user = userEvent.setup();
    mockApi(undefined, detail({ visits: [], problems: [], plans: [] }));
    await openForm();

    await user.click(screen.getByRole("button", { name: "방문 기록 행 추가" }));
    await user.click(screen.getByRole("button", { name: "과제/상담 행 추가" }));
    await user.click(
      screen.getByRole("button", { name: "내일 할 일 행 추가" }),
    );

    expect(screen.getByLabelText("방문 1행 방문내용")).toHaveValue("");
    expect(screen.getByLabelText("과제 1행 내용")).toHaveValue("");
    expect(screen.getByLabelText("계획 1행 내용")).toHaveValue("");
    expect(screen.getByLabelText("계획 1행 예정일")).toHaveValue("2026-10-06");
  });

  it("[x 삭제] 는 그 행만 지운다 — 가운데 행을 지워도 나머지 입력이 유지된다", async () => {
    const user = userEvent.setup();
    mockApi(undefined, detail({ visits: [], problems: [], plans: [] }));
    await openForm();

    for (let i = 0; i < 3; i += 1) {
      await user.click(
        screen.getByRole("button", { name: "방문 기록 행 추가" }),
      );
    }
    // 내용(제어 입력)과 고객 검색어(행 컴포넌트 내부 상태) 모두 행을 따라가야 한다.
    for (const [n, text] of [
      [1, "첫째"],
      [2, "둘째"],
      [3, "셋째"],
    ] as const) {
      await user.type(screen.getByLabelText(`방문 ${n}행 방문내용`), text);
      await user.type(screen.getByLabelText(`방문 ${n}행 고객 검색`), `검${n}`);
    }

    await user.click(screen.getByRole("button", { name: "방문 2행 삭제" }));

    expect(
      screen.queryByLabelText("방문 3행 방문내용"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("방문 1행 방문내용")).toHaveValue("첫째");
    expect(screen.getByLabelText("방문 1행 고객 검색")).toHaveValue("검1");
    expect(screen.getByLabelText("방문 2행 방문내용")).toHaveValue("셋째");
    expect(screen.getByLabelText("방문 2행 고객 검색")).toHaveValue("검3");
  });

  it("고객을 검색해 고르면 이름이 보이고 저장 본문에 customerId 가 담긴다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(undefined, detail({ visits: [] }));
    await openForm();

    await user.click(screen.getByRole("button", { name: "방문 기록 행 추가" }));
    await user.type(screen.getByLabelText("방문 1행 고객 검색"), "비마");
    await user.click(
      await screen.findByRole("button", { name: "비마트 (비주식회사)" }),
    );

    expect(screen.getByText("비마트")).toBeInTheDocument();
    const search = fetchMock.mock.calls
      .map(([url]) => new URL(String(url), "http://localhost"))
      .find((url) => url.pathname === "/api/customers" && url.search !== "")!;
    expect(search.searchParams.get("keyword")).toBe("비마");
    expect(search.searchParams.get("status")).toBe("ACTIVE");
    expect(search.searchParams.get("size")).toBe("20");

    await user.type(screen.getByLabelText("방문 1행 방문내용"), "재고 문의");
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByRole("status");

    const put = writes(fetchMock)[0];
    expect(put.body.visits[0]).toMatchObject({
      customerId: 8,
      content: "재고 문의",
      visitType: "VISIT",
      sortOrder: 1,
    });
    expect(put.body.visits[0]).not.toHaveProperty("visitId");
  });

  it("선택을 해제하고 다시 고를 수 있다", async () => {
    const user = userEvent.setup();
    mockApi();
    await openForm();

    await user.click(
      screen.getByRole("button", { name: "과제 1행 고객 선택 해제" }),
    );
    expect(screen.getByLabelText("과제 1행 고객 검색")).toBeInTheDocument();
  });

  it("기존 행을 수정해 저장하면 visitId·problemId·planId 가 본문에 담긴다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    await openForm();

    const content = screen.getByLabelText("방문 1행 방문내용");
    await user.clear(content);
    await user.type(content, "수정한 내용");
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByRole("status");

    const [put] = writes(fetchMock);
    expect(put.method).toBe("PUT");
    expect(put.path).toBe("/api/reports/10");
    expect(put.body.visits[0]).toMatchObject({
      visitId: 100,
      customerId: 5,
      content: "수정한 내용",
    });
    expect(put.body.problems[0]).toMatchObject({
      problemId: 200,
      customerId: 6,
    });
    expect(put.body.plans[0]).toMatchObject({ planId: 300, customerId: 7 });
  });

  it("[임시저장] 은 PUT 만 호출하고 머무르며, 응답의 새 식별자를 다음 저장에 쓴다", async () => {
    const user = userEvent.setup();
    const saved = detail({
      visits: [visit(100, 5, "에이상사"), visit(101, 8, "비마트")],
    });
    const fetchMock = mockApi((url, init) =>
      url.pathname === "/api/reports/10" && init?.method === "PUT"
        ? ok(saved)
        : undefined,
    );
    await openForm();

    await user.click(screen.getByRole("button", { name: "방문 기록 행 추가" }));
    await user.type(screen.getByLabelText("방문 2행 고객 검색"), "비마");
    await user.click(
      await screen.findByRole("button", { name: "비마트 (비주식회사)" }),
    );
    await user.type(screen.getByLabelText("방문 2행 방문내용"), "신규");
    await user.click(screen.getByRole("button", { name: "임시저장" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "임시저장했습니다.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(writes(fetchMock)).toHaveLength(1);
    expect(writes(fetchMock)[0].body.visits[1]).not.toHaveProperty("visitId");

    // 응답으로 폼이 갱신되어 새 행이 식별자를 갖는다. 다시 저장하면 수정으로 간다.
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await waitFor(() => expect(writes(fetchMock)).toHaveLength(2));
    expect(writes(fetchMock)[1].body.visits[1]).toMatchObject({
      visitId: 101,
      customerId: 8,
    });
  });

  it("[제출] 은 PUT 다음 POST /submit 을 호출하고 /reports/{id} 로 이동한다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    await openForm();

    await user.click(screen.getByRole("button", { name: "제출" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/10"));
    expect(
      writes(fetchMock).map((call) => `${call.method} ${call.path}`),
    ).toEqual(["PUT /api/reports/10", "POST /api/reports/10/submit"]);
  });

  it("방문 0건이면 제출을 막고 메시지를 보이며 submit 을 호출하지 않는다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(undefined, detail({ visits: [] }));
    await openForm();

    await user.click(screen.getByRole("button", { name: "제출" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "방문 기록을 1건 이상 입력해야 제출할 수 있습니다.",
    );
    expect(writes(fetchMock)).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it("서버가 VISITS_REQUIRED 를 주면 읽을 수 있는 문장으로 보이고 이동하지 않는다", async () => {
    const user = userEvent.setup();
    mockApi((url) =>
      url.pathname === "/api/reports/10/submit"
        ? fail(400, "VISITS_REQUIRED", "x")
        : undefined,
    );
    await openForm();

    await user.click(screen.getByRole("button", { name: "제출" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "방문 기록을 1건 이상 입력해야 제출할 수 있습니다.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("필수 항목(고객·방문내용)이 비면 저장하지 않는다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(undefined, detail({ visits: [] }));
    await openForm();

    await user.click(screen.getByRole("button", { name: "방문 기록 행 추가" }));
    await user.click(screen.getByRole("button", { name: "임시저장" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("방문 기록 1행: 고객을 선택하세요.");
    expect(alert).toHaveTextContent("방문 기록 1행: 방문내용을 입력하세요.");
    expect(writes(fetchMock)).toEqual([]);
  });

  it("서버가 REPORT_LOCKED 로 저장을 거절하면 그 사유를 보여준다", async () => {
    const user = userEvent.setup();
    mockApi((url, init) =>
      url.pathname === "/api/reports/10" && init?.method === "PUT"
        ? fail(409, "REPORT_LOCKED")
        : undefined,
    );
    await openForm();
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "제출된 보고는 수정할 수 없습니다.",
    );
  });

  it("SUBMITTED 보고는 폼을 보여주지 않고 /reports/{id} 로 보낸다", async () => {
    mockApi(undefined, detail({ status: "SUBMITTED" }));
    render(<ReportEditPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reports/10"));
    expect(
      screen.queryByRole("button", { name: "임시저장" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "제출" }),
    ).not.toBeInTheDocument();
  });

  it("작성자가 아니면 폼을 보여주지 않고 상세로 보낸다", async () => {
    // 조회는 작성자와 직속 상급자 모두에게 열려 있어 상급자가 팀원의 DRAFT 보고로
    // 이 URL 에 닿는다. 폼을 보여주면 입력한 뒤 저장에서야 403 을 받고 입력이
    // 전부 사라진다.
    window.localStorage.setItem(
      "daily-report.rep",
      JSON.stringify({ repId: 99, name: "상급자", role: "MANAGER" }),
    );
    mockApi();
    render(<ReportEditPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/reports/10"));
    expect(
      screen.queryByRole("button", { name: "임시저장" }),
    ).not.toBeInTheDocument();
  });

  it("토큰이 없으면 로그인으로 보낸다", async () => {
    window.localStorage.clear();
    mockApi((url) =>
      url.pathname === "/api/reports/10"
        ? fail(401, "UNAUTHORIZED")
        : undefined,
    );
    render(<ReportEditPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

/**
 * `/code-review` 가 찾은 결함들. 고치기만 하고 테스트가 없으면 조용히 되돌아간다.
 */
describe("SCR-210 — 검토에서 고친 것 (#13)", () => {
  it("고객 이름 조회가 끝나지 않아도 폼은 먼저 보인다", async () => {
    // 행마다 요청이 하나씩 늘어난다(최대 200). 전부 기다리면 하나가 늦는 것만으로
    // 이미 받은 방문 기록까지 못 보고 "불러오는 중…" 에 머문다.
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (/^\/api\/customers\/\d+$/.test(url.pathname)) {
        return new Promise<Response>(() => {}); // 영원히 보류
      }
      if (
        url.pathname === "/api/reports/10" &&
        (init?.method ?? "GET") === "GET"
      )
        return Promise.resolve(ok(detail()));
      return Promise.resolve(fail(404, "NOT_FOUND"));
    });

    render(<ReportEditPage />);

    expect(
      await screen.findByRole("button", { name: "임시저장" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("방문 1행 방문내용")).toHaveValue("내용100");
    // 이름만 아직 비어 있다.
    expect(screen.getByText("고객 #6")).toBeInTheDocument();
  });

  it("이름 조회가 401 이면 삼키지 않고 로그인으로 보낸다", async () => {
    // 삼키면 "고객 #6" 이 뜬 폼을 계속 쓰다가 임시저장에서야 끊긴 것을 알게 된다.
    mockApi((url) =>
      /^\/api\/customers\/\d+$/.test(url.pathname)
        ? fail(401, "UNAUTHORIZED")
        : undefined,
    );
    render(<ReportEditPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("고객 검색 실패는 고객 도메인 문장으로 보여준다", async () => {
    const user = userEvent.setup();
    // 피커는 고객 API 를 부른다. 보고 문장을 쓰면 403 이 "일일보고는 영업사원·
    // 상급자만" 으로 나와 고객 검색창 아래에 틀린 안내가 붙는다.
    mockApi((url, init) =>
      url.pathname === "/api/customers" && (init?.method ?? "GET") === "GET"
        ? fail(403, "FORBIDDEN")
        : undefined,
    );
    await openForm();

    await user.click(
      screen.getByRole("button", { name: "방문 1행 고객 선택 해제" }),
    );
    await user.type(screen.getByLabelText("방문 1행 고객 검색"), "비마");

    const alert = await screen.findByRole("alert", undefined, {
      timeout: 2000,
    });
    expect(alert).toHaveTextContent("고객 마스터는 영업사원·상급자만");
    expect(alert).not.toHaveTextContent("일일보고는");
  });

  it("임시저장 뒤 입력을 고치면 성공 메시지를 치운다", async () => {
    const user = userEvent.setup();
    // 안 치우면 "임시저장했습니다" 가 떠 있는 채로 편집하게 되어 저장되지 않은
    // 수정이 저장된 것처럼 보인다.
    mockApi();
    await openForm();

    await user.click(screen.getByRole("button", { name: "임시저장" }));
    expect(await screen.findByText("임시저장했습니다.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("방문 1행 방문내용"), "추가");

    expect(screen.queryByText("임시저장했습니다.")).not.toBeInTheDocument();
  });

  it("임시저장해도 고르던 중인 고객 검색어가 남는다", async () => {
    const user = userEvent.setup();
    // 저장마다 새 key 를 발급하면 React 가 모든 행을 떼고 다시 붙여, 아직 고르지
    // 않은 검색어와 포커스가 사라진다.
    mockApi(
      undefined,
      detail({
        problems: [
          {
            problemId: 200,
            customerId: null,
            content: "납기 문의",
            status: "OPEN",
            sortOrder: 1,
          },
        ],
      }),
    );
    await openForm();

    const search = screen.getByLabelText("과제 1행 고객 검색");
    await user.type(search, "비마");
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByText("임시저장했습니다.");

    expect(screen.getByLabelText("과제 1행 고객 검색")).toHaveValue("비마");
  });
});

/**
 * 과제·계획도 방문기록처럼 화면 순서를 sortOrder 로 보낸다 (이슈 #85).
 *
 * **해당 TC 는 없다.** 가장 가까운 것은 TC-PRB-01·TC-PLN-01(다중 행 저장)이다.
 * 화면에는 행을 중간에 끼우는 조작이 없어 "중간 삽입" 은 report-form.test.ts 가
 * 변환 함수로 덮는다.
 */
describe("SCR-210 — 과제·계획 sortOrder (#85)", () => {
  const problem = (id: number, sortOrder: number, content: string) => ({
    problemId: id,
    customerId: null,
    content,
    status: "OPEN",
    sortOrder,
  });
  const plan = (id: number, sortOrder: number, content: string) => ({
    planId: id,
    customerId: null,
    plannedDate: "2026-10-06",
    content,
    sortOrder,
  });

  it("저장 본문의 과제·계획에 sortOrder 가 1부터 화면 순서대로 담긴다", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(
      undefined,
      detail({
        problems: [problem(1, 1, "가"), problem(2, 2, "나")],
        plans: [plan(1, 1, "다"), plan(2, 2, "라")],
      }),
    );
    await openForm();

    await user.click(screen.getByRole("button", { name: "과제/상담 행 추가" }));
    await user.type(screen.getByLabelText("과제 3행 내용"), "마");
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByRole("status");

    const [put] = writes(fetchMock);
    expect(put.body.problems).toEqual([
      {
        problemId: 1,
        customerId: null,
        content: "가",
        status: "OPEN",
        sortOrder: 1,
      },
      {
        problemId: 2,
        customerId: null,
        content: "나",
        status: "OPEN",
        sortOrder: 2,
      },
      { customerId: null, content: "마", status: "OPEN", sortOrder: 3 },
    ]);
    expect(put.body.plans).toEqual([
      {
        planId: 1,
        customerId: null,
        plannedDate: "2026-10-06",
        content: "다",
        sortOrder: 1,
      },
      {
        planId: 2,
        customerId: null,
        plannedDate: "2026-10-06",
        content: "라",
        sortOrder: 2,
      },
    ]);
  });

  it("행을 지우고 저장하면 sortOrder 가 빈 번호 없이 1부터 다시 매겨진다", async () => {
    const user = userEvent.setup();
    // 서버 값이 1,2,3 이어도 가운데를 지우면 1,2 가 된다(1,3 이 아니다).
    const fetchMock = mockApi(
      undefined,
      detail({
        problems: [problem(1, 1, "A"), problem(2, 2, "B"), problem(3, 3, "C")],
        plans: [plan(1, 1, "P"), plan(2, 2, "Q"), plan(3, 3, "R")],
      }),
    );
    await openForm();

    await user.click(screen.getByRole("button", { name: "과제 2행 삭제" }));
    await user.click(screen.getByRole("button", { name: "계획 2행 삭제" }));
    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByRole("status");

    const [put] = writes(fetchMock);
    expect(
      put.body.problems.map((p: { problemId: number; sortOrder: number }) => [
        p.problemId,
        p.sortOrder,
      ]),
    ).toEqual([
      [1, 1],
      [3, 2],
    ]);
    expect(
      put.body.plans.map((p: { planId: number; sortOrder: number }) => [
        p.planId,
        p.sortOrder,
      ]),
    ).toEqual([
      [1, 1],
      [3, 2],
    ]);
  });

  it("상세를 불러오면 sortOrder 순서로 보이고, 값에 틈이 있어도 1부터 다시 매겨 저장한다", async () => {
    const user = userEvent.setup();
    // 서버가 sortOrder 순으로 주므로 응답 순서와 같다. 틈(5, 9)은 저장 때 메워진다.
    const fetchMock = mockApi(
      undefined,
      detail({
        problems: [
          problem(7, 1, "첫째"),
          problem(5, 5, "둘째"),
          problem(6, 9, "셋째"),
        ],
        plans: [plan(9, 2, "하나"), plan(8, 4, "둘")],
      }),
    );
    await openForm();

    expect(screen.getByLabelText("과제 1행 내용")).toHaveValue("첫째");
    expect(screen.getByLabelText("과제 2행 내용")).toHaveValue("둘째");
    expect(screen.getByLabelText("과제 3행 내용")).toHaveValue("셋째");
    expect(screen.getByLabelText("계획 1행 내용")).toHaveValue("하나");
    expect(screen.getByLabelText("계획 2행 내용")).toHaveValue("둘");

    await user.click(screen.getByRole("button", { name: "임시저장" }));
    await screen.findByRole("status");
    const [put] = writes(fetchMock);
    expect(
      put.body.problems.map((p: { problemId: number; sortOrder: number }) => [
        p.problemId,
        p.sortOrder,
      ]),
    ).toEqual([
      [7, 1],
      [5, 2],
      [6, 3],
    ]);
  });
});
