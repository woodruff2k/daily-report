// 통합 테스트(실제 PostgreSQL). 권고 잠금(pg_advisory_xact_lock)은 목으로 확인할 수 없다.
// 덮는 TC: TC-REP-04, TC-SEC-03
// 이슈 #55: 마지막 활성 관리자 보호의 경합, 비활성화 시 토큰 무효화
import { describe, expect, it } from "vitest";
import { PATCH } from "./route";
import { prisma } from "@/lib/prisma";
import { withHeldTransaction } from "@/test/integration/held-transaction";
import { lockAdminMutations } from "@/lib/advisory-lock";
import { createRep } from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

type As = Actor;

const setStatus = (repId: bigint, as: As, status: string) =>
  call(PATCH, "PATCH", `/api/sales-reps/${repId}/status`, {
    as,
    body: { status },
    params: { repId },
  });

const activeAdminCount = () =>
  prisma.salesRep.count({ where: { role: "ADMIN", status: "ACTIVE" } });

describe("PATCH /api/sales-reps/{id}/status (실제 DB)", () => {
  it("TC-REP-04: 관리자가 영업사원을 비활성화하면 200 이고 행은 남고 tokenVersion 이 오른다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const rep = await createRep();

    const result = await setStatus(rep.repId, admin, "INACTIVE");

    expect(result.status).toBe(200);
    const row = await prisma.salesRep.findUniqueOrThrow({
      where: { repId: rep.repId },
    });
    expect(row.status).toBe("INACTIVE");
    expect(row.tokenVersion).toBe(rep.tokenVersion + 1);
  });

  it("TC-SEC-03: 영업사원은 비활성화할 수 없다(403)", async () => {
    const caller = await createRep();
    const target = await createRep();

    const result = await setStatus(target.repId, caller, "INACTIVE");

    expect(result.status).toBe(403);
    const row = await prisma.salesRep.findUniqueOrThrow({
      where: { repId: target.repId },
    });
    expect(row.status).toBe("ACTIVE");
  });

  it("마지막 활성 관리자는 409 LAST_ACTIVE_ADMIN 이다", async () => {
    const admin = await createRep({ role: "ADMIN" });

    const result = await setStatus(admin.repId, admin, "INACTIVE");

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("LAST_ACTIVE_ADMIN");
    expect(await activeAdminCount()).toBe(1);
  });

  it("이슈 #55: 활성 관리자 2명이 서로를 동시에 비활성화해도 활성 관리자는 0명이 되지 않는다", async () => {
    // 반복해서 경합 창을 여러 번 지난다. 잠금이 없으면 어느 한 번은 둘 다 통과한다.
    for (let i = 0; i < 15; i += 1) {
      await prisma.salesRep.deleteMany();
      const a = await createRep({ role: "ADMIN" });
      const b = await createRep({ role: "ADMIN" });

      const results = await Promise.all([
        setStatus(b.repId, a, "INACTIVE"),
        setStatus(a.repId, b, "INACTIVE"),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
        "LAST_ACTIVE_ADMIN",
      );
      expect(await activeAdminCount()).toBe(1);
    }
  });

  it("이슈 #55 직렬화(결정적): 다른 관리자 비활성화가 커밋되기 전에 들어온 요청은 대기했다가 409 LAST_ACTIVE_ADMIN 이다", async () => {
    // 요청1(붙잡은 트랜잭션)이 잠금을 쥐고 B 를 비활성화한 상태에서 요청2 가 A 를
    // 비활성화하려 한다. 잠금이 없으면 요청2 는 커밋된 B(활성)를 보고 통과해 0명이 된다.
    const a = await createRep({ role: "ADMIN" });
    const b = await createRep({ role: "ADMIN" });

    const second = await withHeldTransaction(
      async (tx) => {
        await lockAdminMutations(tx);
        await tx.salesRep.update({
          where: { repId: b.repId },
          data: { status: "INACTIVE" },
        });
      },
      () => setStatus(a.repId, a, "INACTIVE"),
    );

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("LAST_ACTIVE_ADMIN");
    expect(await activeAdminCount()).toBe(1);
  });

  it("이슈 #55: 한 명이 자기 자신과 다른 관리자를 동시에 비활성화해도 한 명은 남는다", async () => {
    const a = await createRep({ role: "ADMIN" });
    const b = await createRep({ role: "ADMIN" });

    const results = await Promise.all([
      setStatus(a.repId, a, "INACTIVE"),
      setStatus(b.repId, a, "INACTIVE"),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await activeAdminCount()).toBe(1);
  });
});
