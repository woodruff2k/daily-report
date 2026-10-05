import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOMER,
  CUSTOMER_WITH_SCOPE,
  asAdmin,
  asManager,
  asOtherTeamManager,
  asSalesRep,
  asStranger,
  params,
  readBody,
  withoutAuth,
} from "@/test/customer-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const URL = "http://localhost/api/customers/5/status";

beforeEach(() => {
  vi.mocked(prisma.customer.findUnique)
    .mockReset()
    .mockResolvedValue(CUSTOMER_WITH_SCOPE);
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
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);
    const response = await PATCH(
      asSalesRep(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("5"),
    );
    expect(response.status).toBe(404);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("조회와 수정 사이에 지워졌다면(P2025) 404", async () => {
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

// TC-SEC-08: 고객 쓰기 범위 (이슈 #68 정책 C)
describe("PATCH /api/customers/{customerId}/status — 쓰기 범위 (TC-SEC-08)", () => {
  const as = (make: typeof asSalesRep) =>
    PATCH(
      make(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("5"),
    );

  it.each([
    ["담당 영업 본인", asSalesRep],
    ["직속 상급자", asManager],
  ])("%s 는 200", async (_name, make) => {
    expect((await as(make)).status).toBe(200);
  });

  it.each([
    ["무관한 영업사원", asStranger],
    ["다른 팀 상급자", asOtherTeamManager],
  ])("%s 는 403 이고 쓰지 않는다", async (_name, make) => {
    const response = await as(make);

    expect(response.status).toBe(403);
    expect((await readBody(response)).error?.code).toBe(
      "CUSTOMER_WRITE_FORBIDDEN",
    );
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("담당 영업이 null 인 고객은 누구도 바꿀 수 없다(403)", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      assignedRep: null,
    } as never);

    for (const make of [asSalesRep, asManager, asStranger]) {
      expect((await as(make)).status).toBe(403);
    }
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("없는 고객은 권한과 무관하게 404 다 — 404 가 403 보다 먼저", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);
    expect((await as(asStranger)).status).toBe(404);
  });
});
