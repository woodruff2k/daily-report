import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/password-policy";

export const loginRequestSchema = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * 본인 비밀번호 변경. (이슈 #44)
 *
 * 현재 비밀번호를 함께 받는다. 토큰만으로 변경을 허용하면 탈취한 토큰으로
 * 비밀번호를 갈아버릴 수 있다.
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export type PasswordChangeRequest = z.infer<typeof passwordChangeSchema>;
