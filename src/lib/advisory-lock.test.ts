import { describe, expect, it, vi } from "vitest";
import { lockAdminMutations } from "./advisory-lock";

describe("lockAdminMutations — #55", () => {
  it("권고 잠금을 건다", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);

    await lockAdminMutations({ $executeRaw: executeRaw } as never);

    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("트랜잭션 수명 잠금(pg_advisory_xact_lock)을 쓴다", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);

    await lockAdminMutations({ $executeRaw: executeRaw } as never);

    // 세션 잠금(pg_advisory_lock)은 명시적 해제가 필요해 예외 경로에서 남는다.
    const [strings] = executeRaw.mock.calls[0] as [string[]];
    expect(strings.join("")).toContain("pg_advisory_xact_lock");
    expect(strings.join("")).not.toContain("pg_advisory_lock(");
  });

  it("키를 파라미터로 넘긴다", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);

    await lockAdminMutations({ $executeRaw: executeRaw } as never);

    // 문자열로 이어붙이지 않는다.
    const [, key] = executeRaw.mock.calls[0] as [string[], number];
    expect(typeof key).toBe("number");
  });
});
