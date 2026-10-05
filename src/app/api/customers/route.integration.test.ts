// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-CUS-01, TC-CUS-02, TC-CUS-03, TC-SEC-06(목록에 이메일 미포함)
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import { createCustomer, createRep } from "@/test/integration/factories";
import { call } from "@/test/integration/http";

describe("POST /api/customers (실제 DB)", () => {
  it("TC-CUS-01: 필수 항목으로 고객을 등록하면 201 이고 DB 에 ACTIVE 로 저장된다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/customers", {
      as: rep,
      body: {
        customerName: "테스트고객1",
        companyName: "(주)테스트",
        assignedRepId: Number(rep.repId),
      },
    });

    expect(result.status).toBe(201);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: BigInt(result.body.data.customerId) },
    });
    expect(row).toMatchObject({
      customerName: "테스트고객1",
      companyName: "(주)테스트",
      assignedRepId: rep.repId,
      status: "ACTIVE",
    });
  });

  it("TC-CUS-02: 이메일 형식 오류는 400 이고 저장되지 않는다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/customers", {
      as: rep,
      body: {
        customerName: "테스트고객1",
        email: "abc",
        assignedRepId: Number(rep.repId),
      },
    });

    expect(result.status).toBe(400);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("존재하지 않는 담당 영업은 FK 오류(500)가 아니라 400 이다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/customers", {
      as: rep,
      body: { customerName: "테스트고객1", assignedRepId: 99999 },
    });

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("ASSIGNED_REP_NOT_FOUND");
  });

  it("ADMIN 은 고객 마스터를 등록할 수 없다(403)", async () => {
    const admin = await createRep({ role: "ADMIN" });

    const result = await call(POST, "POST", "/api/customers", {
      as: admin,
      body: { customerName: "테스트고객1", assignedRepId: Number(admin.repId) },
    });

    expect(result.status).toBe(403);
    expect(await prisma.customer.count()).toBe(0);
  });
});

describe("GET /api/customers (실제 DB)", () => {
  it("TC-CUS-03: keyword 필터는 조건에 맞는 고객만 돌려주고 목록에 이메일·주소를 싣지 않는다", async () => {
    const rep = await createRep();
    const hit = await createCustomer(rep.repId, {
      customerName: "테스트고객가나",
    });
    await createCustomer(rep.repId, { customerName: "다른고객" });

    const result = await call(GET, "GET", "/api/customers", {
      as: rep,
      query: { keyword: "가나" },
    });

    expect(result.status).toBe(200);
    expect(result.body.data.totalElements).toBe(1);
    expect(result.body.data.content[0].customerId).toBe(Number(hit.customerId));
    expect(result.raw).not.toContain(hit.email!);
    expect(result.raw).not.toContain(hit.address!);
  });
});
