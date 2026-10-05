/**
 * 로그용 개인정보 마스킹. (NFR-04, TC-SEC-07)
 *
 * Prisma 오류 메시지는 쿼리 인자(이메일·연락처 등)를 담을 수 있다. 서버 로그에
 * 오류를 남기기 전에 이 모듈을 거친다.
 *
 * 가리는 것
 * - 민감 키(`password`·`phone`·`email`·`token`·`secret`·`hash`·`authorization`·
 *   `address`)의 값 — 객체 속성과 `key: "value"`·`key=value` 문자열 모두
 * - 이메일 형태 문자열
 */

export const MASK = "[MASKED]";
export const MASK_EMAIL = "[MASKED_EMAIL]";

const SENSITIVE_KEY =
  /password|passwd|phone|email|token|secret|hash|authorization|address/i;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// key: "value" / key: 'value' / key=value / "key":"value" 형태.
const KEY_VALUE_PATTERN =
  /((?:password|passwd|phone|email|token|secret|hash|authorization|address)[A-Za-z_]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi;

export function maskString(value: string): string {
  return value
    .replace(KEY_VALUE_PATTERN, (_match, prefix: string) => `${prefix}${MASK}`)
    .replace(EMAIL_PATTERN, MASK_EMAIL);
}

export function maskValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (depth >= 5) {
    return MASK;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? MASK : maskValue(item, depth + 1),
    ]),
  );
}

/** 알 수 없는 오류를 로그에 남길 수 있는 형태로 바꾼다. 메시지·스택·코드만 담고 마스킹한다. */
export function describeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      ...(typeof code === "string" ? { code } : {}),
      message: maskString(error.message),
      ...(error.stack ? { stack: maskString(error.stack) } : {}),
    };
  }
  return { value: maskValue(error) };
}
