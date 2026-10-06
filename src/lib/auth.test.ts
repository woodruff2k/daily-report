import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { TEST_JWT_SECRET } from "@/test/integration/test-database";
import {
  assertAnyRole,
  assertCanComment,
  assertCommentAuthor,
  assertManagerOf,
  assertOwner,
  assertOwnerOrManager,
  assertReportEditable,
  assertRole,
  assertTeamScope,
  isManagerOf,
  isOwner,
  parseAuthContext,
  type AuthContext,
} from "./auth";
import { AuthorizationError, ConflictError, HttpError } from "./errors";

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

function expectHttpError(
  fn: () => unknown,
  status: number,
  type: typeof HttpError = AuthorizationError,
) {
  expect(fn).toThrow(type);
  try {
    fn();
  } catch (error) {
    expect((error as HttpError).status).toBe(status);
  }
}

// 덮는 TC: TC-AUTH-04(토큰 없음 401), TC-SEC-01~04 의 전제(요청자 신원).
// 위조 헤더(`x-user-*`)로 신원을 속이는 경우에 해당하는 TC 는 테스트 명세서에 **없다**
// — 이슈 #102 의 수용 기준으로 추가했다. 명세서에 TC 가 생기면 번호를 붙인다.
const CLAIMS = {
  repId: "42",
  name: "테스트사용자",
  role: "MANAGER",
  mustChangePassword: false,
  tokenVersion: 0,
} as const;

function bearer(token: string): Headers {
  return headers({ authorization: `Bearer ${token}` });
}

function signedWith(secret: string, claims: object = CLAIMS, options = {}) {
  return jwt.sign(claims, secret, options);
}

describe("parseAuthContext", () => {
  it("서명된 토큰을 컨텍스트로 변환한다", () => {
    const auth = parseAuthContext(bearer(signedWith(TEST_JWT_SECRET)));
    expect(auth).toEqual({ repId: 42n, role: "MANAGER" });
  });

  it("Authorization 이 없으면 401로 막는다", () => {
    expectHttpError(() => parseAuthContext(headers({})), 401);
  });

  it("Bearer 접두사가 없으면 401로 막는다", () => {
    expectHttpError(
      () =>
        parseAuthContext(
          headers({ authorization: signedWith(TEST_JWT_SECRET) }),
        ),
      401,
    );
  });

  it("위조 헤더만 있고 토큰이 없으면 401로 막는다 (#102)", () => {
    // 프록시가 우회돼 공격자가 직접 넣은 헤더가 도달한 상황이다.
    expectHttpError(
      () =>
        parseAuthContext(
          headers({ "x-user-rep-id": "1", "x-user-role": "ADMIN" }),
        ),
      401,
    );
  });

  it("다른 비밀로 서명한 토큰은 401로 막는다", () => {
    expectHttpError(
      () => parseAuthContext(bearer(signedWith("some-other-secret"))),
      401,
    );
  });

  it("서명이 없는 토큰(alg=none)은 401로 막는다", () => {
    const unsigned = jwt.sign(CLAIMS, "", { algorithm: "none" });
    expectHttpError(() => parseAuthContext(bearer(unsigned)), 401);
  });

  it("만료된 토큰은 401로 막는다", () => {
    const expired = signedWith(TEST_JWT_SECRET, CLAIMS, { expiresIn: -10 });
    expectHttpError(() => parseAuthContext(bearer(expired)), 401);
  });

  it("형식이 깨진 토큰은 401로 막는다", () => {
    expectHttpError(() => parseAuthContext(bearer("not-a-jwt")), 401);
  });

  it("헤더가 토큰의 역할과 사원 식별자를 덮지 못한다 (#102)", () => {
    const token = signedWith(TEST_JWT_SECRET, {
      ...CLAIMS,
      repId: "1",
      role: "SALES_REP",
    });

    const auth = parseAuthContext(
      headers({
        authorization: `Bearer ${token}`,
        "x-user-rep-id": "9",
        "x-user-role": "ADMIN",
      }),
    );

    expect(auth).toEqual({ repId: 1n, role: "SALES_REP" });
  });

  it("서명이 유효해도 역할이 정의되지 않은 것이면 401로 막는다", () => {
    const token = signedWith(TEST_JWT_SECRET, { ...CLAIMS, role: "SUPERUSER" });
    expectHttpError(() => parseAuthContext(bearer(token)), 401);
  });

  it("서명이 유효해도 사원 식별자가 숫자가 아니면 401로 막는다", () => {
    const token = signedWith(TEST_JWT_SECRET, { ...CLAIMS, repId: "abc" });
    expectHttpError(() => parseAuthContext(bearer(token)), 401);
  });

  it("실패 응답에 검증 실패의 상세 사유를 담지 않는다", () => {
    try {
      parseAuthContext(bearer(signedWith("some-other-secret")));
      expect.unreachable();
    } catch (error) {
      expect((error as HttpError).message).toBe("유효하지 않은 토큰입니다.");
    }
  });
});

describe("isOwner / assertOwner", () => {
  it("본인 리소스는 통과한다", () => {
    expect(isOwner(SALES_REP, 1n)).toBe(true);
    expect(() => assertOwner(SALES_REP, 1n)).not.toThrow();
  });

  it("타인 리소스는 403으로 막는다", () => {
    expect(isOwner(SALES_REP, 99n)).toBe(false);
    expectHttpError(() => assertOwner(SALES_REP, 99n), 403);
  });
});

describe("isManagerOf / assertManagerOf", () => {
  it("직속 상급자는 통과한다", () => {
    expect(isManagerOf(MANAGER, TEAM_MEMBER)).toBe(true);
    expect(() => assertManagerOf(MANAGER, TEAM_MEMBER)).not.toThrow();
  });

  it("다른 팀의 상급자는 403으로 막는다", () => {
    expect(isManagerOf(MANAGER, OTHER_TEAM_MEMBER)).toBe(false);
    expectHttpError(() => assertManagerOf(MANAGER, OTHER_TEAM_MEMBER), 403);
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
    expectHttpError(() => assertOwnerOrManager(stranger, TEAM_MEMBER), 403);
  });

  it("다른 팀 상급자는 403으로 막는다", () => {
    expectHttpError(
      () => assertOwnerOrManager(MANAGER, OTHER_TEAM_MEMBER),
      403,
    );
  });
});

describe("assertRole — TC-SEC-03 마스터 등록 차단", () => {
  it("요구 역할과 일치하면 통과한다", () => {
    expect(() => assertRole(ADMIN, "ADMIN")).not.toThrow();
  });

  it("영업사원의 관리자 전용 작업은 403으로 막는다", () => {
    expectHttpError(() => assertRole(SALES_REP, "ADMIN"), 403);
  });

  it("상급자여도 관리자 전용 작업은 막는다", () => {
    expectHttpError(() => assertRole(MANAGER, "ADMIN"), 403);
  });
});

describe("assertAnyRole", () => {
  it("허용 목록에 있으면 통과한다", () => {
    expect(() => assertAnyRole(MANAGER, ["MANAGER", "ADMIN"])).not.toThrow();
  });

  it("허용 목록에 없으면 403으로 막는다", () => {
    expectHttpError(() => assertAnyRole(SALES_REP, ["MANAGER", "ADMIN"]), 403);
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
    expectHttpError(
      () => assertTeamScope(MANAGER, [1n, 99n], subordinates),
      403,
    );
  });

  it("상급자가 아니면 403으로 막는다", () => {
    expectHttpError(() => assertTeamScope(SALES_REP, [1n], subordinates), 403);
  });

  it("팀원이 없는 상급자는 빈 목록을 받는다", () => {
    expect(assertTeamScope(MANAGER, [], [])).toEqual([]);
  });
});

describe("assertCanComment — FR-09 / TC-SEC-04 댓글 작성 권한", () => {
  /** 루트 댓글. parentCommentId 없음. */
  const ROOT = null;
  /** 대댓글. 부모 댓글 commentId. */
  const REPLY = 400n;

  const SUBMITTED = { author: TEAM_MEMBER, status: "SUBMITTED" } as const;
  const DRAFT = { author: TEAM_MEMBER, status: "DRAFT" } as const;
  const OTHER_TEAM = {
    author: OTHER_TEAM_MEMBER,
    status: "SUBMITTED",
  } as const;

  it("직속 상급자는 제출된 보고에 댓글을 쓸 수 있다", () => {
    expect(() => assertCanComment(MANAGER, SUBMITTED, ROOT)).not.toThrow();
  });

  it("직속 상급자는 대댓글도 쓸 수 있다", () => {
    expect(() => assertCanComment(MANAGER, SUBMITTED, REPLY)).not.toThrow();
  });

  it("보고 작성자 본인은 대댓글을 쓸 수 있다", () => {
    expect(() => assertCanComment(SALES_REP, SUBMITTED, REPLY)).not.toThrow();
  });

  it("보고 작성자 본인의 루트 댓글은 403으로 막는다", () => {
    expectHttpError(() => assertCanComment(SALES_REP, SUBMITTED, ROOT), 403);
  });

  it("무관한 사원은 403으로 막는다", () => {
    expectHttpError(() => assertCanComment(SALES_REP, OTHER_TEAM, ROOT), 403);
  });

  it("다른 팀 상급자는 403으로 막는다", () => {
    expectHttpError(() => assertCanComment(MANAGER, OTHER_TEAM, ROOT), 403);
  });

  it("관리자는 댓글 권한이 없다", () => {
    expectHttpError(() => assertCanComment(ADMIN, SUBMITTED, ROOT), 403);
  });

  it("제출되지 않은 보고에는 ConflictError(409)로 막는다", () => {
    expectHttpError(
      () => assertCanComment(MANAGER, DRAFT, ROOT),
      409,
      ConflictError,
    );
  });

  it("작성중 보고를 막을 때 REPORT_NOT_SUBMITTED 코드를 돌려준다", () => {
    try {
      assertCanComment(MANAGER, DRAFT, ROOT);
      expect.unreachable("오류가 발생해야 한다");
    } catch (error) {
      expect((error as HttpError).code).toBe("REPORT_NOT_SUBMITTED");
    }
  });

  it("권한이 없으면 작성중 여부를 알려주지 않고 403으로 막는다", () => {
    const othersDraft = { author: OTHER_TEAM_MEMBER, status: "DRAFT" } as const;

    expectHttpError(() => assertCanComment(SALES_REP, othersDraft, ROOT), 403);
  });
});

describe("assertCommentAuthor — TC-CMT-04 타인 댓글 수정 차단", () => {
  it("본인이 쓴 댓글은 통과한다", () => {
    expect(() => assertCommentAuthor(MANAGER, MANAGER.repId)).not.toThrow();
  });

  it("타인이 쓴 댓글은 403으로 막는다", () => {
    expectHttpError(() => assertCommentAuthor(SALES_REP, MANAGER.repId), 403);
  });

  it("상급자여도 팀원 댓글은 수정할 수 없다", () => {
    expectHttpError(() => assertCommentAuthor(MANAGER, SALES_REP.repId), 403);
  });
});

describe("assertReportEditable — TC-SUB-03 제출본 편집 차단", () => {
  const OWN_DRAFT = { repId: SALES_REP.repId, status: "DRAFT" } as const;
  const OWN_SUBMITTED = {
    repId: SALES_REP.repId,
    status: "SUBMITTED",
  } as const;
  const OTHERS_DRAFT = { repId: 7n, status: "DRAFT" } as const;

  it("본인의 작성중 보고는 수정할 수 있다", () => {
    expect(() => assertReportEditable(SALES_REP, OWN_DRAFT)).not.toThrow();
  });

  it("제출된 보고는 ConflictError(409)로 막는다", () => {
    expectHttpError(
      () => assertReportEditable(SALES_REP, OWN_SUBMITTED),
      409,
      ConflictError,
    );
  });

  it("제출된 보고를 막을 때 REPORT_LOCKED 코드를 돌려준다", () => {
    try {
      assertReportEditable(SALES_REP, OWN_SUBMITTED);
      expect.unreachable("오류가 발생해야 한다");
    } catch (error) {
      expect((error as HttpError).code).toBe("REPORT_LOCKED");
    }
  });

  it("타인 보고는 상태와 무관하게 403으로 막는다", () => {
    expectHttpError(() => assertReportEditable(SALES_REP, OTHERS_DRAFT), 403);
  });

  it("상급자도 팀원 보고를 수정할 수는 없다", () => {
    expectHttpError(() => assertReportEditable(MANAGER, OWN_DRAFT), 403);
  });
});
