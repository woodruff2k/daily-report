import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  assertAnyRole,
  assertManagerOf,
  assertOwner,
  assertOwnerOrManager,
  assertRole,
  assertTeamScope,
  isManagerOf,
  isOwner,
  parseAuthContext,
  type AuthContext,
} from "./auth";

const SALES_REP: AuthContext = { repId: 1n, role: "SALES_REP" };
const MANAGER: AuthContext = { repId: 2n, role: "MANAGER" };
const ADMIN: AuthContext = { repId: 3n, role: "ADMIN" };

/** repId 1번 사원. 상급자는 repId 2번. */
const TEAM_MEMBER = { repId: 1n, managerId: 2n };
/** 다른 팀 소속 사원. 상급자는 repId 9번. */
const OTHER_TEAM_MEMBER = { repId: 7n, managerId: 9n };

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

function expectAuthError(fn: () => unknown, status: number) {
  expect(fn).toThrow(AuthorizationError);
  try {
    fn();
  } catch (error) {
    expect((error as AuthorizationError).status).toBe(status);
  }
}

describe("parseAuthContext", () => {
  it("프록시가 심은 헤더를 컨텍스트로 변환한다", () => {
    const auth = parseAuthContext(
      headers({ "x-user-rep-id": "42", "x-user-role": "MANAGER" })
    );
    expect(auth).toEqual({ repId: 42n, role: "MANAGER" });
  });

  it("헤더가 없으면 401로 막는다", () => {
    expectAuthError(() => parseAuthContext(headers({})), 401);
  });

  it("역할 값이 정의되지 않은 것이면 401로 막는다", () => {
    expectAuthError(
      () => parseAuthContext(headers({ "x-user-rep-id": "1", "x-user-role": "SUPERUSER" })),
      401
    );
  });

  it("사원 식별자가 숫자가 아니면 401로 막는다", () => {
    expectAuthError(
      () => parseAuthContext(headers({ "x-user-rep-id": "abc", "x-user-role": "SALES_REP" })),
      401
    );
  });
});

describe("isOwner / assertOwner", () => {
  it("본인 리소스는 통과한다", () => {
    expect(isOwner(SALES_REP, 1n)).toBe(true);
    expect(() => assertOwner(SALES_REP, 1n)).not.toThrow();
  });

  it("타인 리소스는 403으로 막는다", () => {
    expect(isOwner(SALES_REP, 99n)).toBe(false);
    expectAuthError(() => assertOwner(SALES_REP, 99n), 403);
  });
});

describe("isManagerOf / assertManagerOf", () => {
  it("직속 상급자는 통과한다", () => {
    expect(isManagerOf(MANAGER, TEAM_MEMBER)).toBe(true);
    expect(() => assertManagerOf(MANAGER, TEAM_MEMBER)).not.toThrow();
  });

  it("다른 팀의 상급자는 403으로 막는다", () => {
    expect(isManagerOf(MANAGER, OTHER_TEAM_MEMBER)).toBe(false);
    expectAuthError(() => assertManagerOf(MANAGER, OTHER_TEAM_MEMBER), 403);
  });

  it("상급자 역할이 아니면 관계가 맞아도 막는다", () => {
    const impostor: AuthContext = { repId: 2n, role: "SALES_REP" };
    expect(isManagerOf(impostor, TEAM_MEMBER)).toBe(false);
  });

  it("상급자가 지정되지 않은 사원은 아무도 상급자가 아니다", () => {
    expect(isManagerOf(MANAGER, { repId: 5n, managerId: null })).toBe(false);
  });
});

describe("assertOwnerOrManager — TC-SEC-01 타인 보고 조회 차단", () => {
  it("작성자 본인은 조회할 수 있다", () => {
    expect(() => assertOwnerOrManager(SALES_REP, TEAM_MEMBER)).not.toThrow();
  });

  it("직속 상급자는 조회할 수 있다", () => {
    expect(() => assertOwnerOrManager(MANAGER, TEAM_MEMBER)).not.toThrow();
  });

  it("무관한 사원은 403으로 막는다", () => {
    const stranger: AuthContext = { repId: 8n, role: "SALES_REP" };
    expectAuthError(() => assertOwnerOrManager(stranger, TEAM_MEMBER), 403);
  });

  it("다른 팀 상급자는 403으로 막는다", () => {
    expectAuthError(() => assertOwnerOrManager(MANAGER, OTHER_TEAM_MEMBER), 403);
  });
});

describe("assertRole — TC-SEC-03 마스터 등록 차단", () => {
  it("요구 역할과 일치하면 통과한다", () => {
    expect(() => assertRole(ADMIN, "ADMIN")).not.toThrow();
  });

  it("영업사원의 관리자 전용 작업은 403으로 막는다", () => {
    expectAuthError(() => assertRole(SALES_REP, "ADMIN"), 403);
  });

  it("상급자여도 관리자 전용 작업은 막는다", () => {
    expectAuthError(() => assertRole(MANAGER, "ADMIN"), 403);
  });
});

describe("assertAnyRole", () => {
  it("허용 목록에 있으면 통과한다", () => {
    expect(() => assertAnyRole(MANAGER, ["MANAGER", "ADMIN"])).not.toThrow();
  });

  it("허용 목록에 없으면 403으로 막는다", () => {
    expectAuthError(() => assertAnyRole(SALES_REP, ["MANAGER", "ADMIN"]), 403);
  });
});

describe("assertTeamScope — TC-SEC-02 팀 범위 밖 조회 차단", () => {
  const subordinates = [1n, 4n, 5n];

  it("팀원 일부를 지정하면 그대로 돌려준다", () => {
    expect(assertTeamScope(MANAGER, [1n, 5n], subordinates)).toEqual([1n, 5n]);
  });

  it("지정이 없으면 팀 전원으로 채운다", () => {
    expect(assertTeamScope(MANAGER, [], subordinates)).toEqual(subordinates);
  });

  it("범위 밖 사원이 섞이면 403으로 막는다", () => {
    expectAuthError(() => assertTeamScope(MANAGER, [1n, 99n], subordinates), 403);
  });

  it("상급자가 아니면 403으로 막는다", () => {
    expectAuthError(() => assertTeamScope(SALES_REP, [1n], subordinates), 403);
  });

  it("팀원이 없는 상급자는 빈 목록을 받는다", () => {
    expect(assertTeamScope(MANAGER, [], [])).toEqual([]);
  });
});
