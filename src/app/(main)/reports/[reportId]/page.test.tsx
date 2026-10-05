import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// useRouter·useParams 는 안정된 객체를 돌려준다. 렌더마다 새 객체면 [router] 의존
// 효과가 매번 다시 돌아 테스트가 틀린 이유로 통과한다.
const replace = vi.fn();
const push = vi.fn();
const router = { replace, push };
const params = { reportId: "10" }; // 같은 객체를 유지하고 값만 바꿔 재렌더한다
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => params,
}));

import ReportDetailPage from "./page";

// 이슈 #14 SCR-220 수용 기준 (TC-CMT-01~03·08 의 화면 쪽). 작성자는 repId 2.
const AUTHOR = 2;
const MANAGER = 3;

function detail(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 10,
    rep: { repId: AUTHOR, name: "합성사원" },
    reportDate: "2026-10-05",
    status: "SUBMITTED",
    submittedAt: "2026-10-05T18:10:00+09:00",
    visits: [
      {
        visitId: 100,
        customer: { customerId: 5, customerName: "에이상사" },
        visitTime: "10:00",
        visitType: "VISIT",
        content: "방문내용100",
        result: "긍정적",
        sortOrder: 1,
      },
    ],
    problems: [
      { problemId: 200, customerId: 6, content: "납기 문의", status: "OPEN" },
    ],
    plans: [
      {
        planId: 300,
        customerId: 7,
        plannedDate: "2026-10-06",
        content: "견적 발송",
      },
    ],
    ...overrides,
  };
}

const THREADS = [
  {
    commentId: 400,
    deleted: false,
    commenter: { repId: MANAGER, name: "김상급" },
    content: "견적 일정 확인 바람",
    parentCommentId: null,
    createdAt: "2026-10-05T19:00:00+09:00",
    replies: [],
  },
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const ok = (data: unknown) => json(200, { success: true, data, error: null });
const fail = (status: number, code: string) =>
  json(status, {
    success: false,
    data: null,
    error: { code, message: "서버 문장" },
  });

type Handler = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

function mockApi(handler: Handler = () => undefined, report = detail()) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    const custom = handler(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.pathname === "/api/reports/10") return Promise.resolve(ok(report));
    if (url.pathname === "/api/reports/10/comments")
      return Promise.resolve(ok(THREADS));
    const one = url.pathname.match(/^\/api\/customers\/(\d+)$/);
    if (one)
      return Promise.resolve(
        ok({ customerId: Number(one[1]), customerName: `고객${one[1]}` }),
      );
    return Promise.resolve(fail(404, "NOT_FOUND"));
  });
}

function login(repId: number) {
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId, name: "합성", role: "MANAGER" }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  params.reportId = "10";
  replace.mockClear();
  push.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("SCR-220 일일보고 상세·조회 — #14", () => {
  it("방문·과제·계획을 읽기 전용으로 보이고 과제·계획의 고객 이름을 채운다", async () => {
    login(MANAGER);
    mockApi();
    render(<ReportDetailPage />);

    await screen.findByText("방문내용100");
    expect(screen.getByText("보고일자: 2026-10-05")).toBeInTheDocument();
    expect(screen.getByText("작성자: 합성사원")).toBeInTheDocument();
    expect(screen.getByText("상태: 제출")).toBeInTheDocument();
    expect(screen.getByText(/^제출: .*:\d\d/)).toBeInTheDocument();
    // 읽기 전용: 표 안에 입력 요소가 없다.
    const visits = screen.getByRole("table", { name: "방문 기록" });
    expect(within(visits).getByText("에이상사")).toBeInTheDocument();
    expect(within(visits).queryByRole("textbox")).not.toBeInTheDocument();
    // 과제·계획 응답에는 이름이 없다.
    const problems = screen.getByRole("table", { name: "과제/상담" });
    expect(await within(problems).findByText("고객6")).toBeInTheDocument();
    const plans = screen.getByRole("table", { name: "내일 할 일" });
    expect(await within(plans).findByText("고객7")).toBeInTheDocument();
  });

  it("이름 조회가 끝나지 않아도 보고 내용은 먼저 보인다", async () => {
    login(MANAGER);
    mockApi((url) =>
      /^\/api\/customers\/\d+$/.test(url.pathname)
        ? new Promise<Response>(() => {}) // 영원히 끝나지 않는다
        : undefined,
    );
    render(<ReportDetailPage />);

    expect(await screen.findByText("방문내용100")).toBeInTheDocument();
    expect(screen.getByText("납기 문의")).toBeInTheDocument();
    expect(screen.getByText("고객 #6")).toBeInTheDocument();
    expect(screen.getByText("고객 #7")).toBeInTheDocument();
  });

  it("이름 조회가 실패하면 그 칸만 식별자로 둔다", async () => {
    login(MANAGER);
    mockApi((url) =>
      /^\/api\/customers\/\d+$/.test(url.pathname)
        ? fail(500, "INTERNAL")
        : undefined,
    );
    render(<ReportDetailPage />);
    expect(await screen.findByText("고객 #6")).toBeInTheDocument();
    expect(screen.getByText("고객 #7")).toBeInTheDocument();
  });

  it("이름 조회가 401 이면 삼키지 않고 로그인으로 보낸다", async () => {
    login(MANAGER);
    mockApi((url) =>
      /^\/api\/customers\/\d+$/.test(url.pathname)
        ? fail(401, "UNAUTHORIZED")
        : undefined,
    );
    render(<ReportDetailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("SUBMITTED 보고에는 [수정] 이 없다", async () => {
    login(MANAGER);
    mockApi();
    render(<ReportDetailPage />);
    await screen.findByText("방문내용100");
    expect(
      screen.queryByRole("button", { name: "수정" }),
    ).not.toBeInTheDocument();
  });

  it("DRAFT 보고에는 [수정] 이 있고 편집 화면으로 이동한다. 댓글 입력창·[답글] 은 없다", async () => {
    const user = userEvent.setup();
    login(AUTHOR);
    mockApi(undefined, detail({ status: "DRAFT", submittedAt: null }));
    render(<ReportDetailPage />);

    await user.click(await screen.findByRole("button", { name: "수정" }));
    expect(push).toHaveBeenCalledWith("/reports/10/edit");
    expect(screen.getByText("상태: 작성중")).toBeInTheDocument();
    expect(screen.queryByLabelText("댓글 내용")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "답글" }),
    ).not.toBeInTheDocument();
  });

  it("작성자가 아닌 뷰어(직속 상급자)에게는 루트 입력창이 보인다", async () => {
    login(MANAGER);
    mockApi();
    render(<ReportDetailPage />);
    expect(await screen.findByLabelText("댓글 내용")).toBeInTheDocument();
  });

  it("작성자 본인에게는 루트 입력창이 없고 [답글] 만 있다", async () => {
    login(AUTHOR);
    mockApi();
    render(<ReportDetailPage />);
    await screen.findByText("견적 일정 확인 바람");
    expect(screen.queryByLabelText("댓글 내용")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "답글" })).toBeInTheDocument();
  });

  it("조회가 실패하면 오류만 보이고 묵은 보고를 남기지 않는다", async () => {
    login(MANAGER);
    mockApi((url) =>
      url.pathname === "/api/reports/10" ? fail(404, "NOT_FOUND") : undefined,
    );
    render(<ReportDetailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "보고를 찾을 수 없습니다.",
    );
    expect(screen.queryByText("방문내용100")).not.toBeInTheDocument();
  });

  it("조회가 401 이면 로그인으로 보낸다", async () => {
    login(MANAGER);
    mockApi((url) =>
      url.pathname === "/api/reports/10"
        ? fail(401, "UNAUTHORIZED")
        : undefined,
    );
    render(<ReportDetailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  // `/code-review` 가 찾은 것들. 고치기만 하고 테스트가 없으면 조용히 되돌아간다.

  it("DRAFT 라도 작성자가 아니면 [수정] 버튼을 두지 않는다", async () => {
    // 조회는 작성자와 직속 상급자 모두에게 열려 있어 상급자가 팀원의 DRAFT 보고를
    // 이 화면에서 본다. 상태만 보고 버튼을 두면 상급자가 편집 폼까지 들어가
    // 입력한 뒤 저장에서야 403 을 받고 **입력이 전부 사라진다.**
    login(MANAGER);
    mockApi(undefined, detail({ status: "DRAFT", submittedAt: null }));
    render(<ReportDetailPage />);

    await screen.findByText("방문내용100");
    expect(screen.getByText("상태: 작성중")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "수정" }),
    ).not.toBeInTheDocument();
  });

  it("DRAFT 이고 작성자 본인이면 [수정] 버튼이 있다", async () => {
    login(AUTHOR);
    mockApi(undefined, detail({ status: "DRAFT", submittedAt: null }));
    render(<ReportDetailPage />);

    await screen.findByText("방문내용100");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "수정" }));
    expect(push).toHaveBeenCalledWith("/reports/10/edit");
  });

  it("다른 보고로 옮겨 가면 앞 보고의 내용을 먼저 치운다", async () => {
    // 남기면 댓글 영역이 **새 reportId 와 앞 보고의 작성자·상태** 를 함께 받아
    // 입력창이 틀린 작성자 기준으로 뜨거나 DRAFT 보고에 [답글] 이 생긴다.
    login(MANAGER);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/reports/10")
        return Promise.resolve(ok(detail()));
      if (url.pathname === "/api/reports/11")
        return new Promise<Response>(() => {});
      if (/^\/api\/customers\/\d+$/.test(url.pathname))
        return Promise.resolve(ok({ customerId: 6, customerName: "고객6" }));
      return Promise.resolve(ok([]));
    });

    const view = render(<ReportDetailPage />);
    await screen.findByText("방문내용100");

    params.reportId = "11";
    view.rerender(<ReportDetailPage />);

    // 11 번은 아직 응답이 없다. 10 번의 내용이 남아 있으면 안 된다.
    await waitFor(() =>
      expect(screen.queryByText("방문내용100")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("작성자: 합성사원")).not.toBeInTheDocument();
  });
});
