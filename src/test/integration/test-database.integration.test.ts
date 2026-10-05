// 통합 테스트 안전장치 자체의 검증. 개발 DB 를 지우는 사고를 막는 유일한 장치다.
// (DB 접속 없이 순수 함수만 검사한다. 통합 스위트에 두는 이유는 npm test 에 DB 의존이
// 섞이지 않게 하려는 분리 규칙을 따르기 위해서다.)
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { assertTestDatabaseUrl, resolveTestDatabaseUrl } from "./test-database";

describe("assertTestDatabaseUrl", () => {
  it("개발 DB 이름은 거부한다", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://u:p@127.0.0.1:5433/daily_report?schema=public",
      ),
    ).toThrow(/_test/);
  });

  it("DB 이름이 _test 로 끝나면 통과한다", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://u:p@127.0.0.1:5433/daily_report_test?schema=public",
      ),
    ).not.toThrow();
  });

  it("비밀번호·호스트에 _test 가 있어도 DB 이름이 아니면 거부한다", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://u:p_test@host_test:5433/daily_report",
      ),
    ).toThrow();
  });

  it("비어 있거나 해석할 수 없는 값은 거부한다", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow();
    expect(() => assertTestDatabaseUrl("")).toThrow();
    expect(() => assertTestDatabaseUrl("not a url")).toThrow();
  });

  it("오류 메시지에 접속 문자열(자격증명)을 담지 않는다", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://user:secret-pw@h:1/prod_db"),
    ).toThrow(
      expect.not.objectContaining({
        message: expect.stringContaining("secret-pw"),
      }),
    );
  });
});

describe("resolveTestDatabaseUrl", () => {
  it("DATABASE_URL_TEST 가 개발 DB 를 가리키면 기본값으로 되돌아가지 않고 실패한다", () => {
    expect(() =>
      resolveTestDatabaseUrl({
        DATABASE_URL_TEST: "postgresql://u:p@127.0.0.1:5433/daily_report",
      }),
    ).toThrow();
  });

  it("DATABASE_URL_TEST 가 없으면 로컬 테스트 DB 기본값을 쓴다", () => {
    expect(resolveTestDatabaseUrl({})).toContain("/daily_report_test");
  });
});

describe("실행 중인 연결", () => {
  it("실제로 붙은 DB 가 _test 로 끝난다", async () => {
    const [{ name }] = await prisma.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;

    expect(name.endsWith("_test")).toBe(true);
  });
});
