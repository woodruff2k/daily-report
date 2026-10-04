import { NextResponse } from "next/server";
import { HttpError } from "./errors";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status },
  );
}

/**
 * `HttpError`를 공통 오류 응답으로 변환한다. (TC-SEC-05)
 *
 * code/message/status만 담으므로 스택트레이스나 내부 구현 정보가 응답에
 * 실리지 않는다. 인가 실패(AuthorizationError)와 상태 충돌(ConflictError)을
 * 함께 받는다. 그 외 오류는 가로채지 않고 다시 던져, 예기치 않은 오류를
 * 권한 오류로 가리거나 500으로 뭉개지 않는다.
 *
 * ```ts
 * try {
 *   assertOwnerOrManager(auth, reportAuthor);
 * } catch (error) {
 *   return apiErrorResponse(error);
 * }
 * ```
 */
export function apiErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return apiError(error.code, error.message, error.status);
  }
  throw error;
}
