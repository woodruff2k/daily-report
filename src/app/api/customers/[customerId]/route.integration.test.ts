// 통합 테스트(실제 PostgreSQL). managerId 관계를 실제로 타는 쓰기 범위 판정.
// 덮는 TC: TC-SEC-08(고객 쓰기 범위 — 이슈 #68 정책 C), TC-SEC-09(등록·담당 이관 흐름)
import { describe, expect, it } from "vitest";
import { GET, PUT } from "./route";
import { GET as LIST, POST } from "../route";
import { prisma } from "@/lib/prisma";
import { createCustomer, createRep } from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

/** 담당 영업(owner) · 그 직속 상급자 · 다른 팀 상급자 · 무관한 영업사원. */
async function setup() {
  const manager = await createRep({ role: "MANAGER" });
  const owner = await createRep({ managerId: manager.repId });
  const otherManager = await createRep({ role: "MANAGER" });
  const stranger = await createRep({ managerId: otherManager.repId });
  const customer = await createCustomer(owner.repId);
  return { manager, owner, otherManager, stranger, customer };
}

const body = (assignedRepId: bigint, customerName = "수정고객") => ({
  customerName,
  assignedRepId: Number(assignedRepId),
  status: "ACTIVE",
});

const put = (as: Actor, customerId: bigint, payload: unknown) =>
  call(PUT, "PUT", `/api/customers/${customerId}`, {
    as,
    body: payload,
    params: { customerId },
  });

describe("PUT /api/customers/{id} 쓰기 범위 (실제 DB) — TC-SEC-08", () => {
  it("담당 영업 본인과 직속 상급자는 수정할 수 있다", async () => {
    const { owner, manager, customer } = await setup();

    expect(
      (await put(owner, customer.customerId, body(owner.repId, "본인수정")))
        .status,
    ).toBe(200);
    expect(
      (await put(manager, customer.customerId, body(owner.repId, "상급수정")))
        .status,
    ).toBe(200);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: customer.customerId },
    });
    expect(row.customerName).toBe("상급수정");
  });

  it("무관한 영업사원·다른 팀 상급자는 403 이고 행이 바뀌지 않는다", async () => {
    const { owner, stranger, otherManager, customer } = await setup();

    for (const actor of [stranger, otherManager]) {
      const result = await put(
        actor,
        customer.customerId,
        body(actor.repId, "탈취"),
      );
      expect(result.status).toBe(403);
      expect(result.body.error.code).toBe("CUSTOMER_WRITE_FORBIDDEN");
    }
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: customer.customerId },
    });
    expect(row.customerName).toBe(customer.customerName);
    expect(row.assignedRepId).toBe(owner.repId);
  });

  it("남의 고객을 자기 담당으로 가져가는 요청도 403 이다", async () => {
    const { owner, stranger, customer } = await setup();

    const result = await put(
      stranger,
      customer.customerId,
      body(stranger.repId),
    );

    expect(result.status).toBe(403);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: customer.customerId },
    });
    expect(row.assignedRepId).toBe(owner.repId);
  });

  it("ADMIN 은 403 이다", async () => {
    const { owner, customer } = await setup();
    const admin = await createRep({ role: "ADMIN" });

    expect(
      (await put(admin, customer.customerId, body(owner.repId))).status,
    ).toBe(403);
  });

  it("담당 영업이 null 인 고객은 누구도 수정할 수 없다(403)", async () => {
    const { owner, manager, customer } = await setup();
    await prisma.customer.update({
      where: { customerId: customer.customerId },
      data: { assignedRepId: null },
    });

    for (const actor of [owner, manager]) {
      expect(
        (await put(actor, customer.customerId, body(owner.repId))).status,
      ).toBe(403);
    }
  });

  it("없는 고객은 404 다", async () => {
    const { stranger } = await setup();
    expect((await put(stranger, 99999n, body(stranger.repId))).status).toBe(
      404,
    );
  });

  it("TC-SEC-09 담당 이관: 본인 고객을 남에게 넘기면 성공하고, 받은 사람만 수정할 수 있다", async () => {
    const { owner, stranger, customer } = await setup();

    const transfer = await put(
      owner,
      customer.customerId,
      body(stranger.repId),
    );
    expect(transfer.status).toBe(200);
    expect(transfer.body.data.assignedRepId).toBe(Number(stranger.repId));

    expect(
      (await put(stranger, customer.customerId, body(stranger.repId, "수신자")))
        .status,
    ).toBe(200);
    expect(
      (await put(owner, customer.customerId, body(owner.repId, "송신자")))
        .status,
    ).toBe(403);
  });
});

describe("고객 등록·조회 범위 (실제 DB) — TC-SEC-08", () => {
  it("TC-SEC-09 남을 담당자로 지정해 등록하면 201 이고, 등록자는 그 고객을 수정할 수 없다", async () => {
    const { owner, stranger } = await setup();

    const created = await call(POST, "POST", "/api/customers", {
      as: stranger,
      body: body(owner.repId, "대리등록"),
    });
    expect(created.status).toBe(201);
    const customerId = BigInt(created.body.data.customerId);

    expect((await put(stranger, customerId, body(owner.repId))).status).toBe(
      403,
    );
    expect((await put(owner, customerId, body(owner.repId))).status).toBe(200);
  });

  it("목록·상세는 전사에 열려 있다 — 무관한 영업사원도 200", async () => {
    const { stranger, otherManager, customer } = await setup();

    for (const actor of [stranger, otherManager]) {
      const detail = await call(
        GET,
        "GET",
        `/api/customers/${customer.customerId}`,
        { as: actor, params: { customerId: customer.customerId } },
      );
      expect(detail.status).toBe(200);

      const list = await call(LIST, "GET", "/api/customers", {
        as: actor,
        query: { keyword: customer.customerName },
      });
      expect(list.status).toBe(200);
      expect(list.body.data.content.length).toBeGreaterThan(0);
    }
  });
});
