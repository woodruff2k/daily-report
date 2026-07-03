import { z } from "zod";

export const loginRequestSchema = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
