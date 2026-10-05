import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_WITH_REP } from "@/test/customer-fixtures";
import type { AuthContext } from "./auth";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import {
  assertAssignedRepValid,
  assertCustomerWritable,
  toCustomerListItem,
  toCustomerResponse,
} from "./customer";
import { buildCustomerWhere, parseCustomerIdParam } from "./customer-query";

const owner: AuthContext = { repId: 1n, role: "SALES_REP" };
const directManager: AuthContext = { repId: 2n, role: "MANAGER" };
const stranger: AuthContext = { repId: 7n, role: "SALES_REP" };

describe("toCustomerListItem", () => {
  it("phone 은 담고 email·address 는 담지 않는다 (NFR-04)", () => {
    const item = toCustomerListItem(CUSTOMER_WITH_REP, owner);

    expect(item).toMatchObject({
      customerId: 5,
      phone: "02-000-0000",
      assignedRepId: 1,
      assignedRepName: "홍길동",
    });
    expect(item).not.toHaveProperty("email");
    expect(item).not.toHaveProperty("address");
    expect(item).not.toHaveProperty("assignedRep");
    expect(JSON.stringify(item)).not.toContain("customer@example.com");
  });

  // editable 은 화면이 버튼을 가리는 힌트다. 접근통제가 아니라 서버가 PUT·PATCH
  // 에서 다시 막는다. 화면이 같은 판정을 다시 구현할 수 없는 이유는 목록 응답에
  // 담당 사원의 managerId 가 없기 때문이다(담으면 조직 구조가 샌다).
  it("editable 이 쓰기 범위와 같다 (#68)", () => {
    expect(toCustomerListItem(CUSTOMER_WITH_REP, owner).editable).toBe(true);
    expect(toCustomerListItem(CUSTOMER_WITH_REP, directManager).editable).toBe(
      true,
    );
    expect(toCustomerListItem(CUSTOMER_WITH_REP, stranger).editable).toBe(
      false,
    );
  });

  it("editable 을 계산하는 데 쓴 담당자 식별자는 응답에 남지 않는다", () => {
    const item = toCustomerListItem(CUSTOMER_WITH_REP, owner);
    expect(item).not.toHaveProperty("assignedRep");
    expect(JSON.stringify(item)).not.toContain("managerId");
  });
});

describe("toCustomerResponse", () => {
  it("식별자를 JSON 숫자로, 일시를 ISO 문자열로 바꾼다", () => {
    const body = toCustomerResponse(CUSTOMER_WITH_REP);

    expect(body.customerId).toBe(5);
    expect(body.email).toBe("customer@example.com");
    expect(body.createdAt).toBe("2026-06-20T09:00:00.000Z");
  });

  // 수정 화면(SCR-410)의 담당 영업 Select 는 활성 사원만 받는다. 기존 담당자가
  // 비활성화되면 그 값이 목록에 없어 빈칸으로 보이므로, 이름으로 현재 담당자를
  // 표시할 수 있어야 한다.
  it("담당 영업 이름을 담는다", () => {
    expect(toCustomerResponse(CUSTOMER_WITH_REP).assignedRepName).toBe(
      "홍길동",
    );
  });

  it("담당 영업이 없으면 이름도 null 이다", () => {
    const body = toCustomerResponse({
      ...CUSTOMER_WITH_REP,
      assignedRep: null,
    });
    expect(body.assignedRepName).toBeNull();
  });
});

describe("assertAssignedRepValid", () => {
  beforeEach(() => vi.mocked(prisma.salesRep.findUnique).mockReset());

  it("활성 사원이면 통과한다 (역할은 묻지 않는다)", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      status: "ACTIVE",
    } as never);
    await expect(assertAssignedRepValid(1n)).resolves.toBeUndefined();
  });

  it("없으면 400 ASSIGNED_REP_NOT_FOUND", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);
    await expect(assertAssignedRepValid(1n)).rejects.toMatchObject({
      status: 400,
      code: "ASSIGNED_REP_NOT_FOUND",
    });
  });

  it("비활성이면 400 ASSIGNED_REP_INACTIVE", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      status: "INACTIVE",
    } as never);
    await expect(assertAssignedRepValid(1n)).rejects.toMatchObject({
      status: 400,
      code: "ASSIGNED_REP_INACTIVE",
    });
  });
});

describe("buildCustomerWhere", () => {
  it("keyword 는 고객명·회사명을 함께 본다", () => {
    const where = buildCustomerWhere(new URLSearchParams("keyword=가상"));
    expect(where.OR).toHaveLength(2);
  });

  it("assignedRepId·grade·status 를 조건으로 옮긴다", () => {
    const where = buildCustomerWhere(
      new URLSearchParams("assignedRepId=3&grade=A&status=INACTIVE"),
    );
    expect(where).toMatchObject({
      assignedRepId: 3n,
      grade: "A",
      status: "INACTIVE",
    });
  });

  it.each(["status=X", "assignedRepId=abc", "assignedRepId=9007199254740993"])(
    "%s 는 400",
    (query) => {
      expect(() => buildCustomerWhere(new URLSearchParams(query))).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    },
  );
});

describe("parseCustomerIdParam", () => {
  it.each(["abc", "-1", "1.5", "0", "9007199254740993", ""])(
    "%j 는 400",
    (raw) => {
      expect(() => parseCustomerIdParam(raw)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    },
  );

  it("정상 값은 BigInt 로 바꾼다", () => {
    expect(parseCustomerIdParam("5")).toBe(5n);
  });
});

describe("TC-CUS-05 비활성 고객의 과거 참조 유지 (스키마 수준)", () => {
  // 방문기록 API(#7)가 아직 없고 단위 테스트는 DB 를 쓰지 않는다. 그래서 실제
  // 조회 대신, 비활성화가 참조를 끊을 수 없는 구조인지를 스키마로 확인한다.
  it("Customer.visits 관계가 있고 삭제 시 연쇄 삭제가 걸려 있지 않다", async () => {
    const { Prisma } =
      await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
    const customer = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "Customer",
    );
    const visits = customer?.fields.find((field) => field.name === "visits");
    const visitRecord = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "VisitRecord",
    );
    const back = visitRecord?.fields.find((field) => field.name === "customer");

    expect(visits?.kind).toBe("object");
    expect(back?.relationOnDelete).not.toBe("Cascade");
  });
});

// TC-SEC-08: 쓰기 범위 판정 (이슈 #68 정책 C)
describe("assertCustomerWritable", () => {
  const customer = { assignedRep: { repId: 10n, managerId: 20n } };
  const rep = (repId: bigint) => ({ repId, role: "SALES_REP" as const });
  const manager = (repId: bigint) => ({ repId, role: "MANAGER" as const });
  const admin = { repId: 9n, role: "ADMIN" as const };

  it("담당 영업 본인과 직속 상급자는 통과한다", () => {
    expect(() => assertCustomerWritable(rep(10n), customer)).not.toThrow();
    expect(() => assertCustomerWritable(manager(20n), customer)).not.toThrow();
  });

  it.each([
    ["무관한 영업사원", rep(11n)],
    ["다른 팀 상급자", manager(21n)],
    ["상급자 id 와 같아도 역할이 MANAGER 가 아니면", rep(20n)],
    ["ADMIN", admin],
  ])("%s 는 403", (_name, auth) => {
    expect(() => assertCustomerWritable(auth, customer)).toThrow(
      expect.objectContaining({
        status: 403,
        code: "CUSTOMER_WRITE_FORBIDDEN",
      }),
    );
  });

  it("상급자의 상급자(손자 팀원 관계)는 통과하지 못한다 — 직속만", () => {
    expect(() => assertCustomerWritable(manager(30n), customer)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("담당 영업이 null 이면 누구도 통과하지 못한다", () => {
    for (const auth of [rep(10n), manager(20n), admin]) {
      expect(() => assertCustomerWritable(auth, { assignedRep: null })).toThrow(
        expect.objectContaining({ status: 403 }),
      );
    }
  });

  it("담당 사원에게 상급자가 없으면 MANAGER 도 통과하지 못한다", () => {
    expect(() =>
      assertCustomerWritable(manager(20n), {
        assignedRep: { repId: 10n, managerId: null },
      }),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});
