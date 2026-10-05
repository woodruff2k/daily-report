import { NextResponse } from "next/server";
import { HttpError } from "./errors";
import { describeErrorForLog } from "./log-mask";

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
 * 오류를 공통 오류 응답으로 변환한다. (TC-SEC-05)
 *
 * `HttpError`는 code/message/status만 담으므로 스택트레이스나 내부 구현 정보가
 * 응답에 실리지 않는다. 인가 실패(AuthorizationError)와 상태 충돌(ConflictError)을
 * 함께 받는다.
 *
 * 그 외 알 수 없는 오류는 특정 오류 코드(권한·검증 등)로 오인시키지 않도록
 * `INTERNAL_ERROR`(500)로 응답하되 공통 봉투를 지킨다. 원인은 마스킹한 뒤 서버
 * 로그에 남기고, `detail` 은 프로덕션이 아닐 때만 응답에 담는다.
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

  const described = describeErrorForLog(error);
  console.error("[api] unhandled error", described);

  const body: { code: string; message: string; detail?: string } = {
    code: "INTERNAL_ERROR",
    message: "서버 오류가 발생했습니다.",
  };
  if (process.env.NODE_ENV !== "production") {
    body.detail =
      typeof described.message === "string"
        ? described.message
        : "알 수 없는 오류";
  }
  return NextResponse.json(
    { success: false, data: null, error: body },
    { status: 500 },
  );
}
