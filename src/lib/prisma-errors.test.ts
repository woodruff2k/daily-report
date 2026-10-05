import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "./errors";
import {
  isRecordNotFound,
  mapCustomerWriteError,
  mapReportWriteError,
  mapSalesRepWriteError,
  uniqueConstraintFields,
} from "./prisma-errors";

function prismaError(code: string, target?: unknown) {
  return { code, meta: target === undefined ? undefined : { target } };
}

describe("uniqueConstraintFields", () => {
  it("P2002 의 충돌 필드를 돌려준다", () => {
    expect(uniqueConstraintFields(prismaError("P2002", ["email"]))).toEqual([
      "email",
    ]);
  });

  it("target 이 문자열이어도 배열로 돌려준다", () => {
    expect(uniqueConstraintFields(prismaError("P2002", "empNo"))).toEqual([
      "empNo",
    ]);
  });

  it("다른 코드면 null 이다", () => {
    expect(uniqueConstraintFields(prismaError("P2025"))).toBeNull();
  });

  it("오류가 아닌 값에도 깨지지 않는다", () => {
    expect(uniqueConstraintFields(null)).toBeNull();
    expect(uniqueConstraintFields("P2002")).toBeNull();
  });
});

describe("isRecordNotFound", () => {
  it("P2025 를 알아본다", () => {
    expect(isRecordNotFound(prismaError("P2025"))).toBe(true);
    expect(isRecordNotFound(prismaError("P2002"))).toBe(false);
  });
});

describe("mapSalesRepWriteError — TC-REP-02 중복 차단", () => {
  // 실제 PostgreSQL 은 컬럼명(`emp_no`)을 준다 — 통합 테스트로 확인했다.
  // 필드명(`empNo`)만 목킹하던 기존 테스트가 실제 계약과 어긋난 구현을
  // 통과시켰다. 두 이름을 모두 고정한다.
  it.each([["emp_no"], ["empNo"]])(
    "사번 중복은 409 DUPLICATE_EMP_NO 다 — target=%s",
    (target) => {
      const mapped = mapSalesRepWriteError(prismaError("P2002", [target]));

      expect(mapped).toBeInstanceOf(ConflictError);
      expect((mapped as ConflictError).code).toBe("DUPLICATE_EMP_NO");
    },
  );

  it("이메일 중복은 409 DUPLICATE_EMAIL 다", () => {
    expect(
      (mapSalesRepWriteError(prismaError("P2002", ["email"])) as ConflictError)
        .code,
    ).toBe("DUPLICATE_EMAIL");
  });

  it("대상 없음은 404 다", () => {
    expect(mapSalesRepWriteError(prismaError("P2025"))).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("그 밖의 오류는 그대로 돌려준다", () => {
    const unexpected = new Error("연결 실패");

    expect(mapSalesRepWriteError(unexpected)).toBe(unexpected);
  });
});

describe("mapCustomerWriteError", () => {
  it("P2025 는 404 로 바꾼다", () => {
    expect(
      mapCustomerWriteError(Object.assign(new Error("x"), { code: "P2025" })),
    ).toMatchObject({ status: 404 });
  });

  it("그 밖의 오류는 그대로 돌려준다", () => {
    const error = new Error("other");
    expect(mapCustomerWriteError(error)).toBe(error);
  });
});

describe("mapReportWriteError", () => {
  it("유니크 위반은 필드 표기와 무관하게 409 REPORT_ALREADY_EXISTS", () => {
    for (const target of [
      ["rep_id", "report_date"],
      ["repId"],
      "x",
      undefined,
    ]) {
      expect(mapReportWriteError(prismaError("P2002", target))).toMatchObject({
        code: "REPORT_ALREADY_EXISTS",
        status: 409,
      });
    }
  });

  it("대상 없음(P2025)은 404", () => {
    expect(mapReportWriteError(prismaError("P2025"))).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("그 외 오류는 그대로 돌려준다", () => {
    const error = new Error("boom");
    expect(mapReportWriteError(error)).toBe(error);
  });
});
