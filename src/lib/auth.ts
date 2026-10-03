/**
 * 서버측 인가(권한) 검증 헬퍼. (NFR-01)
 *
 * 화면 비표시는 접근통제가 아니므로 모든 권한은 이 헬퍼로 서버에서 검증한다.
 * 역할별 정책은 다음과 같다.
 *
 * | 역할      | 권한                                                  |
 * |-----------|-------------------------------------------------------|
 * | SALES_REP | 본인 보고 작성·조회, 본인 댓글 수정·삭제, 고객 마스터 조회·등록 |
 * | MANAGER   | 직속 팀원 보고 조회·댓글, 고객 마스터 조회·등록            |
 * | ADMIN     | 영업 마스터 관리                                        |
 *
 * DB 접근을 하지 않는 순수 함수로 둔다. 상급자 판정이나 보고 상태 판정에 필요한
 * 정보는 호출 측에서 조회해 넘긴다.
 */

import type { ReportStatus, Role } from "@/types/auth";

/**
 * 인가 실패를 나타내는 오류.
 * 라우트 핸들러에서 잡아 `apiError(code, message, status)`로 변환한다.
 */
export class AuthorizationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = status;
  }
}

function unauthorized(message: string): AuthorizationError {
  return new AuthorizationError("UNAUTHORIZED", message, 401);
}

function forbidden(message: string): AuthorizationError {
  return new AuthorizationError("FORBIDDEN", message, 403);
}

/** 프록시(`src/proxy.ts`)가 검증한 토큰에서 추출한 요청자 정보. */
export interface AuthContext {
  repId: bigint;
  role: Role;
}

/** 상급자 판정에 필요한 대상 사원의 최소 정보. */
export interface TargetRep {
  repId: bigint;
  managerId: bigint | null;
}

const ROLES: readonly Role[] = ["SALES_REP", "MANAGER", "ADMIN"];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * 프록시가 심어둔 요청 헤더에서 인증 컨텍스트를 읽는다.
 *
 * 헤더는 프록시를 거친 요청에만 존재한다. 값이 없거나 형식이 어긋나면
 * 프록시를 우회한 요청으로 보고 401로 막는다.
 */
export function parseAuthContext(headers: Headers): AuthContext {
  const rawRepId = headers.get("x-user-rep-id");
  const rawRole = headers.get("x-user-role");

  if (!rawRepId || !rawRole) {
    throw unauthorized("인증이 필요합니다.");
  }

  if (!isRole(rawRole)) {
    throw unauthorized("유효하지 않은 권한 정보입니다.");
  }

  let repId: bigint;
  try {
    repId = BigInt(rawRepId);
  } catch {
    throw unauthorized("유효하지 않은 사용자 식별자입니다.");
  }

  return { repId, role: rawRole };
}

/** 요청자가 해당 리소스의 소유자인지 여부. */
export function isOwner(auth: AuthContext, resourceRepId: bigint): boolean {
  return auth.repId === resourceRepId;
}

/** 요청자가 대상 사원의 직속 상급자인지 여부. */
export function isManagerOf(auth: AuthContext, target: TargetRep): boolean {
  if (auth.role !== "MANAGER") {
    return false;
  }
  return target.managerId !== null && target.managerId === auth.repId;
}

/**
 * 소유자 본인만 허용한다. (TC-RPT: 본인 보고 수정)
 */
export function assertOwner(auth: AuthContext, resourceRepId: bigint): void {
  if (!isOwner(auth, resourceRepId)) {
    throw forbidden("본인의 리소스가 아닙니다.");
  }
}

/**
 * 대상 사원의 직속 상급자만 허용한다.
 */
export function assertManagerOf(auth: AuthContext, target: TargetRep): void {
  if (!isManagerOf(auth, target)) {
    throw forbidden("소속 팀원이 아닙니다.");
  }
}

/**
 * 소유자 본인 또는 직속 상급자만 허용한다.
 * 타인의 보고 조회를 막는 IDOR 방어에 쓴다. (TC-SEC-01)
 */
export function assertOwnerOrManager(auth: AuthContext, target: TargetRep): void {
  if (isOwner(auth, target.repId) || isManagerOf(auth, target)) {
    return;
  }
  throw forbidden("해당 보고에 접근할 권한이 없습니다.");
}

/**
 * 지정한 역할만 허용한다. 역할 간 상하 관계는 두지 않는다.
 * 관리자 전용 API 보호에 쓴다. (TC-SEC-03)
 */
export function assertRole(auth: AuthContext, requiredRole: Role): void {
  if (auth.role !== requiredRole) {
    throw forbidden("이 작업을 수행할 권한이 없습니다.");
  }
}

/** 나열한 역할 중 하나면 허용한다. */
export function assertAnyRole(auth: AuthContext, allowedRoles: readonly Role[]): void {
  if (!allowedRoles.includes(auth.role)) {
    throw forbidden("이 작업을 수행할 권한이 없습니다.");
  }
}

/**
 * 팀 보고 조회에서 요청한 사원 목록이 요청자의 팀 범위 안인지 검증한다. (TC-SEC-02)
 *
 * `requestedRepIds`가 비어 있으면 팀 전원을 조회하는 것으로 보고
 * 소속 팀원 전체를 돌려준다. 범위를 벗어난 사원이 하나라도 있으면 403으로 막는다.
 */
export function assertTeamScope(
  auth: AuthContext,
  requestedRepIds: readonly bigint[],
  subordinateRepIds: readonly bigint[]
): bigint[] {
  if (auth.role !== "MANAGER") {
    throw forbidden("팀 보고를 조회할 권한이 없습니다.");
  }

  if (requestedRepIds.length === 0) {
    return [...subordinateRepIds];
  }

  const allowed = new Set(subordinateRepIds);
  const outOfScope = requestedRepIds.filter((repId) => !allowed.has(repId));

  if (outOfScope.length > 0) {
    throw forbidden("소속 팀원 범위를 벗어난 조회입니다.");
  }

  return [...requestedRepIds];
}

/**
 * 보고 작성자 본인 또는 직속 상급자만 댓글을 작성할 수 있다. (TC-SEC-04)
 *
 * 대댓글도 같은 규칙을 쓴다. 상급자 지적에 작성자가 답글을 다는 흐름(SCR-220)이
 * 본인 허용으로 성립한다. ADMIN은 영업 마스터 관리 역할이라 댓글 권한이 없다.
 */
export function assertCanComment(auth: AuthContext, reportAuthor: TargetRep): void {
  if (isOwner(auth, reportAuthor.repId) || isManagerOf(auth, reportAuthor)) {
    return;
  }
  throw forbidden("이 보고에 댓글을 작성할 권한이 없습니다.");
}

/**
 * 본인이 작성한 댓글만 수정·삭제할 수 있다. (TC-CMT-04)
 *
 * 상급자여도 타인 댓글은 손대지 못한다.
 */
export function assertCommentAuthor(auth: AuthContext, commenterId: bigint): void {
  if (!isOwner(auth, commenterId)) {
    throw forbidden("본인이 작성한 댓글만 수정·삭제할 수 있습니다.");
  }
}

/** 수정 가능 여부 판정에 필요한 보고의 최소 정보. */
export interface EditableReport {
  /** 보고 작성자 rep_id */
  repId: bigint;
  status: ReportStatus;
}

/**
 * 작성자 본인의 DRAFT 보고만 수정할 수 있다. (TC-SUB-03)
 *
 * 타인 보고는 403, 제출된 보고는 409로 구분해 막는다. 둘 다 AuthorizationError로
 * 던져 라우트에서 한 번에 받는다. 409는 인가 실패가 아니라 상태 충돌이지만,
 * 수정 가능 여부를 한 곳에서 판정하기 위해 같은 오류 형태로 둔다.
 */
export function assertReportEditable(auth: AuthContext, report: EditableReport): void {
  assertOwner(auth, report.repId);

  if (report.status !== "DRAFT") {
    throw new AuthorizationError("REPORT_LOCKED", "제출된 보고는 수정할 수 없습니다.", 409);
  }
}
