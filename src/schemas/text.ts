import { z } from "zod";

/**
 * 공용 텍스트 스키마. (이슈 #10, #75)
 *
 * 제어문자와 짝 없는 서로게이트는 PostgreSQL `text` 가 저장하지 못한다. 스키마를
 * 통과하면 INSERT 에서 거부되어 400 이 아니라 500 이 나가므로 경계에서 막는다.
 * 네 스키마 파일에 흩어 적지 않고 여기 한 곳에서 정한다.
 *
 * - `singleLineText`: 이름·사번·부서·직급·등급 등 한 줄 입력. 모든 제어문자 거부.
 * - `multiLineText`: Textarea(내용·결과·주소). 줄바꿈(`\n`, `\r`)과 탭만 허용.
 *
 * 반환값은 `z.string()` 이므로 호출부가 `.trim().min().max()` 를 이어 붙인다.
 * 제어문자 검사는 `.trim()` 뒤에 실행되도록 호출부에서 `.trim()` 을 먼저 둔다.
 */

/** C0 제어문자(NUL 포함)와 DEL. */
const CONTROL_ANY = /[\u0000-\u001F\u007F]/;
/** 줄바꿈·탭을 제외한 제어문자. */
const CONTROL_EXCEPT_WHITESPACE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const MESSAGE = "허용되지 않는 문자가 포함되어 있습니다.";

function isWellFormed(value: string): boolean {
  return value.isWellFormed();
}

export function singleLineText() {
  return z
    .string()
    .trim()
    .refine((value) => !CONTROL_ANY.test(value) && isWellFormed(value), {
      message: MESSAGE,
    });
}

export function multiLineText() {
  return z
    .string()
    .trim()
    .refine(
      (value) => !CONTROL_EXCEPT_WHITESPACE.test(value) && isWellFormed(value),
      { message: MESSAGE },
    );
}
