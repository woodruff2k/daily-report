// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-CUS-04(물리 삭제가 아니라 상태 변경), TC-CUS-05(참조 유지는 reports/[reportId] 테스트)
import { describe, expect, it } from "vitest";
import { PATCH } from "./route";
import { prisma } from "@/lib/prisma";
import {
  createCustomer,
  createRep,
  createReport,
  createVisit,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

describe("PATCH /api/customers/{id}/status (실제 DB)", () => {
  it("TC-CUS-04: INACTIVE 로 바꾸면 200 이고 행은 남아 있으며 방문기록 참조도 유지된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    const visit = await createVisit(report.reportId, customer.customerId);

    const result = await call(
      PATCH,
      "PATCH",
      `/api/customers/${customer.customerId}/status`,
      {
        as: rep,
        body: { status: "INACTIVE" },
        params: { customerId: customer.customerId },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("INACTIVE");
    const row = await prisma.customer.findUnique({
      where: { customerId: customer.customerId },
    });
    expect(row?.status).toBe("INACTIVE");
    const kept = await prisma.visitRecord.findUnique({
      where: { visitId: visit.visitId },
    });
    expect(kept?.customerId).toBe(customer.customerId);
  });

  it("없는 고객은 404 이다", async () => {
    const rep = await createRep();

    const result = await call(PATCH, "PATCH", "/api/customers/99999/status", {
      as: rep,
      body: { status: "INACTIVE" },
      params: { customerId: 99999 },
    });

    expect(result.status).toBe(404);
  });

  it("허용되지 않은 상태 값은 400 이고 상태가 바뀌지 않는다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);

    const result = await call(
      PATCH,
      "PATCH",
      `/api/customers/${customer.customerId}/status`,
      {
        as: rep,
        body: { status: "DELETED" },
        params: { customerId: customer.customerId },
      },
    );

    expect(result.status).toBe(400);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: customer.customerId },
    });
    expect(row.status).toBe("ACTIVE");
  });
});

describe("PATCH /api/customers/{id}/status 쓰기 범위 (실제 DB) — TC-SEC-08", () => {
  const patch = (as: Actor, customerId: bigint) =>
    call(PATCH, "PATCH", `/api/customers/${customerId}/status`, {
      as,
      body: { status: "INACTIVE" },
      params: { customerId },
    });

  async function setup() {
    const manager = await createRep({ role: "MANAGER" });
    const owner = await createRep({ managerId: manager.repId });
    const otherManager = await createRep({ role: "MANAGER" });
    const stranger = await createRep({ managerId: otherManager.repId });
    return {
      manager,
      owner,
      otherManager,
      stranger,
      customer: await createCustomer(owner.repId),
    };
  }

  it("담당 영업 본인과 직속 상급자는 200", async () => {
    const { owner, manager, customer } = await setup();
    const second = await createCustomer(owner.repId);

    expect((await patch(owner, customer.customerId)).status).toBe(200);
    expect((await patch(manager, second.customerId)).status).toBe(200);
  });

  it("무관한 영업사원·다른 팀 상급자는 403 이고 상태가 바뀌지 않는다", async () => {
    const { stranger, otherManager, customer } = await setup();

    for (const actor of [stranger, otherManager]) {
      expect((await patch(actor, customer.customerId)).status).toBe(403);
    }
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: customer.customerId },
    });
    expect(row.status).toBe("ACTIVE");
  });

  it("담당 영업이 null 인 고객은 403, 없는 고객은 404", async () => {
    const { owner, manager, customer } = await setup();
    await prisma.customer.update({
      where: { customerId: customer.customerId },
      data: { assignedRepId: null },
    });

    expect((await patch(owner, customer.customerId)).status).toBe(403);
    expect((await patch(manager, customer.customerId)).status).toBe(403);
    expect((await patch(owner, 99999n)).status).toBe(404);
  });
});
