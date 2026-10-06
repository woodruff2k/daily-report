import { afterEach, describe, expect, it, vi } from "vitest";
import { createSalesRep, updateSalesRep } from "./sales-rep-api";

// 해당 TC 없음 — 화면 입력값을 서버 요청 본문으로 바꾸는 규칙이다. 선택 항목을 비워 두면
// 서버 스키마가 빈 문자열을 거부하므로 생략해야 한다. 화면 테스트는 세 항목 중 일부만
// 비워 보아, `position` 의 변환을 뒤집어도 통과했다(#93 뮤테이션 확인).

const FILLED = {
  empNo: "S0001",
  name: "합성사원",
  email: "synthetic@example.com",
  department: "영업1팀",
  position: "대리",
  managerId: "7",
  role: "SALES_REP" as const,
  status: "ACTIVE" as const,
};

function spy() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true, data: {}, error: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

const sentBody = (fetchMock: ReturnType<typeof spy>) =>
  JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
    string,
    unknown
  >;

afterEach(() => vi.restoreAllMocks());

describe("영업 마스터 요청 본문", () => {
  it("채워진 선택 항목은 그대로 보내고 managerId 는 숫자로 바꾼다", async () => {
    const fetchMock = spy();

    await createSalesRep(FILLED);

    expect(sentBody(fetchMock)).toEqual({
      empNo: "S0001",
      name: "합성사원",
      email: "synthetic@example.com",
      department: "영업1팀",
      position: "대리",
      managerId: 7,
      role: "SALES_REP",
      status: "ACTIVE",
    });
  });

  it.each(["department", "position", "managerId"] as const)(
    "비워 둔 %s 는 빈 문자열이 아니라 키 자체를 생략한다",
    async (field) => {
      const fetchMock = spy();

      await createSalesRep({ ...FILLED, [field]: "" });

      const body = sentBody(fetchMock);
      expect(body).not.toHaveProperty(field);
      // 다른 선택 항목은 영향받지 않는다.
      const others = ["department", "position", "managerId"].filter(
        (key) => key !== field,
      );
      for (const key of others) expect(body).toHaveProperty(key);
    },
  );

  it("수정도 같은 규칙으로 PUT 한다", async () => {
    const fetchMock = spy();

    await updateSalesRep(5, { ...FILLED, position: "" });

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/sales-reps/5");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    expect(sentBody(fetchMock)).not.toHaveProperty("position");
  });
});
