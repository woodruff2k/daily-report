import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";
import { idSchema } from "./identifier";
import { singleLineText } from "./text";

/**
 * 영업 마스터 입력 검증. (FR-02, API 명세 6)
 *
 * `empNo`·`email`의 유니크 여부와 `managerId`의 존재 여부는 DB를 봐야 알 수 있어
 * 여기서 검증하지 않는다. 라우트가 각각 409와 400으로 처리한다.
 */

const repStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/**
 * 역할. 인가 판정의 근거이므로(#4) 등록·수정에서 명시적으로 받는다.
 *
 * 이 엔드포인트 자체가 ADMIN 전용이라 역할을 올리는 요청은 관리자만 보낼 수 있다.
 * 기본값을 SALES_REP 로 둬서 API 명세 6.2 의 요청 예시(역할 없음)도 통과한다.
 */
const roleSchema = z.enum(["SALES_REP", "MANAGER", "ADMIN"]);

export const salesRepCreateSchema = z.object({
  empNo: singleLineText().min(1).max(20),
  name: singleLineText().min(1).max(100),
  email: z.string().trim().email().max(255),
  department: singleLineText().max(100).optional(),
  position: singleLineText().max(100).optional(),
  managerId: idSchema.optional(),
  role: roleSchema.default("SALES_REP"),
  status: repStatusSchema.default("ACTIVE"),
  /**
   * 선택 항목. 생략하면 서버가 임시 비밀번호를 만들어 응답에 1회 반환한다.
   * 어느 경우든 최초 로그인 시 변경을 강제한다. (이슈 #44)
   */
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH)
    .max(MAX_PASSWORD_LENGTH)
    .optional(),
});

/**
 * 전체 필드 수정. (API 명세 6.3)
 *
 * `role`·`status`는 생성과 달리 **기본값을 두지 않고 필수로 받는다.** PUT은 전체
 * 교체이므로 기본값이 적용되면 보내지 않은 필드가 조용히 바뀐다. `role`을 빼면
 * MANAGER가 SALES_REP로 강등되고, `status`를 빼면 비활성 계정이 다시 활성화된다.
 * 둘 다 부서명만 고치려던 요청이 권한을 바꿔버리는 경우다.
 *
 * 화면(SCR-510)에서 역할·상태는 모두 필수 항목이므로 정상 요청은 영향이 없다.
 */
export const salesRepUpdateSchema = salesRepCreateSchema
  .omit({ password: true })
  .extend({
    role: roleSchema,
    status: repStatusSchema,
  });

/** 비활성화. 상태 전환만 허용한다. (NFR-03, API 명세 6.4) */
export const salesRepStatusSchema = z.object({
  status: repStatusSchema,
});

export type SalesRepCreate = z.infer<typeof salesRepCreateSchema>;
export type SalesRepUpdate = z.infer<typeof salesRepUpdateSchema>;
export type SalesRepStatusUpdate = z.infer<typeof salesRepStatusSchema>;
