import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const router = { push, replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import SalesRepForm from "./sales-rep-form";
import type { SalesRepFormValues } from "@/lib/client/sales-rep-api";

const MANAGERS = [
  {
    repId: 1,
    empNo: "S2026001",
    name: "김부장",
    department: "영업1팀",
    position: "부장",
    managerId: null,
    managerName: null,
    role: "MANAGER",
    status: "ACTIVE",
  },
];

const EDIT_VALUES: SalesRepFormValues = {
  empNo: "S2026002",
  name: "홍길동",
  email: "hong@example.com",
  department: "영업1팀",
  position: "대리",
  managerId: "1",
  role: "SALES_REP",
  status: "ACTIVE",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function managerListResponse() {
  return json(200, {
    success: true,
    data: {
      content: MANAGERS,
      page: 0,
      size: 100,
      totalElements: 1,
      totalPages: 1,
    },
    error: null,
  });
}

/**
 * 상급자 목록 조회가 항상 첫 호출이다. 그 뒤 호출들을 인자 순서로 지정한다.
 * 호출 색인 1번부터가 화면이 보낸 요청이다.
 */
function mockFetch(...responses: Response[]) {
  const mock = vi.spyOn(globalThis, "fetch");
  mock.mockResolvedValueOnce(managerListResponse());

  for (const response of responses) {
    mock.mockResolvedValueOnce(response);
  }

  return mock;
}

async function fillRequired() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("사번"), "S9999");
  await user.type(screen.getByLabelText("이름"), "신규사원");
  await user.type(screen.getByLabelText("이메일"), "new@example.com");
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "admin.token");
  push.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SCR-510 등록 — #17", () => {
  it("상급자 Select 를 MANAGER·활성으로 걸러 받는다", async () => {
    const fetchMock = mockFetch();

    render(<SalesRepForm />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("role=MANAGER");
    expect(String(url)).toContain("status=ACTIVE");
  });

  it("상급자 목록을 선택 항목으로 보여준다", async () => {
    mockFetch();

    render(<SalesRepForm />);

    expect(
      await screen.findByRole("option", { name: "김부장 (S2026001)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "없음" })).toBeInTheDocument();
  });

  it("필수 항목이 비면 서버를 부르지 않는다", async () => {
    const fetchMock = mockFetch();
    render(<SalesRepForm />);
    await screen.findByLabelText("사번");

    await userEvent.setup().click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("사번");
    // 상급자 목록 조회 1회뿐이어야 한다.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("등록하면 임시 비밀번호를 1회 보여준다 (#44)", async () => {
    mockFetch(
      json(201, {
        success: true,
        data: {
          repId: 9,
          empNo: "S9999",
          temporaryPassword: "generated-temp-xyz",
        },
        error: null,
      }),
    );
    render(<SalesRepForm />);
    await screen.findByLabelText("사번");

    const user = await fillRequired();
    await user.click(screen.getByRole("button", { name: "저장" }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("generated-temp-xyz");
    expect(notice).toHaveTextContent("다시 볼 수 없으므로");
    // 임시 비밀번호를 보여줘야 하므로 목록으로 바로 이동하지 않는다.
    expect(push).not.toHaveBeenCalled();
  });

  it("사번이 중복이면 서버 메시지를 보여준다 (TC-REP-02)", async () => {
    mockFetch(
      json(409, {
        success: false,
        data: null,
        error: {
          code: "DUPLICATE_EMP_NO",
          message: "이미 사용 중인 사번입니다.",
        },
      }),
    );
    render(<SalesRepForm />);
    await screen.findByLabelText("사번");

    const user = await fillRequired();
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이미 사용 중인 사번입니다.",
    );
  });

  it("선택 항목을 비워 두면 그 필드를 보내지 않는다", async () => {
    const fetchMock = mockFetch(
      json(201, {
        success: true,
        data: { repId: 9, empNo: "S9999" },
        error: null,
      }),
    );
    render(<SalesRepForm />);
    await screen.findByLabelText("사번");

    const user = await fillRequired();
    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // 빈 문자열을 보내면 서버 스키마가 거부한다.
    expect(body).not.toHaveProperty("department");
    expect(body).not.toHaveProperty("managerId");
  });

  it("등록 화면에는 비활성화·재발급 버튼이 없다", async () => {
    mockFetch();

    render(<SalesRepForm />);
    await screen.findByLabelText("사번");

    expect(
      screen.queryByRole("button", { name: "비활성화" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "임시 비밀번호 재발급" }),
    ).not.toBeInTheDocument();
  });
});

describe("SCR-510 수정 — #17", () => {
  it("기존 값을 채워 보여준다", async () => {
    mockFetch();

    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);

    expect(screen.getByLabelText("사번")).toHaveValue("S2026002");
    expect(screen.getByLabelText("이메일")).toHaveValue("hong@example.com");
    await waitFor(() =>
      expect(screen.getByLabelText("상급자")).toHaveValue("1"),
    );
  });

  it("상급자 목록에서 본인을 제외한다", async () => {
    mockFetch();

    render(<SalesRepForm repId={1} initialValues={EDIT_VALUES} />);

    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "김부장 (S2026001)" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("저장하면 PUT 으로 보내고 목록으로 돌아간다", async () => {
    const fetchMock = mockFetch(
      json(200, { success: true, data: { repId: 2 }, error: null }),
    );
    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-reps"));
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("/api/sales-reps/2");
    expect(init?.method).toBe("PUT");
  });

  it("비활성화하면 PATCH 로 보낸다 (TC-REP-04)", async () => {
    const fetchMock = mockFetch(
      json(200, { success: true, data: { repId: 2 }, error: null }),
    );
    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "비활성화" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-reps"));
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("/api/sales-reps/2/status");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "INACTIVE" });
  });

  it("마지막 관리자 비활성화는 서버 메시지를 보여준다 (#49)", async () => {
    mockFetch(
      json(409, {
        success: false,
        data: null,
        error: {
          code: "LAST_ACTIVE_ADMIN",
          message: "마지막 활성 관리자입니다. 다른 관리자를 먼저 만드세요.",
        },
      }),
    );
    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "비활성화" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "마지막 활성 관리자",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("재발급하면 임시 비밀번호를 1회 보여준다 (#44)", async () => {
    mockFetch(
      json(200, {
        success: true,
        data: {
          repId: 2,
          empNo: "S2026002",
          temporaryPassword: "reissued-temp-xyz",
        },
        error: null,
      }),
    );
    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "임시 비밀번호 재발급" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "reissued-temp-xyz",
    );
    expect(push).not.toHaveBeenCalled();
  });
});

// #93: 뮤테이션 확인에서 제출 중 잠금을 지우거나, 끝난 뒤 풀지 않아도 통과했다.
describe("SCR-510 제출 중 잠금 — #93", () => {
  /** 첫 호출(상급자 목록)은 바로 응답하고, 그 뒤 호출은 직접 풀어 줄 때까지 붙잡는다. */
  function holdWrites() {
    let release!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        if (String(input).startsWith("/api/sales-reps?")) {
          return Promise.resolve(managerListResponse());
        }
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      });
    return { fetchMock, release: (response: Response) => release(response) };
  }

  const writeCalls = (fetchMock: ReturnType<typeof holdWrites>["fetchMock"]) =>
    fetchMock.mock.calls.filter(
      ([input]) => !String(input).startsWith("/api/sales-reps?"),
    );

  it("등록 요청이 끝나기 전에는 [저장] 이 눌리지 않고, 끝나면 다시 열린다", async () => {
    const { fetchMock, release } = holdWrites();
    render(<SalesRepForm />);
    await screen.findByLabelText("사번");
    const user = await fillRequired();

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    release(
      json(201, {
        success: true,
        data: { repId: 9, temporaryPassword: "temp-pass-1" },
        error: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("temp-pass-1");
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    expect(writeCalls(fetchMock)).toHaveLength(1);
  });

  it("등록이 실패하면 [저장] 이 다시 열린다", async () => {
    mockFetch(
      json(400, {
        success: false,
        data: null,
        error: { code: "INVALID_REQUEST", message: "형식 오류" },
      }),
    );
    render(<SalesRepForm />);
    await screen.findByLabelText("사번");
    const user = await fillRequired();

    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("alert");

    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("비활성화 요청이 끝나기 전에는 세 버튼이 모두 잠긴다", async () => {
    const { fetchMock, release } = holdWrites();
    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "비활성화" }));

    expect(screen.getByRole("button", { name: "비활성화" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "임시 비밀번호 재발급" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    release(json(200, { success: true, data: { repId: 2 }, error: null }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales-reps"));
    expect(writeCalls(fetchMock)).toHaveLength(1);
  });

  it("재발급 요청이 끝나기 전에는 [임시 비밀번호 재발급] 이 다시 눌리지 않고, 끝나면 열린다", async () => {
    const { fetchMock, release } = holdWrites();
    render(<SalesRepForm repId={2} initialValues={EDIT_VALUES} />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "임시 비밀번호 재발급" }),
    );

    expect(
      screen.getByRole("button", { name: "임시 비밀번호 재발급" }),
    ).toBeDisabled();
    release(
      json(200, {
        success: true,
        data: { repId: 2, empNo: "S2026002", temporaryPassword: "again-1" },
        error: null,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("again-1");
    expect(
      screen.getByRole("button", { name: "임시 비밀번호 재발급" }),
    ).toBeEnabled();
    expect(writeCalls(fetchMock)).toHaveLength(1);
  });
});
