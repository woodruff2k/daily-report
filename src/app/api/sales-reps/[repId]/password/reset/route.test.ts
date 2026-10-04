import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REP,
  asAdmin,
  asSalesRep,
  params,
  readBody,
} from "@/test/sales-rep-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { update: vi.fn() } },
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn((password: string) =>
    Promise.resolve(`hashed:${password}`),
  ),
  generateTemporaryPassword: vi.fn(() => "generated-temp-password-xyz"),
}));

import { prisma } from "@/lib/prisma";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";
import { POST } from "./route";

const URL = "http://localhost/api/sales-reps/1/password/reset";

function prismaError(code: string) {
  return Object.assign(new Error(code), { code, meta: undefined });
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.update)
    .mockReset()
    .mockResolvedValue({ repId: 1n, empNo: REP.empNo } as never);
  vi.mocked(generateTemporaryPassword).mockClear();
  vi.mocked(hashPassword).mockClear();
});

describe("POST /api/sales-reps/{repId}/password/reset — 재발급 (#44)", () => {
  it("임시 비밀번호를 응답에 1회 담는다", async () => {
    const response = await POST(asAdmin(URL, { method: "POST" }), params("1"));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      repId: 1,
      empNo: REP.empNo,
      temporaryPassword: "generated-temp-password-xyz",
    });
  });

  it("해시만 저장하고 평문은 저장하지 않는다", async () => {
    await POST(asAdmin(URL, { method: "POST" }), params("1"));

    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).toMatchObject({
      passwordHash: "hashed:generated-temp-password-xyz",
    });
    expect(JSON.stringify(data)).not.toContain('"temporaryPassword"');
  });

  it("변경 강제 플래그를 세운다", async () => {
    await POST(asAdmin(URL, { method: "POST" }), params("1"));

    expect(prisma.salesRep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repId: 1n },
        data: expect.objectContaining({ mustChangePassword: true }),
      }),
    );
  });

  it("영업사원이 호출하면 403 이다", async () => {
    const response = await POST(
      asSalesRep(URL, { method: "POST" }),
      params("1"),
    );

    expect(response.status).toBe(403);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
    expect(generateTemporaryPassword).not.toHaveBeenCalled();
  });

  it("없는 사원이면 404 다", async () => {
    vi.mocked(prisma.salesRep.update).mockRejectedValue(prismaError("P2025"));

    expect(
      (await POST(asAdmin(URL, { method: "POST" }), params("99"))).status,
    ).toBe(404);
  });

  it("repId 가 숫자가 아니면 400 이다", async () => {
    const response = await POST(
      asAdmin(URL, { method: "POST" }),
      params("abc"),
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });
});
