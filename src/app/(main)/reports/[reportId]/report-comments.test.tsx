import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// useRouter 는 안정된 객체를 돌려준다. 렌더마다 새 객체면 [router] 의존 효과가
// 매번 다시 돌아 테스트가 틀린 이유로 통과한다.
const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ReportComments } from "./report-comments";

// 이슈 #14 SCR-220 댓글 영역. TC-CMT-01·02·03·04·05·08·09 의 화면 쪽.
// 작성자(repId 1) 보고에 대한 상급자는 repId 2 다.
const AUTHOR = 1;
const MANAGER = 2;

const live = (
  id: number,
  repId: number,
  name: string,
  content: string,
  parent: number | null = null,
) => ({
  commentId: id,
  deleted: false,
  commenter: { repId, name },
  content,
  parentCommentId: parent,
  createdAt: "2026-10-04T19:00:00+09:00",
});

const THREADS = [
  {
    ...live(400, MANAGER, "김상급", "견적 일정 확인 바람"),
    replies: [live(401, AUTHOR, "홍작성", "확인했습니다", 400)],
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

/** 목록은 `state.threads` 를 돌려주고, 쓰기는 `onWrite` 가 응답한다. */
function mockServer(
  state: { threads: unknown[] },
  onWrite: (method: string, path: string) => Response = () =>
    new Response(null, { status: 204 }),
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const method = init?.method ?? "GET";
    const path = String(input);
    if (method === "GET") return Promise.resolve(ok(state.threads));
    return Promise.resolve(onWrite(method, path));
  });
}

const calls = (fetchMock: ReturnType<typeof mockServer>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);

function login(repId: number) {
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  window.localStorage.setItem(
    "daily-report.rep",
    JSON.stringify({ repId, name: "합성", role: "MANAGER" }),
  );
}

function show(props: { submitted?: boolean } = {}) {
  render(
    <ReportComments
      reportId={10}
      authorRepId={AUTHOR}
      submitted={props.submitted ?? true}
    />,
  );
}

const comment = (id: number) =>
  screen.getByRole("article", { name: `댓글 ${id}` });

beforeEach(() => {
  window.localStorage.clear();
  replace.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("댓글 계층", () => {
  it("대댓글이 부모 아래 들여쓰기된 목록(중첩 list)으로 렌더된다", async () => {
    login(MANAGER);
    mockServer({ threads: THREADS });
    show();

    const parent = await screen.findByText("견적 일정 확인 바람");
    const reply = screen.getByText("확인했습니다");
    // 대댓글은 부모 li 안의 중첩 list 에 있다.
    const parentItem = parent.closest("li")!;
    expect(within(parentItem).getByText("확인했습니다")).toBeInTheDocument();
    expect(reply.closest("ul")).not.toBe(parent.closest("ul"));
    expect(reply.closest("ul")!.parentElement).toBe(parentItem);
  });
});

describe("루트 입력창은 역할이 아니라 관계다", () => {
  it("작성자가 아닌 뷰어(직속 상급자)는 입력창이 보이고, 등록하면 POST 뒤 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    login(MANAGER);
    const state = { threads: [] as unknown[] };
    const fetchMock = mockServer(state, () => {
      state.threads = THREADS;
      return json(201, {
        success: true,
        data: live(400, MANAGER, "김상급", "견적 일정 확인 바람"),
        error: null,
      });
    });
    show();

    await screen.findByText("댓글이 없습니다.");
    const getsBefore = calls(fetchMock, "GET").length;
    await user.type(
      screen.getByLabelText("댓글 내용"),
      "  견적 일정 확인 바람 ",
    );
    await user.click(screen.getByRole("button", { name: "등록" }));

    const posts = calls(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe("/api/reports/10/comments");
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      content: "견적 일정 확인 바람",
      parentCommentId: null,
    });
    // 응답을 트리에 꽂지 않고 GET 을 다시 부른다.
    expect(await screen.findByText("견적 일정 확인 바람")).toBeInTheDocument();
    expect(calls(fetchMock, "GET").length).toBeGreaterThan(getsBefore);
    expect(screen.getByLabelText("댓글 내용")).toHaveValue("");
  });

  it("작성자 본인에게는 루트 입력창이 없고 [답글] 로만 쓴다", async () => {
    login(AUTHOR);
    mockServer({ threads: THREADS });
    show();

    await screen.findByText("견적 일정 확인 바람");
    expect(screen.queryByLabelText("댓글 내용")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "등록" }),
    ).not.toBeInTheDocument();
    expect(
      within(comment(400)).getByRole("button", { name: "답글" }),
    ).toBeInTheDocument();
  });

  it("저장소의 사용자를 알 수 없으면 입력창을 띄우지 않는다", async () => {
    window.localStorage.setItem("daily-report.accessToken", "user.token");
    mockServer({ threads: THREADS });
    show();
    await screen.findByText("견적 일정 확인 바람");
    expect(screen.queryByLabelText("댓글 내용")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "답글" }),
    ).not.toBeInTheDocument();
  });
});

describe("[답글]", () => {
  it("parentCommentId 가 담긴 POST 를 보내고 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    login(AUTHOR);
    const fetchMock = mockServer({ threads: THREADS }, () =>
      json(201, {
        success: true,
        data: live(402, AUTHOR, "홍작성", "답", 400),
        error: null,
      }),
    );
    show();

    await screen.findByText("견적 일정 확인 바람");
    const getsBefore = calls(fetchMock, "GET").length;
    await user.click(
      within(comment(400)).getByRole("button", { name: "답글" }),
    );
    await user.type(screen.getByLabelText("답글 내용"), "추가 답변");
    await user.click(screen.getByRole("button", { name: "답글 등록" }));

    const posts = calls(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      content: "추가 답변",
      parentCommentId: 400,
    });
    await waitFor(() =>
      expect(calls(fetchMock, "GET").length).toBeGreaterThan(getsBefore),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("답글 내용")).not.toBeInTheDocument(),
    );
  });

  it("대댓글에는 [답글] 이 없다 (1단계 제한)", async () => {
    login(MANAGER);
    mockServer({ threads: THREADS });
    show();
    await screen.findByText("확인했습니다");
    expect(
      within(comment(401)).queryByRole("button", { name: "답글" }),
    ).not.toBeInTheDocument();
    expect(
      within(comment(400)).getByRole("button", { name: "답글" }),
    ).toBeInTheDocument();
  });

  it("서버가 PARENT_DELETED 로 거절하면 읽을 수 있는 문장을 보이고 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    login(AUTHOR);
    const fetchMock = mockServer({ threads: THREADS }, () =>
      fail(400, "PARENT_DELETED"),
    );
    show();
    await screen.findByText("견적 일정 확인 바람");
    const getsBefore = calls(fetchMock, "GET").length;
    await user.click(
      within(comment(400)).getByRole("button", { name: "답글" }),
    );
    await user.type(screen.getByLabelText("답글 내용"), "x");
    await user.click(screen.getByRole("button", { name: "답글 등록" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "삭제된 댓글에는 답글을 달 수 없습니다.",
    );
    expect(calls(fetchMock, "GET").length).toBeGreaterThan(getsBefore);
  });
});

describe("본인 댓글만 [수정]·[삭제]", () => {
  it("본인 댓글에만 버튼이 보인다", async () => {
    login(MANAGER);
    mockServer({ threads: THREADS });
    show();
    await screen.findByText("견적 일정 확인 바람");

    const mine = within(comment(400));
    expect(mine.getByRole("button", { name: "댓글 수정" })).toBeInTheDocument();
    expect(mine.getByRole("button", { name: "댓글 삭제" })).toBeInTheDocument();
    // 401 은 작성자의 댓글이다.
    const theirs = within(comment(401));
    expect(
      theirs.queryByRole("button", { name: "댓글 수정" }),
    ).not.toBeInTheDocument();
    expect(
      theirs.queryByRole("button", { name: "댓글 삭제" }),
    ).not.toBeInTheDocument();
  });

  it("[수정] 은 PUT 으로 내용만 보내고 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    login(MANAGER);
    const fetchMock = mockServer({ threads: THREADS }, () =>
      ok(live(400, MANAGER, "김상급", "고침")),
    );
    show();
    await screen.findByText("견적 일정 확인 바람");
    const getsBefore = calls(fetchMock, "GET").length;

    await user.click(screen.getByRole("button", { name: "댓글 수정" }));
    const box = screen.getByLabelText("댓글 수정 내용");
    expect(box).toHaveValue("견적 일정 확인 바람");
    await user.clear(box);
    await user.type(box, "고침");
    await user.click(screen.getByRole("button", { name: "저장" }));

    const puts = calls(fetchMock, "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toBe("/api/reports/10/comments/400");
    expect(JSON.parse(String(puts[0][1]?.body))).toEqual({ content: "고침" });
    await waitFor(() =>
      expect(calls(fetchMock, "GET").length).toBeGreaterThan(getsBefore),
    );
  });

  it("삭제 확인에서 취소하면 DELETE 를 부르지 않는다", async () => {
    const user = userEvent.setup();
    login(MANAGER);
    const fetchMock = mockServer({ threads: THREADS });
    show();
    await screen.findByText("견적 일정 확인 바람");

    await user.click(screen.getByRole("button", { name: "댓글 삭제" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "취소" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(calls(fetchMock, "DELETE")).toHaveLength(0);
  });

  it("삭제를 확인하면 DELETE 를 부르고 목록을 다시 읽는다", async () => {
    const user = userEvent.setup();
    login(MANAGER);
    const state = { threads: THREADS as unknown[] };
    const fetchMock = mockServer(state, () => {
      state.threads = [];
      return new Response(null, { status: 204 });
    });
    show();
    await screen.findByText("견적 일정 확인 바람");

    await user.click(screen.getByRole("button", { name: "댓글 삭제" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "확인" }));

    const deletes = calls(fetchMock, "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe("/api/reports/10/comments/400");
    expect(await screen.findByText("댓글이 없습니다.")).toBeInTheDocument();
  });
});

describe("삭제된 댓글 (소프트 삭제)", () => {
  const DELETED_THREADS = [
    {
      commentId: 400,
      deleted: true,
      parentCommentId: null,
      createdAt: "2026-10-04T19:00:00+09:00",
      replies: [live(401, AUTHOR, "홍작성", "확인했습니다", 400)],
    },
    {
      commentId: 410,
      deleted: true,
      parentCommentId: null,
      createdAt: "2026-10-04T20:00:00+09:00",
      replies: [],
    },
  ];

  it.each([
    ["직속 상급자", MANAGER],
    ["작성자", AUTHOR],
  ])(
    "%s 화면: 자리표시자·시각만 보이고 작성자·버튼이 없다",
    async (_label, repId) => {
      login(repId);
      mockServer({ threads: DELETED_THREADS });
      show();
      await screen.findByText("확인했습니다");

      const deleted = within(comment(400));
      expect(deleted.getByText("삭제된 댓글입니다")).toBeInTheDocument();
      expect(deleted.getByText(/\d\d:\d\d/)).toBeInTheDocument();
      expect(deleted.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText("김상급")).not.toBeInTheDocument();
    },
  );

  it("대댓글은 그대로 보이고 부모 아래 들여쓰기가 유지된다", async () => {
    login(MANAGER);
    mockServer({ threads: DELETED_THREADS });
    show();
    const reply = await screen.findByText("확인했습니다");
    const parentItem = comment(400).closest("li")!;
    expect(within(parentItem).getByText("확인했습니다")).toBeInTheDocument();
    expect(reply.closest("ul")!.parentElement).toBe(parentItem);
    // 대댓글 자체는 살아 있어 작성자가 보인다. 1단계 제한이라 [답글] 은 없다.
    expect(within(comment(401)).getByText("홍작성")).toBeInTheDocument();
  });

  it("replies 가 빈 삭제된 댓글도 자리표시자만 남은 줄로 보인다", async () => {
    login(MANAGER);
    mockServer({ threads: DELETED_THREADS });
    show();
    await screen.findByText("확인했습니다");
    expect(
      within(comment(410)).getByText("삭제된 댓글입니다"),
    ).toBeInTheDocument();
    expect(within(comment(410)).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DRAFT 보고", () => {
  it("입력창과 [답글] 이 없다 (서버는 409 REPORT_NOT_SUBMITTED)", async () => {
    login(MANAGER);
    mockServer({ threads: THREADS });
    show({ submitted: false });
    await screen.findByText("견적 일정 확인 바람");
    expect(screen.queryByLabelText("댓글 내용")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "답글" }),
    ).not.toBeInTheDocument();
  });

  it("작성자 화면에서도 [답글] 이 없다", async () => {
    login(AUTHOR);
    mockServer({ threads: THREADS });
    show({ submitted: false });
    await screen.findByText("견적 일정 확인 바람");
    expect(
      screen.queryByRole("button", { name: "답글" }),
    ).not.toBeInTheDocument();
  });
});

describe("오류 처리", () => {
  it("목록 조회가 실패하면 오류만 보이고 묵은 댓글을 남기지 않는다", async () => {
    const user = userEvent.setup();
    login(MANAGER);
    let failing = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET")
        return Promise.resolve(failing ? fail(500, "INTERNAL") : ok(THREADS));
      failing = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    show();
    await screen.findByText("견적 일정 확인 바람");

    await user.click(screen.getByRole("button", { name: "댓글 삭제" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "댓글을 불러올 수 없습니다.",
    );
    expect(screen.queryByText("견적 일정 확인 바람")).not.toBeInTheDocument();
  });

  it("401 이면 토큰을 지우고 로그인으로 보낸다", async () => {
    login(MANAGER);
    mockServer({ threads: [] }); // 기본 응답 대신 아래에서 덮어쓴다
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fail(401, "UNAUTHORIZED"));
    show();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem("daily-report.accessToken")).toBeNull();
  });
});
