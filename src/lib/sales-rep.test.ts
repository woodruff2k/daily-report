import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGER_REP, REP } from "@/test/sales-rep-fixtures";

vi.mock("./prisma", () => ({
  prisma: { salesRep: { findUnique: vi.fn(), count: vi.fn() } },
}));

import { prisma } from "./prisma";
import { ConflictError, ValidationError } from "./errors";
import {
  assertManagerAssignable,
  assertNotLastActiveAdmin,
  toSalesRepListItem,
  toSalesRepResponse,
} from "./sales-rep";

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

describe("assertManagerAssignable", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(MANAGER_REP);
  });

  it("역할이 MANAGER 인 사원이면 통과한다", async () => {
    await expect(assertManagerAssignable(2n)).resolves.toBeUndefined();
  });

  it("역할이 MANAGER 가 아니면 400 으로 막는다 (#48)", async () => {
    // managerId 와 role 이 어긋나면 팀 보고 조회·댓글이 전부 403 이 된다.
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(REP);

    await expect(assertManagerAssignable(1n)).rejects.toThrow(ValidationError);
  });

  it("없는 사원이면 400으로 막는다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    await expect(assertManagerAssignable(99n)).rejects.toThrow(ValidationError);
  });

  it("자기 자신을 지정하면 조회 없이 막는다", async () => {
    await expect(assertManagerAssignable(1n, 1n)).rejects.toThrow(ValidationError);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });
});

describe("toSalesRepListItem — NFR-04 목록 최소화 (#49)", () => {
  it("이메일을 내보내지 않는다", () => {
    // SCR-500 의 목록 항목은 사번·이름·부서·직급·상급자·상태다.
    expect(toSalesRepListItem(REP)).not.toHaveProperty("email");
  });

  it("화면이 쓰는 항목만 담는다", () => {
    expect(Object.keys(toSalesRepListItem(REP)).sort()).toEqual([
      "department",
      "empNo",
      "managerId",
      "name",
      "position",
      "repId",
      "role",
      "status",
    ]);
  });

  it("상세 응답에는 이메일이 남아 있다", () => {
    // 상세(SCR-510)는 이메일을 수정 항목으로 쓴다.
    expect(toSalesRepResponse(REP).email).toBe(REP.email);
  });

  it("BigInt 식별자를 숫자로 바꾼다", () => {
    const item = toSalesRepListItem(REP);

    expect(item.repId).toBe(1);
    expect(() => JSON.stringify(item)).not.toThrow();
  });
});

describe("assertManagerAssignable — 상태·순환 (#49)", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(MANAGER_REP);
  });

  it("비활성 사원은 상급자로 지정할 수 없다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...MANAGER_REP,
      status: "INACTIVE",
    });

    // 비활성 상급자는 로그인할 수 없어 그 팀의 보고를 아무도 검토하지 못한다.
    await expect(assertManagerAssignable(2n, 1n)).rejects.toThrow(ValidationError);
  });

  it("간접 순환(A→B→A)을 막는다", async () => {
    // 1번의 상급자를 2번으로 두려는데, 2번의 상급자가 1번이다.
    vi.mocked(prisma.salesRep.findUnique).mockImplementation(((args: {
      where: { repId: bigint };
    }) =>
      Promise.resolve(
        args.where.repId === 2n ? { ...MANAGER_REP, managerId: 1n } : { managerId: null }
      )) as never);

    await expect(assertManagerAssignable(2n, 1n)).rejects.toThrow(ValidationError);
  });

  it("세 단계 순환(A→B→C→A)도 막는다", async () => {
    const chain: Record<string, bigint | null> = { "2": 3n, "3": 1n };
    vi.mocked(prisma.salesRep.findUnique).mockImplementation(((args: {
      where: { repId: bigint };
    }) =>
      Promise.resolve({
        ...MANAGER_REP,
        managerId: chain[args.where.repId.toString()] ?? null,
      })) as never);

    await expect(assertManagerAssignable(2n, 1n)).rejects.toThrow(ValidationError);
  });

  it("순환이 아니면 통과한다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...MANAGER_REP,
      managerId: null,
    });

    await expect(assertManagerAssignable(2n, 1n)).resolves.toBeUndefined();
  });
});

describe("assertNotLastActiveAdmin — 잠금 방지 (#49)", () => {
  const ADMIN_REP = { role: "ADMIN" as const, status: "ACTIVE" as const };

  beforeEach(() => {
    vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(ADMIN_REP as never);
    vi.mocked(prisma.salesRep.count).mockReset().mockResolvedValue(0);
  });

  it("마지막 관리자를 강등하면 409로 막는다", async () => {
    // #52 이후로는 토큰까지 끊겨 되돌릴 방법이 DB 수정뿐이다.
    await expect(assertNotLastActiveAdmin(1n, { role: "SALES_REP" })).rejects.toThrow(
      ConflictError
    );
  });

  it("마지막 관리자를 비활성화하면 409로 막는다", async () => {
    await expect(assertNotLastActiveAdmin(1n, { status: "INACTIVE" })).rejects.toThrow(
      ConflictError
    );
  });

  it("다른 활성 관리자가 있으면 허용한다", async () => {
    vi.mocked(prisma.salesRep.count).mockResolvedValue(1);

    // 관리자가 여럿일 때 교체·정리는 정상 작업이다.
    await expect(
      assertNotLastActiveAdmin(1n, { role: "SALES_REP" })
    ).resolves.toBeUndefined();
  });

  it("관리자가 아닌 사원에는 적용하지 않는다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      role: "SALES_REP",
      status: "ACTIVE",
    } as never);

    await expect(
      assertNotLastActiveAdmin(1n, { status: "INACTIVE" })
    ).resolves.toBeUndefined();
    expect(prisma.salesRep.count).not.toHaveBeenCalled();
  });

  it("관리자 역할·상태를 유지하는 수정은 막지 않는다", async () => {
    await expect(
      assertNotLastActiveAdmin(1n, { role: "ADMIN", status: "ACTIVE" })
    ).resolves.toBeUndefined();
    expect(prisma.salesRep.count).not.toHaveBeenCalled();
  });

  it("다른 활성 관리자 수를 자기 자신을 빼고 센다", async () => {
    vi.mocked(prisma.salesRep.count).mockResolvedValue(1);

    await assertNotLastActiveAdmin(1n, { status: "INACTIVE" });

    expect(prisma.salesRep.count).toHaveBeenCalledWith({
      where: { role: "ADMIN", status: "ACTIVE", repId: { not: 1n } },
    });
  });
});
