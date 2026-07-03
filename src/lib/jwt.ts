import jwt from "jsonwebtoken";
import type { AuthTokenPayload } from "@/types/auth";

const ACCESS_TOKEN_EXPIRES_IN = "8h";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET 환경 변수가 설정되지 않았습니다.");
  }
  return secret;
}

export function signAccessToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
}
