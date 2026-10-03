import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

// Not a real credential — used only to keep bcrypt.compare's cost constant
// when no account is found, so login timing doesn't leak account existence.
const DUMMY_HASH =
  "$2a$10$CwTycUXWue0Thq9StjUM0uJ8kO7Vm2eJm4kfLpO2vFAY.RxG.j3G6";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(
  password: string,
  passwordHash: string | null
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash ?? DUMMY_HASH);
}

/**
 * 관리자가 전달할 임시 비밀번호를 만든다. (이슈 #44)
 *
 * 평문은 생성 시점에 응답으로 한 번만 나가고 저장되지 않는다. 사람이 읽어
 * 전달할 수 있어야 하므로 base64url 로 만든다(혼동되는 문자를 피하려면
 * 별도 사전이 필요하지만, 복사·붙여넣기를 전제로 두었다).
 *
 * 24바이트를 쓰면 32자가 되어 최소 길이를 넉넉히 넘긴다.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}
