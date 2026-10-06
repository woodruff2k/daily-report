// 통합 테스트(실제 PostgreSQL). 단위 테스트의 Prisma 목은 `select` 가 무엇을 읽는지
// 확인하지 못한다 — 아래 두 판정은 쿼리가 읽은 열에 달려 있어 실제 DB 로 본다.
// 덮는 TC: TC-REP-03(상급자 지정의 검증), TC-REP-04(토큰 무효화), TC-SEC-03
// 이슈 #93: 이 경로에는 통합 테스트가 없었다. 뮤테이션 확인에서 `select` 의 열을 빼도
// 단위·통합 테스트가 모두 통과했다.
import { describe, expect, it } from "vitest";
import { PUT } from "./route";
import { prisma } from "@/lib/prisma";
import { createRep } from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

const putRep = (repId: bigint, as: Actor, body: Record<string, unknown>) =>
  call(PUT, "PUT", `/api/sales-reps/${repId}`, {
    as,
    body,
    params: { repId },
  });

/** 현재 행 그대로의 수정 본문. 바꿀 항목만 덮어쓴다. */
async function bodyOf(repId: bigint, overrides: Record<string, unknown> = {}) {
  const row = await prisma.salesRep.findUniqueOrThrow({ where: { repId } });
  return {
    empNo: row.empNo,
    name: row.name,
    email: row.email,
    department: row.department ?? undefined,
    position: row.position ?? undefined,
    managerId: row.managerId === null ? undefined : Number(row.managerId),
    role: row.role,
    status: row.status,
    ...overrides,
  };
}

const row = (repId: bigint) =>
  prisma.salesRep.findUniqueOrThrow({ where: { repId } });

describe("PUT /api/sales-reps/{id} — 상급자 순환 (실제 DB)", () => {
  it("TC-REP-03: 두 단계 위의 상급자로 순환을 만들면 400 MANAGER_CYCLE 이고 저장되지 않는다", async () => {
    // top ← mid ← low 체인에서 top 의 상급자를 low 로 지정하면 순환이다.
    // 첫 칸(low 의 상급자 = mid)은 top 이 아니라서 **체인을 한 칸 더 올라가야** 닿는다.
    // 그 한 칸이 `select: { managerId: true }` 에 달려 있다.
    const admin = await createRep({ role: "ADMIN" });
    const top = await createRep({ role: "MANAGER" });
    const mid = await createRep({ role: "MANAGER", managerId: top.repId });
    const low = await createRep({ role: "MANAGER", managerId: mid.repId });

    const result = await putRep(
      top.repId,
      admin,
      await bodyOf(top.repId, { managerId: Number(low.repId) }),
    );

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("MANAGER_CYCLE");
    expect((await row(top.repId)).managerId).toBeNull();
  });

  it("TC-REP-03: 순환이 아닌 상급자 지정은 저장된다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const top = await createRep({ role: "MANAGER" });
    const mid = await createRep({ role: "MANAGER", managerId: top.repId });
    const other = await createRep();

    const result = await putRep(
      other.repId,
      admin,
      await bodyOf(other.repId, { managerId: Number(mid.repId) }),
    );

    expect(result.status).toBe(200);
    expect((await row(other.repId)).managerId).toBe(mid.repId);
  });
});

describe("PUT /api/sales-reps/{id} — 토큰 무효화 (실제 DB, #52)", () => {
  it("TC-REP-04: 역할이 바뀌면 tokenVersion 이 오른다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const rep = await createRep();

    const result = await putRep(
      rep.repId,
      admin,
      await bodyOf(rep.repId, { role: "MANAGER" }),
    );

    expect(result.status).toBe(200);
    const after = await row(rep.repId);
    expect(after.role).toBe("MANAGER");
    expect(after.tokenVersion).toBe(rep.tokenVersion + 1);
  });

  it("TC-REP-04: 비활성으로 바뀌면 tokenVersion 이 오른다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const rep = await createRep();

    const result = await putRep(
      rep.repId,
      admin,
      await bodyOf(rep.repId, { status: "INACTIVE" }),
    );

    expect(result.status).toBe(200);
    expect((await row(rep.repId)).tokenVersion).toBe(rep.tokenVersion + 1);
  });

  it("역할·상태가 그대로이면 tokenVersion 이 오르지 않는다 (이름만 고친 경우)", async () => {
    // 매 수정마다 올리면 이름만 고쳐도 그 사원의 세션이 모두 끊긴다.
    const admin = await createRep({ role: "ADMIN" });
    const rep = await createRep();

    const result = await putRep(
      rep.repId,
      admin,
      await bodyOf(rep.repId, { name: "바뀐이름" }),
    );

    expect(result.status).toBe(200);
    const after = await row(rep.repId);
    expect(after.name).toBe("바뀐이름");
    expect(after.tokenVersion).toBe(rep.tokenVersion);
  });

  it.each([
    ["INACTIVE", "INACTIVE"],
    ["INACTIVE", "ACTIVE"],
  ] as const)(
    "이미 %s 인 사원을 %s 로 저장하면 이미 비활성인 것을 다시 끊지 않는다",
    async (from, to) => {
      // 비활성 → 비활성은 바뀐 것이 없다. 되살리는 것(→ACTIVE)도 세션을 끊을 이유가 없다.
      const admin = await createRep({ role: "ADMIN" });
      const rep = await createRep({ status: from });

      const result = await putRep(
        rep.repId,
        admin,
        await bodyOf(rep.repId, { status: to }),
      );

      expect(result.status).toBe(200);
      expect((await row(rep.repId)).tokenVersion).toBe(rep.tokenVersion);
    },
  );

  it("TC-SEC-03: 영업사원은 수정할 수 없다(403)", async () => {
    const caller = await createRep();
    const target = await createRep();

    const result = await putRep(
      target.repId,
      caller,
      await bodyOf(target.repId, { name: "가로채기" }),
    );

    expect(result.status).toBe(403);
    expect((await row(target.repId)).name).toBe(target.name);
  });
});
