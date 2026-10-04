import { z } from "zod";

/**
 * 요청 본문에 담겨 오는 식별자. (이슈 #47)
 *
 * JSON 숫자로 받고 라우트에서 BigInt 로 바꾼다. 안전 정수 범위를 넘는 값은
 * 변환 과정에서 정밀도를 잃으므로 입력 단계에서 막는다.
 */
export const idSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
