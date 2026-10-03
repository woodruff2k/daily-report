import { z } from "zod";

/**
 * 영업 마스터 입력 검증. (FR-02, API 명세 6)
 *
 * `empNo`·`email`의 유니크 여부와 `managerId`의 존재 여부는 DB를 봐야 알 수 있어
 * 여기서 검증하지 않는다. 라우트가 각각 409와 400으로 처리한다.
 */

const repStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/**
 * 식별자는 JSON 숫자(API 명세 6.2)로 오지만 DB는 BigInt다.
 * 안전 정수 범위를 넘는 값은 변환 과정에서 정밀도를 잃으므로 미리 막는다.
 */
const repIdSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const salesRepCreateSchema = z.object({
  empNo: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  department: z.string().trim().max(100).optional(),
  position: z.string().trim().max(100).optional(),
  managerId: repIdSchema.optional(),
  status: repStatusSchema.default("ACTIVE"),
  /**
   * 선택 항목. 생략하면 로그인할 수 없는 계정으로 만들어진다.
   * API 명세 6.2의 요청 예시에 비밀번호가 없어 필수로 두지 않았다.
   */
  password: z.string().min(8).max(72).optional(),
});

/** 전체 필드 수정. PUT이므로 생성과 같은 필수 항목을 요구한다. (API 명세 6.3) */
export const salesRepUpdateSchema = salesRepCreateSchema.omit({ password: true });

/** 비활성화. 상태 전환만 허용한다. (NFR-03, API 명세 6.4) */
export const salesRepStatusSchema = z.object({
  status: repStatusSchema,
});

export type SalesRepCreate = z.infer<typeof salesRepCreateSchema>;
export type SalesRepUpdate = z.infer<typeof salesRepUpdateSchema>;
export type SalesRepStatusUpdate = z.infer<typeof salesRepStatusSchema>;
