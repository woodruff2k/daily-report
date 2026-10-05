import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 안정된 객체. 렌더마다 새로 만들면 [router] 의존 효과가 반복된다.
const push = vi.fn();
const replace = vi.fn();
const router = { push, replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import CustomerForm from "./customer-form";
import type { CustomerFormValues } from "@/lib/client/customer-api";

const OPTIONS = [
  { repId: 2, name: "홍길동" },
  { repId: 3, name: "김영업" },
];

const EDIT_VALUES: CustomerFormValues = {
  customerName: "테스트고객",
  companyName: "(주)가나다",
  phone: "02-000-0000",
  email: "customer@example.com",
  address: "서울 어딘가",
  grade: "A",
  assignedRepId: "2",
  status: "ACTIVE",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, code: string, message = "오류") {
  return json(status, { success: false, data: null, error: { code, message } });
}

/** options 는 항상 성공시키고, 그 외 요청은 handler 가 응답한다. */
function mockApi(handler: (url: string, init?: RequestInit) => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url === "/api/sales-reps/options") {
      return Promise.resolve(
        json(200, { success: true, data: OPTIONS, error: null }),
      );
    }
    return Promise.resolve(handler(url, init));
  });
}

function writes(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(
    ([url]) => String(url) !== "/api/sales-reps/options",
  );
}

function savedOk() {
  return json(200, { success: true, data: { customerId: 1 }, error: null });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("daily-report.accessToken", "user.token");
  push.mockClear();
  replace.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("고객/담당자명"), "신규고객");
  await screen.findByRole("option", { name: "김영업" });
  await user.selectOptions(screen.getByLabelText("담당 영업"), "3");
}

describe("SCR-410 등록 — #16", () => {
  it("담당 영업 Select 를 options 로 채운다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(<CustomerForm />);

    expect(
      await screen.findByRole("option", { name: "김영업" }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/sales-reps/options",
    ]);
  });

  it("필수 항목이 비면 서버에 저장 요청을 보내지 않는다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(<CustomerForm />);
    await screen.findByRole("option", { name: "김영업" });

    await userEvent.setup().click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("고객/담당자명");
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("담당 영업을 고르지 않으면 막는다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(<CustomerForm />);
    await screen.findByRole("option", { name: "김영업" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("고객/담당자명"), "신규고객");

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("담당 영업");
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("이메일 형식이 틀리면 화면에서 막는다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);
    await user.type(screen.getByLabelText("이메일"), "not-an-email");

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("이메일");
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("연락처 형식이 틀리면 화면에서 막는다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);
    await user.type(screen.getByLabelText("연락처"), "abc");

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("연락처");
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("서버가 이메일 형식 400 을 돌려주면 문장으로 보여준다", async () => {
    // 화면 검증을 통과한 값을 서버가 거부하는 경우. 서버 검증이 기준이다.
    mockApi(() => fail(400, "INVALID_REQUEST"));
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이메일·연락처 형식",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("등록하면 POST 로 보내고 목록으로 이동한다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);
    await user.type(screen.getByLabelText("이메일"), "new@example.com");

    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    const [url, init] = writes(fetchMock)[0];
    expect(String(url)).toBe("/api/customers");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      customerName: "신규고객",
      email: "new@example.com",
      assignedRepId: 3,
      status: "ACTIVE",
    });
  });

  it.each([
    [
      "ASSIGNED_REP_INACTIVE",
      "비활성 상태인 사원은 담당 영업으로 지정할 수 없습니다",
    ],
    ["ASSIGNED_REP_NOT_FOUND", "담당 영업을 찾을 수 없습니다"],
  ])("서버 코드 %s 를 읽을 수 있는 문장으로 보여준다", async (code, text) => {
    mockApi(() => fail(400, code, "raw server message"));
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "저장" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent(code);
    expect(push).not.toHaveBeenCalled();
  });

  it("403 이면 권한 메시지를 보여준다", async () => {
    mockApi(() => fail(403, "FORBIDDEN"));
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "영업사원·상급자만 사용할 수 있습니다",
    );
  });

  it("401 이면 토큰을 지우고 로그인으로 보낸다", async () => {
    mockApi(() => fail(401, "UNAUTHORIZED"));
    render(<CustomerForm />);
    const user = userEvent.setup();
    await fillRequired(user);

    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(window.localStorage.getItem("daily-report.accessToken")).toBeNull();
  });

  it("[취소] 는 목록으로 돌아가고 [비활성화] 는 등록에 없다", async () => {
    mockApi(() => savedOk());
    render(<CustomerForm />);

    expect(
      screen.queryByRole("button", { name: "비활성화" }),
    ).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "취소" }));

    expect(push).toHaveBeenCalledWith("/customers");
  });
});

describe("SCR-410 수정 — #16", () => {
  it("기존 값이 채워진다", async () => {
    mockApi(() => savedOk());
    render(
      <CustomerForm
        customerId={1}
        initialValues={EDIT_VALUES}
        initialAssignedRepName="홍길동"
      />,
    );

    expect(screen.getByLabelText("고객/담당자명")).toHaveValue("테스트고객");
    expect(screen.getByLabelText("회사명")).toHaveValue("(주)가나다");
    expect(screen.getByLabelText("연락처")).toHaveValue("02-000-0000");
    expect(screen.getByLabelText("이메일")).toHaveValue("customer@example.com");
    expect(screen.getByLabelText("주소")).toHaveValue("서울 어딘가");
    expect(screen.getByLabelText("고객등급")).toHaveValue("A");
    expect(screen.getByLabelText("상태")).toHaveValue("ACTIVE");
    await waitFor(() =>
      expect(screen.getByLabelText("담당 영업")).toHaveValue("2"),
    );
  });

  it("저장하면 모든 필드를 PUT 으로 보낸다 (전체 교체)", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(
      <CustomerForm
        customerId={1}
        initialValues={EDIT_VALUES}
        initialAssignedRepName="홍길동"
      />,
    );
    await screen.findByRole("option", { name: "김영업" });
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("고객/담당자명"));
    await user.type(screen.getByLabelText("고객/담당자명"), "수정고객");
    await user.clear(screen.getByLabelText("주소"));

    await user.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    const [url, init] = writes(fetchMock)[0];
    expect(String(url)).toBe("/api/customers/1");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      customerName: "수정고객",
      companyName: "(주)가나다",
      phone: "02-000-0000",
      email: "customer@example.com",
      address: null,
      grade: "A",
      assignedRepId: 2,
      status: "ACTIVE",
    });
  });

  // 결정 1. 회귀하기 쉬운 자리다.
  describe("담당자가 비활성이어서 options 에 없을 때", () => {
    const INACTIVE_REP: CustomerFormValues = {
      ...EDIT_VALUES,
      assignedRepId: "9",
    };

    it("'<이름> (비활성)' 옵션을 끼워 넣고 선택된 상태로 둔다", async () => {
      mockApi(() => savedOk());
      render(
        <CustomerForm
          customerId={1}
          initialValues={INACTIVE_REP}
          initialAssignedRepName="퇴사자"
        />,
      );

      expect(
        await screen.findByRole("option", { name: "퇴사자 (비활성)" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("담당 영업")).toHaveValue("9");
      expect(screen.getByLabelText("담당 영업")).toHaveDisplayValue(
        "퇴사자 (비활성)",
      );
    });

    it("이름만 고쳐도 그 담당자 그대로 저장된다", async () => {
      const fetchMock = mockApi(() => savedOk());
      render(
        <CustomerForm
          customerId={1}
          initialValues={INACTIVE_REP}
          initialAssignedRepName="퇴사자"
        />,
      );
      await screen.findByRole("option", { name: "퇴사자 (비활성)" });
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("고객/담당자명"), "수정");

      await user.click(screen.getByRole("button", { name: "저장" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
      const [, init] = writes(fetchMock)[0];
      expect(JSON.parse(String(init?.body)).assignedRepId).toBe(9);
    });

    it("활성 담당자이면 끼워 넣지 않는다", async () => {
      mockApi(() => savedOk());
      render(
        <CustomerForm
          customerId={1}
          initialValues={EDIT_VALUES}
          initialAssignedRepName="홍길동"
        />,
      );
      await screen.findByRole("option", { name: "김영업" });

      expect(screen.queryByText(/\(비활성\)/)).not.toBeInTheDocument();
    });
  });

  it("[비활성화] 는 확인을 받은 뒤 PATCH 로 호출하고 DELETE 는 부르지 않는다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(
      <CustomerForm
        customerId={1}
        initialValues={EDIT_VALUES}
        initialAssignedRepName="홍길동"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "비활성화" }));

    // 확인 전에는 서버를 부르지 않는다.
    const dialog = await screen.findByRole("dialog");
    expect(writes(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    const calls = writes(fetchMock);
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toBe("/api/customers/1/status");
    expect(calls[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      status: "INACTIVE",
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    expect(dialog).toBeDefined();
  });

  it("확인 창에서 취소하면 호출하지 않는다", async () => {
    const fetchMock = mockApi(() => savedOk());
    render(
      <CustomerForm
        customerId={1}
        initialValues={EDIT_VALUES}
        initialAssignedRepName="홍길동"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "비활성화" }));
    const dialog = await screen.findByRole("dialog");

    const cancel = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "취소",
    );
    await user.click(cancel as HTMLElement);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(writes(fetchMock)).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });
});
