import type { Role } from "@/types/auth";

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
