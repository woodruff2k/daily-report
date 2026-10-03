import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGER_REP, REP } from "@/test/sales-rep-fixtures";

vi.mock("./prisma", () => ({
  prisma: { salesRep: { findUnique: vi.fn() } },
}));

import { prisma } from "./prisma";
import { ValidationError } from "./errors";
import { assertManagerExists, toSalesRepResponse } from "./sales-rep";

describe("toSalesRepResponse — NFR-04", () => {
  it("비밀번호 해시를 내보내지 않는다", () => {
    const response = toSalesRepResponse(REP);

    expect(response).not.toHaveProperty("passwordHash");
    expect(Object.keys(response).sort()).toEqual([
      "createdAt",
      "department",
      "email",
      "empNo",
      "managerId",
      "name",
      "position",
      "repId",
      "role",
      "status",
      "updatedAt",
    ]);
  });

  it("BigInt 식별자를 숫자로 바꾼다", () => {
    const response = toSalesRepResponse(REP);

    expect(response.repId).toBe(1);
    expect(response.managerId).toBe(2);
    // BigInt 가 남아 있으면 JSON.stringify 가 그대로 던진다.
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it("상급자가 없으면 managerId 는 null 이다", () => {
    expect(toSalesRepResponse({ ...REP, managerId: null }).managerId).toBeNull();
  });

  it("일시를 ISO 8601 문자열로 바꾼다", () => {
    expect(toSalesRepResponse(REP).createdAt).toBe("2026-06-20T09:00:00.000Z");
  });

  it("role 을 내보낸다 (#48)", () => {
    // 관리자가 역할을 확인하고 수정할 수 있어야 SCR-500·510 이 성립한다.
    expect(toSalesRepResponse(REP).role).toBe("SALES_REP");
  });
});

describe("assertManagerExists", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(MANAGER_REP);
  });

  it("역할이 MANAGER 인 사원이면 통과한다", async () => {
    await expect(assertManagerExists(2n)).resolves.toBeUndefined();
  });

  it("역할이 MANAGER 가 아니면 400 으로 막는다 (#48)", async () => {
    // managerId 와 role 이 어긋나면 팀 보고 조회·댓글이 전부 403 이 된다.
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(REP);

    await expect(assertManagerExists(1n)).rejects.toThrow(ValidationError);
  });

  it("없는 사원이면 400으로 막는다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    await expect(assertManagerExists(99n)).rejects.toThrow(ValidationError);
  });

  it("자기 자신을 지정하면 조회 없이 막는다", async () => {
    await expect(assertManagerExists(1n, 1n)).rejects.toThrow(ValidationError);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });
});
