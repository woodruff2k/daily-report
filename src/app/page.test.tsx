import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

// 테스트 명세서에 루트 진입 TC 가 없다. SCR-100 의 "진입 화면" 정의에 도달 경로가
// 빠져 있어서 생긴 공백이라, 명세 번호를 달지 않고 동작만 고정한다.
describe("Home", () => {
  it("로그인 화면으로 보낸다", async () => {
    const { default: Home } = await import("./page");
    Home();
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
