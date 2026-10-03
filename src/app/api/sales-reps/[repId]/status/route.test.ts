import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REP,
  asAdmin,
  asSalesRep,
  params,
  readBody,
} from "@/test/sales-rep-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesRep: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const URL = "http://localhost/api/sales-reps/1/status";

function prismaError(code: string) {
  return Object.assign(new Error(code), { code, meta: undefined });
}

beforeEach(() => {
  // 기본값은 관리자가 아닌 사원 — 마지막 관리자 판정에 걸리지 않는다.
  vi.mocked(prisma.salesRep.findUnique)
    .mockReset()
    .mockResolvedValue({ role: "SALES_REP", status: "ACTIVE" } as never);
  vi.mocked(prisma.salesRep.count).mockReset().mockResolvedValue(0);
  vi.mocked(prisma.salesRep.update)
    .mockReset()
    .mockResolvedValue({ ...REP, status: "INACTIVE" });
});

describe("PATCH /api/sales-reps/{repId}/status — TC-REP-04", () => {
  it("상태를 INACTIVE 로 바꾼다", async () => {
    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("1")
    );
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ repId: 1, status: "INACTIVE" });
    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: { status: "INACTIVE", tokenVersion: { increment: 1 } },
    });
  });

  it("물리 삭제를 호출하지 않는다 (NFR-03)", async () => {
    await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("1")
    );

    expect(prisma.salesRep.delete).not.toHaveBeenCalled();
    expect(prisma.salesRep.deleteMany).not.toHaveBeenCalled();
  });

  it("다시 ACTIVE 로 되돌릴 수 있다", async () => {
    vi.mocked(prisma.salesRep.update).mockResolvedValue(REP);

    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "ACTIVE" } }),
      params("1")
    );

    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toMatchObject({ status: "ACTIVE" });
  });

  it.each([{ status: "DELETED" }, { status: "" }, {}])(
    "정의되지 않은 상태(%o)는 400이다",
    async (body) => {
      const response = await PATCH(asAdmin(URL, { method: "PATCH", body }), params("1"));

      expect(response.status).toBe(400);
      expect(prisma.salesRep.update).not.toHaveBeenCalled();
    }
  );

  it("없는 사원이면 404다", async () => {
    vi.mocked(prisma.salesRep.update).mockRejectedValue(prismaError("P2025"));

    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("99")
    );

    expect(response.status).toBe(404);
  });

  it("repId 가 숫자가 아니면 400이다", async () => {
    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("abc")
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("영업사원이 호출하면 403이다 (TC-SEC-03)", async () => {
    const response = await PATCH(
      asSalesRep(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("1")
    );

    expect(response.status).toBe(403);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });
});

describe("PATCH status — 토큰 무효화 (#52)", () => {
  it("비활성화하면 토큰 버전을 올린다", async () => {
    await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("1")
    );

    // 비활성화는 즉시 효력이 있어야 한다. 토큰 만료를 기다리지 않는다.
    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).toMatchObject({ tokenVersion: { increment: 1 } });
  });

  it("재활성화할 때는 버전을 올리지 않는다", async () => {
    vi.mocked(prisma.salesRep.update).mockResolvedValue(REP);

    await PATCH(asAdmin(URL, { method: "PATCH", body: { status: "ACTIVE" } }), params("1"));

    // 끊을 세션이 없다. 이미 비활성 상태에서는 토큰이 모두 막혀 있다.
    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data.tokenVersion).toBeUndefined();
  });
});

describe("PATCH status — 마지막 관리자 보호 (#49)", () => {
  function targetIsLastAdmin() {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      role: "ADMIN",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.salesRep.count).mockResolvedValue(0);
  }

  it("마지막 활성 관리자는 비활성화할 수 없다", async () => {
    targetIsLastAdmin();

    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("1")
    );

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("LAST_ACTIVE_ADMIN");
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("다른 관리자가 있으면 비활성화할 수 있다", async () => {
    targetIsLastAdmin();
    vi.mocked(prisma.salesRep.count).mockResolvedValue(1);

    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "INACTIVE" } }),
      params("1")
    );

    expect(response.status).toBe(200);
  });

  it("마지막 관리자를 다시 활성화하는 것은 막지 않는다", async () => {
    targetIsLastAdmin();

    const response = await PATCH(
      asAdmin(URL, { method: "PATCH", body: { status: "ACTIVE" } }),
      params("1")
    );

    expect(response.status).toBe(200);
  });
});
