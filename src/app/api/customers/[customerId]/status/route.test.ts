import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOMER,
  asAdmin,
  asManager,
  asSalesRep,
  params,
  readBody,
  withoutAuth,
} from "@/test/customer-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const URL = "http://localhost/api/customers/5/status";

beforeEach(() => {
  vi.mocked(prisma.customer.update)
    .mockReset()
    .mockResolvedValue({ ...CUSTOMER, status: "INACTIVE" });
});

describe("PATCH /api/customers/{customerId}/status — TC-CUS-04", () => {
  it("INACTIVE 로 바꾸고 물리 삭제하지 않는다", async () => {
    const response = await PATCH(
      asSalesRep(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("5"),
    );
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ customerId: 5, status: "INACTIVE" });
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { customerId: 5n },
      data: { status: "INACTIVE" },
      include: { assignedRep: { select: { name: true } } },
    });
    expect(prisma.customer.delete).not.toHaveBeenCalled();
    expect(prisma.customer.deleteMany).not.toHaveBeenCalled();
  });

  it("상급자도 다시 ACTIVE 로 되돌릴 수 있다", async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue(CUSTOMER);
    const response = await PATCH(
      asManager(URL, { method: "PATCH", body: { status: "ACTIVE" } }),
      params("5"),
    );
    expect(response.status).toBe(200);
  });

  it.each([{ status: "DELETED" }, {}, null])("본문 %j 는 400", async (body) => {
    const response = await PATCH(
      asSalesRep(URL, { method: "PATCH", body }),
      params("5"),
    );
    expect(response.status).toBe(400);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("없는 고객은 404", async () => {
    vi.mocked(prisma.customer.update).mockRejectedValue(
      Object.assign(new Error("P2025"), { code: "P2025" }),
    );
    const response = await PATCH(
      asSalesRep(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("5"),
    );
    expect(response.status).toBe(404);
  });

  it.each(["abc", "9007199254740993"])("식별자 %s 는 400", async (id) => {
    const response = await PATCH(
      asSalesRep(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params(id),
    );
    expect(response.status).toBe(400);
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    const body = { status: "INACTIVE" };
    expect(
      (await PATCH(asAdmin(URL, { method: "PATCH", body }), params("5")))
        .status,
    ).toBe(403);
    expect(
      (await PATCH(withoutAuth(URL, { method: "PATCH", body }), params("5")))
        .status,
    ).toBe(401);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});
