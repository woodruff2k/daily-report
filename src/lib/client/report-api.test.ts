import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";
import {
  ROLE_FORBIDDEN_MESSAGE,
  VISITS_REQUIRED_MESSAGE,
  isReportAlreadyExists,
  listReports,
  listTeamReports,
  reportErrorMessage,
} from "./report-api";

// 해당 TC 없음 — 화면이 서버에 보내는 질의 문자열과 오류 문장을 만드는 순수 로직이다.
// 화면 테스트는 URL 을 한 가지 조합으로만 보았고, `repIds` 를 생략한 호출은 어떤
// 테스트도 거치지 않았다(#93 뮤테이션 확인).

function page() {
  return new Response(
    JSON.stringify({
      success: true,
      data: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 },
      error: null,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function requestedUrl(fetchMock: ReturnType<typeof spy>) {
  return String(fetchMock.mock.calls[0][0]);
}

function spy() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(page()));
}

afterEach(() => vi.restoreAllMocks());

describe("listReports 질의 문자열", () => {
  it("값이 없는 항목은 싣지 않는다", async () => {
    const fetchMock = spy();

    await listReports({
      fromDate: "2026-10-01",
      status: "",
      toDate: undefined,
    });

    expect(requestedUrl(fetchMock)).toBe("/api/reports?fromDate=2026-10-01");
  });

  it("조건이 하나도 없으면 물음표를 붙이지 않는다", async () => {
    const fetchMock = spy();

    await listReports();

    expect(requestedUrl(fetchMock)).toBe("/api/reports");
  });

  it("page 0 은 값이 있는 것으로 보내고 빈 문자열만 뺀다", async () => {
    const fetchMock = spy();

    await listReports({ page: 0, size: 20 });

    expect(requestedUrl(fetchMock)).toBe("/api/reports?page=0&size=20");
  });
});

describe("listTeamReports 질의 문자열", () => {
  it("repIds 를 생략해도 호출할 수 있고 repIds 를 싣지 않는다", async () => {
    const fetchMock = spy();

    await listTeamReports({ fromDate: "2026-10-01" });

    expect(requestedUrl(fetchMock)).toBe(
      "/api/reports/team?fromDate=2026-10-01",
    );
  });

  it("repIds 가 빈 배열이어도 싣지 않는다 (팀 전체)", async () => {
    const fetchMock = spy();

    await listTeamReports({ repIds: [] });

    expect(requestedUrl(fetchMock)).toBe("/api/reports/team");
  });

  it("repIds 는 쉼표로 이어 붙이고 다른 조건 뒤에 둔다", async () => {
    const fetchMock = spy();

    await listTeamReports({ repIds: [1, 2], status: "DRAFT" });

    expect(requestedUrl(fetchMock)).toBe(
      "/api/reports/team?status=DRAFT&repIds=1,2",
    );
  });

  it("다른 조건이 없으면 repIds 만 싣는다", async () => {
    const fetchMock = spy();

    await listTeamReports({ repIds: [7] });

    expect(requestedUrl(fetchMock)).toBe("/api/reports/team?repIds=7");
  });
});

describe("reportErrorMessage", () => {
  const error = (status: number, code: string, message = "서버 문장") =>
    new ApiClientError(status, { code, message });

  it.each([
    ["VISITS_REQUIRED", VISITS_REQUIRED_MESSAGE],
    ["REPORT_LOCKED", "제출된 보고는 수정할 수 없습니다."],
    ["REPORT_ALREADY_SUBMITTED", "이미 제출된 보고입니다."],
    [
      "CUSTOMER_NOT_FOUND",
      "선택한 고객을 찾을 수 없습니다. 고객을 다시 선택하세요.",
    ],
    ["NOT_FOUND", "보고를 찾을 수 없습니다."],
  ])("%s 는 화면 문장으로 바꾼다 (서버 원문을 쓰지 않는다)", (code, text) => {
    expect(reportErrorMessage(error(400, code), "기본")).toBe(text);
  });

  it("INVALID_REQUEST 는 서버 문장을 그대로 쓴다 (조건이 여러 개라 단정하지 않는다)", () => {
    expect(
      reportErrorMessage(
        error(400, "INVALID_REQUEST", "기간이 거꾸로입니다."),
        "기본",
      ),
    ).toBe("기간이 거꾸로입니다.");
  });

  it("INVALID_REQUEST 에 서버 문장이 없으면 기본 문장이다", () => {
    expect(reportErrorMessage(error(400, "INVALID_REQUEST", ""), "기본")).toBe(
      "기본",
    );
  });

  it("403 은 서버 문장을 쓰고, 없을 때만 기본 권한 문구다", () => {
    expect(reportErrorMessage(error(403, "FORBIDDEN", "범위 밖"), "기본")).toBe(
      "범위 밖",
    );
    expect(reportErrorMessage(error(403, "FORBIDDEN", ""), "기본")).toBe(
      ROLE_FORBIDDEN_MESSAGE,
    );
  });

  it("알 수 없는 오류와 ApiClientError 가 아닌 값은 호출자의 기본 문장이다", () => {
    expect(reportErrorMessage(error(500, "INTERNAL_ERROR"), "기본")).toBe(
      "기본",
    );
    expect(reportErrorMessage(new Error("boom"), "기본")).toBe("기본");
  });
});

describe("isReportAlreadyExists", () => {
  it("409 이면서 코드가 일치할 때만 참이다", () => {
    const make = (status: number, code: string) =>
      new ApiClientError(status, { code, message: "m" });

    expect(isReportAlreadyExists(make(409, "REPORT_ALREADY_EXISTS"))).toBe(
      true,
    );
    expect(isReportAlreadyExists(make(400, "REPORT_ALREADY_EXISTS"))).toBe(
      false,
    );
    expect(isReportAlreadyExists(make(409, "REPORT_LOCKED"))).toBe(false);
    expect(isReportAlreadyExists(new Error("x"))).toBe(false);
  });
});
