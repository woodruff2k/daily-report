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
import { call } from "@/test/integration/http";

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
