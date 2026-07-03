import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(
      verifyPassword("correct-horse-battery-staple", hash)
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects any password when the hash is null (no such account)", async () => {
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
  });
});
