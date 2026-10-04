import { ConflictError, NotFoundError } from "./errors";

/**
 * Prisma 오류 코드 판정.
 *
 * `Prisma.PrismaClientKnownRequestError`를 import 해 instanceof 로 보지 않는 이유는
 * 런타임 모듈을 끌어오면 테스트에서 prisma를 모킹할 때 함께 들어오기 때문이다.
 * 오류 모양(code·meta)만 구조적으로 확인한다.
 */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** 유니크 제약 위반(P2002)이면 충돌한 필드 목록, 아니면 null. */
export function uniqueConstraintFields(error: unknown): string[] | null {
  if (errorCode(error) !== "P2002") {
    return null;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  if (Array.isArray(target)) {
    return target.filter((field): field is string => typeof field === "string");
  }

  return typeof target === "string" ? [target] : [];
}

/** 대상 레코드 없음(P2025) 여부. update·delete 가 빈 대상에 걸렸을 때 난다. */
export function isRecordNotFound(error: unknown): boolean {
  return errorCode(error) === "P2025";
}

/**
 * 영업 마스터의 유니크 충돌과 대상 없음을 HttpError로 바꾼다. (TC-REP-02)
 *
 * 해당하지 않는 오류는 그대로 돌려줘 `apiErrorResponse`가 다시 던지게 한다.
 */
export function mapSalesRepWriteError(error: unknown): unknown {
  const fields = uniqueConstraintFields(error);

  if (fields !== null) {
    if (fields.includes("empNo")) {
      return new ConflictError(
        "DUPLICATE_EMP_NO",
        "이미 사용 중인 사번입니다.",
      );
    }
    if (fields.includes("email")) {
      return new ConflictError(
        "DUPLICATE_EMAIL",
        "이미 사용 중인 이메일입니다.",
      );
    }
    return new ConflictError("DUPLICATE_VALUE", "이미 사용 중인 값입니다.");
  }

  if (isRecordNotFound(error)) {
    return new NotFoundError("영업사원을 찾을 수 없습니다.");
  }

  return error;
}

/** 고객 마스터 쓰기에서 대상 없음(P2025)을 404 로 바꾼다. 나머지는 그대로 돌려준다. */
export function mapCustomerWriteError(error: unknown): unknown {
  if (isRecordNotFound(error)) {
    return new NotFoundError("고객을 찾을 수 없습니다.");
  }

  return error;
}
