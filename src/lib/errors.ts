/**
 * API 오류 응답으로 변환할 수 있는 오류 타입.
 *
 * 라우트 핸들러가 `apiErrorResponse(error)` 한 번으로 응답을 만들 수 있도록
 * code/message/status를 오류 자체에 담는다. 종류를 나눠 두는 이유는 인가 실패와
 * 상태 충돌이 다른 사건이기 때문이다. 호출 측이 `instanceof`로 구분해 다룰 수 있다.
 */
export class HttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

/** 인증·인가 실패. 401 또는 403. (NFR-01) */
export class AuthorizationError extends HttpError {}

/**
 * 리소스 상태와 요청이 어긋나는 충돌. 409.
 *
 * 권한은 있으나 지금 상태에서는 할 수 없는 요청에 쓴다.
 * 제출된 보고의 편집(TC-SUB-03), 작성중 보고에 대한 댓글(FR-09) 등이다.
 */
export class ConflictError extends HttpError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

/**
 * 입력 검증 실패. 400.
 *
 * Zod 검증 실패나 경로·쿼리 파라미터 형식 오류에 쓴다. 메시지는 호출자에게
 * 그대로 노출되므로 어떤 값이 잘못됐는지까지만 적고 내부 구조는 담지 않는다.
 */
export class ValidationError extends HttpError {
  constructor(message: string, code = "INVALID_REQUEST") {
    super(code, message, 400);
  }
}

/** 리소스 없음. 404. */
export class NotFoundError extends HttpError {
  constructor(message: string, code = "NOT_FOUND") {
    super(code, message, 404);
  }
}
