import { z } from "zod";
import { idSchema } from "./identifier";
import { multiLineText, singleLineText } from "./text";

/**
 * 고객 마스터 입력 검증. (FR-01, API 명세 5)
 *
 * `assignedRepId` 의 존재·활성 여부는 DB 를 봐야 알 수 있어 여기서 검증하지
 * 않는다. 라우트가 `assertAssignedRepValid` 로 400 처리한다.
 */

const customerStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/** 공백뿐인 문자열을 null 로 정규화한다. 빈 문자열이 DB 에 남지 않게 하고, 형식 검증 전에 적용한다. */
function blankToNull(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 선택 텍스트. 한 줄이 기본이고 주소만 여러 줄을 허용한다. */
function optionalText(max: number, multiline = false) {
  const base = multiline ? multiLineText() : singleLineText();
  return z
    .preprocess(blankToNull, base.max(max).nullish())
    .transform((value) => value ?? null);
}

/** 숫자·공백·`+-()` 만 허용한다. 화면(SCR-410)의 "형식 검증". */
const PHONE_PATTERN = /^[0-9+\-() ]{5,30}$/;

const optionalPhone = z
  .preprocess(blankToNull, z.string().regex(PHONE_PATTERN).nullish())
  .transform((value) => value ?? null);

const optionalEmail = z
  .preprocess(blankToNull, z.string().email().max(255).nullish())
  .transform((value) => value ?? null);

export const customerCreateSchema = z.object({
  customerName: singleLineText().min(1).max(100),
  companyName: optionalText(100),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(500, true),
  grade: optionalText(20),
  /**
   * API 수준에서 필수다. Prisma 컬럼은 `BigInt?` 라 null 을 허용하지만, 그것은
   * 과거 데이터 때문이다. 화면정의서 SCR-410 이 담당 영업을 필수(Y)로 정했으므로
   * 새로 들어오는 요청은 막는다.
   */
  assignedRepId: idSchema,
  status: customerStatusSchema.default("ACTIVE"),
});

/**
 * 전체 교체. (API 명세 5.3)
 *
 * `status` 는 생성과 달리 기본값 없이 필수다. 기본값으로 메우면 상태를 빼고
 * 보낸 요청이 비활성 고객을 조용히 다시 활성화한다. 선택 항목을 생략하면 null 로
 * 비워진다(전체 교체).
 */
export const customerUpdateSchema = customerCreateSchema.extend({
  status: customerStatusSchema,
});

/** 비활성화·활성화. 상태 전환만 허용한다. (NFR-03, API 명세 5.4) */
export const customerStatusSchemaBody = z.object({
  status: customerStatusSchema,
});

export type CustomerCreate = z.infer<typeof customerCreateSchema>;
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;
