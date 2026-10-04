import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "./errors";
import {
  isRecordNotFound,
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
  it("사번 중복은 409 DUPLICATE_EMP_NO 다", () => {
    const mapped = mapSalesRepWriteError(prismaError("P2002", ["empNo"]));

    expect(mapped).toBeInstanceOf(ConflictError);
    expect((mapped as ConflictError).code).toBe("DUPLICATE_EMP_NO");
  });

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
