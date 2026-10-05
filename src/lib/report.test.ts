import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./auth";
import {
  REPORT,
  REPORT_LIST_RECORD,
  SUBMITTED_REPORT,
} from "@/test/report-fixtures";
import {
  assertReportViewable,
  formatDateOnly,
  lockDraftReport,
  toDbDate,
  toReportDetail,
  toReportListItem,
} from "./report";
import { buildReportWhere, parseReportIdParam } from "./report-query";

const owner: AuthContext = { repId: 1n, role: "SALES_REP" };
const manager: AuthContext = { repId: 2n, role: "MANAGER" };
const stranger: AuthContext = { repId: 3n, role: "SALES_REP" };
const admin: AuthContext = { repId: 9n, role: "ADMIN" };

describe("날짜 변환", () => {
  it("DB 날짜와 문자열이 서로 되돌아온다", () => {
    expect(formatDateOnly(toDbDate("2026-06-20"))).toBe("2026-06-20");
  });

  it("UTC 자정 값은 어떤 서버 타임존에서도 같은 날짜다", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["Asia/Seoul", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = tz;
        expect(formatDateOnly(new Date("2026-06-20T00:00:00.000Z"))).toBe(
          "2026-06-20",
        );
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("toReportListItem", () => {
  it("건수를 _count 에서 가져오고 필요한 필드만 담는다", () => {
    expect(toReportListItem(REPORT_LIST_RECORD)).toEqual({
      reportId: 10,
      reportDate: "2026-06-20",
      visitCount: 3,
      status: "SUBMITTED",
      commentCount: 2,
      updatedAt: "2026-06-20T09:10:00.000Z",
    });
  });
});

describe("toReportDetail", () => {
  it("식별자를 JSON 숫자로, 날짜를 YYYY-MM-DD 로 바꾸고 managerId 는 담지 않는다", () => {
    const detail = toReportDetail(SUBMITTED_REPORT);

    expect(detail.reportId).toBe(10);
    expect(detail.submittedAt).toBe("2026-06-20T09:10:00.000Z");
    expect(detail.plans[0].plannedDate).toBe("2026-06-21");
    expect(detail.rep).toEqual({ repId: 1, name: "홍길동" });
    expect(JSON.stringify(detail)).not.toContain("managerId");
    expect(detail.visits[0]).not.toHaveProperty("reportId");
    expect(detail.visits[0]).not.toHaveProperty("createdAt");
  });
});

describe("assertReportViewable — TC-SEC-01", () => {
  it("작성자 본인은 작성중 보고도 볼 수 있다", () => {
    expect(() => assertReportViewable(owner, REPORT)).not.toThrow();
  });

  // 상태로 제한하지 않는다. SCR-300 의 검색 조건에 "작성중" 이 있고 API 명세
  // 3.6 의 status 가 DRAFT 를 받으므로, 목록에 나온 보고를 열면 403 이 되는
  // 상태를 만들지 않는다. 제출 여부로 갈리는 것은 댓글이다(assertCanComment).
  it("직속 상급자는 팀원의 작성중 보고도 볼 수 있다", () => {
    expect(() => assertReportViewable(manager, SUBMITTED_REPORT)).not.toThrow();
    expect(() => assertReportViewable(manager, REPORT)).not.toThrow();
  });

  it("무관한 사원과 관리자는 볼 수 없다", () => {
    expect(() => assertReportViewable(stranger, SUBMITTED_REPORT)).toThrow();
    expect(() => assertReportViewable(admin, SUBMITTED_REPORT)).toThrow();
    expect(() => assertReportViewable(stranger, REPORT)).toThrow();
    expect(() => assertReportViewable(admin, REPORT)).toThrow();
  });
});

describe("lockDraftReport", () => {
  it("DRAFT 조건으로 갱신하고 0건이면 REPORT_LOCKED", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = { dailyReport: { updateMany } } as never;

    await expect(lockDraftReport(tx, 10n)).rejects.toMatchObject({
      code: "REPORT_LOCKED",
      status: 409,
    });
    expect(updateMany.mock.calls[0][0].where).toEqual({
      reportId: 10n,
      status: "DRAFT",
    });
  });
});

describe("buildReportWhere", () => {
  const where = (query: string) =>
    buildReportWhere(new URLSearchParams(query), 1n);

  it("repId 는 쿼리가 아니라 인수에서만 온다", () => {
    expect(where("repId=3")).toEqual({ repId: 1n });
  });

  it("한쪽 기간만 줘도 된다", () => {
    expect(where("fromDate=2026-06-01").reportDate).toEqual({
      gte: new Date("2026-06-01T00:00:00.000Z"),
    });
  });

  it("같은 날을 시작과 종료로 주는 것은 허용한다", () => {
    expect(() => where("fromDate=2026-06-01&toDate=2026-06-01")).not.toThrow();
  });
});

describe("parseReportIdParam", () => {
  it("정상 식별자를 BigInt 로 바꾼다", () => {
    expect(parseReportIdParam("10")).toBe(10n);
  });

  it.each(["abc", "0", "-1", "1.5", "9007199254740993", ""])(
    "%s 는 400",
    (raw) => {
      expect(() => parseReportIdParam(raw)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    },
  );
});
