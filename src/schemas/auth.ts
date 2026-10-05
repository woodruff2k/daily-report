import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

/** 이메일·사번을 받으므로 이메일 상한(255)을 쓴다. */
export const MAX_LOGIN_ID_LENGTH = 255;

export const loginRequestSchema = z.object({
  // 제어문자(NUL 포함)는 조회 쿼리 파라미터로 PostgreSQL 이 거부해 500 이 된다.
  loginId: z
    .string()
    .min(1)
    .max(MAX_LOGIN_ID_LENGTH)
    .refine(
      (value) => !/[\u0000-\u001F\u007F]/.test(value) && value.isWellFormed(),
    ),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * 본인 비밀번호 변경. (이슈 #44)
 *
 * 현재 비밀번호를 함께 받는다. 토큰만으로 변경을 허용하면 탈취한 토큰으로
 * 비밀번호를 갈아버릴 수 있다.
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export type PasswordChangeRequest = z.infer<typeof passwordChangeSchema>;
