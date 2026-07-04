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
