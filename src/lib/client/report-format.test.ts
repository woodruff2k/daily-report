import { describe, expect, it } from "vitest";
import {
  defaultRange,
  formatDate,
  formatUpdatedAt,
  nextDay,
} from "./report-format";

/**
 * 날짜 계산을 라이브러리 없이 하므로 경계를 직접 못박는다. 화면 테스트는 평범한
 * 날짜 하나씩만 지나가므로 월말·연말·윤년에서 틀려도 통과한다.
 */
describe("report-format — 날짜 계산", () => {
  describe("formatDate", () => {
    it("로컬 날짜를 YYYY-MM-DD 로 만들고 한 자리를 0 으로 채운다", () => {
      expect(formatDate(new Date(2026, 0, 2))).toBe("2026-01-02");
      expect(formatDate(new Date(2026, 11, 31))).toBe("2026-12-31");
    });

    // toISOString 은 UTC 라 한국(UTC+9) 새벽에는 하루 전이 나온다.
    it("자정 직후에도 그날 날짜다", () => {
      expect(formatDate(new Date(2026, 9, 5, 0, 30))).toBe("2026-10-05");
    });
  });

  describe("nextDay", () => {
    it("평범한 날의 다음 날", () => {
      expect(nextDay("2026-10-05")).toBe("2026-10-06");
    });

    it("월말을 넘긴다", () => {
      expect(nextDay("2026-10-31")).toBe("2026-11-01");
      expect(nextDay("2026-04-30")).toBe("2026-05-01");
    });

    it("연말을 넘긴다", () => {
      expect(nextDay("2026-12-31")).toBe("2027-01-01");
    });

    it("윤년의 2월 28일 다음은 29일이고, 평년은 3월 1일이다", () => {
      expect(nextDay("2028-02-28")).toBe("2028-02-29");
      expect(nextDay("2028-02-29")).toBe("2028-03-01");
      expect(nextDay("2026-02-28")).toBe("2026-03-01");
    });
  });

  describe("defaultRange", () => {
    it("한 달 전부터 오늘까지다", () => {
      expect(defaultRange(new Date(2026, 9, 5))).toEqual({
        from: "2026-09-05",
        to: "2026-10-05",
      });
    });

    // 2/31 은 존재하지 않아 Date 가 3월로 굴린다. 그대로 두면 시작일이 종료일보다
    // 늦어져 서버가 400 을 주고 첫 화면이 오류로 열린다.
    it("같은 날짜가 전 달에 없으면 그 달의 말일로 맞춘다", () => {
      expect(defaultRange(new Date(2026, 2, 31))).toEqual({
        from: "2026-02-28",
        to: "2026-03-31",
      });
      expect(defaultRange(new Date(2026, 4, 31))).toEqual({
        from: "2026-04-30",
        to: "2026-05-31",
      });
    });

    it("윤년이면 2월 29일로 맞춘다", () => {
      expect(defaultRange(new Date(2028, 2, 31))).toEqual({
        from: "2028-02-29",
        to: "2028-03-31",
      });
    });

    it("연초면 전 해로 넘어간다", () => {
      expect(defaultRange(new Date(2026, 0, 15))).toEqual({
        from: "2025-12-15",
        to: "2026-01-15",
      });
    });
  });

  describe("formatUpdatedAt", () => {
    const now = new Date(2026, 9, 5, 12, 0);

    it("오늘이면 시각만 보여준다", () => {
      expect(formatUpdatedAt(new Date(2026, 9, 5, 18, 10).toISOString(), now)) //
        .toBe("18:10");
    });

    it("올해의 다른 날이면 월-일을 붙인다", () => {
      expect(
        formatUpdatedAt(new Date(2026, 8, 28, 17, 40).toISOString(), now),
      ).toBe("09-28 17:40");
    });

    // 기간 필터에 상한이 없어 작년 보고도 조회된다. 연도가 없으면 작년 9-28 과
    // 올해 9-28 이 똑같이 읽힌다.
    it("해가 다르면 연도까지 붙인다", () => {
      expect(
        formatUpdatedAt(new Date(2025, 8, 28, 17, 40).toISOString(), now),
      ).toBe("2025-09-28 17:40");
      expect(
        formatUpdatedAt(new Date(2027, 0, 2, 9, 5).toISOString(), now),
      ).toBe("2027-01-02 09:05");
    });
  });
});
