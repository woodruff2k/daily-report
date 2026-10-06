import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerPicker } from "./customer-picker";
import type { CustomerRef } from "@/lib/client/report-form";

// 이슈 #13 고객 선택 컴포넌트 (SCR-210 세 섹션 공용).
const toMessage = (_caught: unknown, fallback: string) => fallback;

function page(content: unknown[]) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        content,
        page: 0,
        size: 20,
        totalElements: content.length,
        totalPages: 1,
      },
      error: null,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("CustomerPicker", () => {
  it("입력을 디바운스해 한 번만 검색하고 활성 고객을 size 20 으로 요청한다", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        page([{ customerId: 1, customerName: "합성고객", companyName: null }]),
      );
    render(
      <CustomerPicker
        label="고객"
        value={null}
        onChange={vi.fn()}
        toMessage={toMessage}
      />,
    );

    await user.type(screen.getByLabelText("고객 검색"), "합성");
    await screen.findByRole("button", { name: "합성고객" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(url.searchParams.get("keyword")).toBe("합성");
    expect(url.searchParams.get("status")).toBe("ACTIVE");
    expect(url.searchParams.get("size")).toBe("20");
  });

  it("고르면 onChange 에 customerId 와 이름을 넘긴다", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      page([
        { customerId: 1, customerName: "합성고객", companyName: "합성상사" },
      ]),
    );
    const onChange = vi.fn();
    render(
      <CustomerPicker
        label="고객"
        value={null}
        onChange={onChange}
        toMessage={toMessage}
      />,
    );

    await user.type(screen.getByLabelText("고객 검색"), "합");
    await user.click(
      await screen.findByRole("button", { name: "합성고객 (합성상사)" }),
    );

    expect(onChange).toHaveBeenCalledWith({
      customerId: 1,
      customerName: "합성고객",
    });
  });

  it("선택된 값은 이름을 보이고 해제하면 null 을 넘긴다", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value: CustomerRef = { customerId: 1, customerName: "합성고객" };
    render(
      <CustomerPicker
        label="고객"
        value={value}
        onChange={onChange}
        toMessage={toMessage}
      />,
    );

    expect(screen.getByText("합성고객")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "고객 선택 해제" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("결과가 없으면 안내하고, 실패하면 오류를 알린다", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(page([]));
    render(
      <CustomerPicker
        label="고객"
        value={null}
        onChange={vi.fn()}
        toMessage={toMessage}
      />,
    );

    await user.type(screen.getByLabelText("고객 검색"), "없음");
    expect(
      await screen.findByText("검색 결과가 없습니다."),
    ).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new Error("network"));
    await user.type(screen.getByLabelText("고객 검색"), "2");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "고객을 검색할 수 없습니다.",
    );
  });

  it("검색어를 더 입력한 뒤 늦게 도착한 앞 검색의 응답은 최신 결과를 덮지 않는다", async () => {
    // 응답 순서는 요청 순서를 보장하지 않는다. 앞 검색(합)의 응답이 나중에 와서 뒤 검색
    // (합성)의 결과를 밀어내면 사용자가 본 결과가 다른 검색어의 것이 된다(#93).
    const user = userEvent.setup();
    let releaseFirst!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const keyword = new URL(
          String(input),
          "http://localhost",
        ).searchParams.get("keyword");
        if (keyword === "합") {
          return new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(
          page([
            { customerId: 2, customerName: "최신결과", companyName: null },
          ]),
        );
      });
    render(
      <CustomerPicker
        label="고객"
        value={null}
        onChange={vi.fn()}
        toMessage={toMessage}
      />,
    );

    await user.type(screen.getByLabelText("고객 검색"), "합");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.type(screen.getByLabelText("고객 검색"), "성");
    await screen.findByRole("button", { name: "최신결과" });

    releaseFirst(
      page([{ customerId: 1, customerName: "묵은결과", companyName: null }]),
    );
    // 늦은 응답이 상태에 닿을 틈을 준다. 상태가 바뀌었다면 그 렌더 뒤에 단언한다.
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole("button", { name: "최신결과" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "묵은결과" }),
    ).not.toBeInTheDocument();
  });

  it("검색어를 바꾸면 앞 검색어의 목록을 즉시 치우고 검색 중을 보인다", async () => {
    // 효과의 cancelled 정리와 **별개의 가드**다. 그쪽은 늦게 온 응답의 setResult 를
    // 막고, 이것은 **이미 화면에 있는 결과**를 가린다(`result.keyword === trimmed`).
    // 없으면 "합" 의 목록이 "합성" 을 입력하는 동안 그대로 남아, 사용자가 방금 친
    // 검색어와 맞지 않는 고객을 고를 수 있다.
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const keyword = new URL(
        String(input),
        "http://localhost",
      ).searchParams.get("keyword");
      // 두 번째 검색어는 응답을 주지 않는다 — 디바운스·요청 중 상태를 재현한다.
      if (keyword !== "합") return new Promise<Response>(() => {});
      return Promise.resolve(
        page([{ customerId: 1, customerName: "합성상사", companyName: null }]),
      );
    });
    render(
      <CustomerPicker
        label="고객"
        value={null}
        onChange={vi.fn()}
        toMessage={toMessage}
      />,
    );

    await user.type(screen.getByLabelText("고객 검색"), "합");
    expect(
      await screen.findByRole("button", { name: "합성상사" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("고객 검색"), "성");

    // 앞 검색어의 결과가 남아 있으면 안 된다.
    expect(
      screen.queryByRole("button", { name: "합성상사" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("검색 중…")).toBeInTheDocument();
  });
});
