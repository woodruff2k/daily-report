import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
