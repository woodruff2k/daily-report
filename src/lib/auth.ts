/**
 * 서버측 인가(권한) 검증 헬퍼. (NFR-01)
 *
 * 화면 비표시는 접근통제가 아니므로 모든 권한은 이 헬퍼로 서버에서 검증한다.
 * 역할별 정책은 다음과 같다.
 *
 * | 역할      | 권한                                                            |
 * |-----------|-----------------------------------------------------------------|
 * | SALES_REP | 본인 보고 작성·조회, 본인 보고에 대댓글, 본인 댓글 수정·삭제, 고객 마스터 조회·등록 |
 * | MANAGER   | 직속 팀원 보고 조회(작성중 포함), 제출된 보고에 댓글, 고객 마스터 조회·등록 |
 * | ADMIN     | 영업 마스터 관리                                                  |
 *
 * DB 접근을 하지 않는 순수 함수로 둔다. 상급자 판정이나 보고 상태 판정에 필요한
 * 정보는 호출 측에서 조회해 넘긴다.
 */

import type { Role } from "@/types/auth";
import type { ReportStatus } from "@/types/report";
import { AuthorizationError, ConflictError } from "./errors";
import { JwtConfigError, verifyAccessToken } from "./jwt";

function unauthorized(message: string): AuthorizationError {
  return new AuthorizationError("UNAUTHORIZED", message, 401);
}

function forbidden(message: string): AuthorizationError {
  return new AuthorizationError("FORBIDDEN", message, 403);
}

/** 요청의 `Authorization: Bearer` 토큰에서 서명을 검증해 추출한 요청자 정보. */
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
 * `Authorization: Bearer` 토큰의 서명을 검증해 인증 컨텍스트를 만든다.
 *
 * 요청 헤더 중 `x-user-*` 같은 값은 읽지 않는다. 클라이언트가 설정할 수 있는
 * 헤더는 신뢰 경계가 될 수 없다. 프록시가 우회되면(예: next 의 GHSA-6gpp-xcg3-4w24)
 * 공격자가 넣은 헤더가 그대로 핸들러에 닿기 때문이다. 서명된 토큰만 신뢰한다.
 * (이슈 #102)
 *
 * ## 왜 여기서는 DB 를 보지 않는가 (tokenVersion·status 판단)
 *
 * 이 함수는 서명·만료·payload 형식만 검증한다. 서버측 무효화(`tokenVersion`,
 * 계정 `status`)는 프록시(`src/proxy.ts`)만 검증한다. 여기서까지 하면 요청마다
 * DB 조회가 2회가 된다. 그 대가로 얻는 것은 "프록시가 우회될 때 이미 무효화된
 * 토큰이 통과" 하는 틈을 막는 것뿐이다.
 *
 * 우회가 일어나도 공격자는 **유효하게 서명된 토큰을 이미 가지고 있어야** 한다.
 * 위장은 불가능하고, 영향은 "로그아웃·비밀번호 변경·비활성화·역할 변경 뒤에도
 * 토큰 만료(8h)까지 쓸 수 있다" 로 줄어든다. 이 위험을 받아들이고 요청당 DB
 * 조회를 1회로 유지한다. 라우트에서도 무효화를 검증해야 하는 요구가 생기면
 * (예: 비활성 계정의 쓰기를 즉시 막아야 하는 API) 그 라우트만 조회를 더한다.
 * `mustChangePassword` 게이트도 프록시에만 있다. 같은 이유다.
 *
 * 토큰이 없거나 서명·만료가 어긋나면 401 이다. 오류 메시지에 검증 실패의 상세
 * 사유(서명 불일치·만료 등)를 담지 않는다.
 */
export function parseAuthContext(headers: Headers): AuthContext {
  const authorization = headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    throw unauthorized("인증이 필요합니다.");
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    // 설정 오류(JWT_SECRET 부재)를 401 로 바꾸지 않는다. 바꾸면 비밀이 주입되지
    // 않은 배포가 "모든 토큰이 무효" 로 보이고 화면이 전원을 로그아웃시킨다.
    // 명세 1.4 도 분류되지 않은 서버 오류를 권한 오류로 바꾸지 말라고 적는다.
    if (error instanceof JwtConfigError) {
      throw error;
    }
    throw unauthorized("유효하지 않은 토큰입니다.");
  }

  // 서명이 유효해도 payload 형식까지 보장되지는 않는다.
  if (typeof payload.role !== "string" || !isRole(payload.role)) {
    throw unauthorized("유효하지 않은 토큰입니다.");
  }

  let repId: bigint;
  try {
    repId = BigInt(payload.repId);
  } catch {
    throw unauthorized("유효하지 않은 토큰입니다.");
  }

  return { repId, role: payload.role };
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
export function assertOwnerOrManager(
  auth: AuthContext,
  target: TargetRep,
): void {
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
export function assertAnyRole(
  auth: AuthContext,
  allowedRoles: readonly Role[],
): void {
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
  subordinateRepIds: readonly bigint[],
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

/** 댓글 권한 판정에 필요한 대상 보고의 최소 정보. */
export interface CommentableReport {
  /** 보고 작성자. 상급자 판정에 managerId가 필요하다. */
  author: TargetRep;
  status: ReportStatus;
}

/**
 * 제출된 보고에 대해 직속 상급자는 댓글과 대댓글을, 보고 작성자 본인은
 * 대댓글만 작성할 수 있다. (FR-09, TC-SEC-04)
 *
 * 역할별 범위가 다른 이유는 사양이 둘을 나눠 적어 두었기 때문이다.
 * API 명세 4.2는 "상급자(또는 대댓글의 경우 본인)"로 본인 허용을 답글에 한정하고,
 * FR-09는 댓글 대상을 "제출된 일일보고"로 못박는다. 작성자가 자기 보고에
 * 루트 댓글을 다는 것은 피드백 채널의 용도가 아니므로 막는다.
 *
 * `parentCommentId`는 요청 본문의 값을 그대로 넘긴다. 기본값을 두지 않아
 * 호출 측이 댓글과 대댓글을 구분해 전달하도록 강제한다.
 *
 * 권한을 상태보다 먼저 판정한다. 권한 없는 호출자에게 409를 돌려주면 그 보고가
 * 작성중이라는 사실이 드러나기 때문이다. ADMIN은 영업 마스터 관리 역할이라
 * 댓글 권한이 없다.
 */
export function assertCanComment(
  auth: AuthContext,
  report: CommentableReport,
  parentCommentId: bigint | null,
): void {
  const isReply = parentCommentId !== null;
  const allowed =
    isManagerOf(auth, report.author) ||
    (isOwner(auth, report.author.repId) && isReply);

  if (!allowed) {
    throw forbidden("이 보고에 댓글을 작성할 권한이 없습니다.");
  }

  if (report.status !== "SUBMITTED") {
    throw new ConflictError(
      "REPORT_NOT_SUBMITTED",
      "제출되지 않은 보고에는 댓글을 작성할 수 없습니다.",
    );
  }
}

/**
 * 본인이 작성한 댓글만 수정·삭제할 수 있다. (TC-CMT-04)
 *
 * 상급자여도 타인 댓글은 손대지 못한다.
 */
export function assertCommentAuthor(
  auth: AuthContext,
  commenterId: bigint,
): void {
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
 * 타인 보고는 AuthorizationError(403), 제출된 보고는 ConflictError(409)로
 * 구분해 막는다. 권한 부족과 상태 충돌은 다른 사건이므로 타입을 나누고,
 * 둘 다 HttpError라서 라우트에서는 한 번에 받는다.
 */
export function assertReportEditable(
  auth: AuthContext,
  report: EditableReport,
): void {
  assertOwner(auth, report.repId);

  if (report.status !== "DRAFT") {
    throw new ConflictError(
      "REPORT_LOCKED",
      "제출된 보고는 수정할 수 없습니다.",
    );
  }
}
