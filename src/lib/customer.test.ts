import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_WITH_REP } from "@/test/customer-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: { salesRep: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import {
  assertAssignedRepValid,
  toCustomerListItem,
  toCustomerResponse,
} from "./customer";
import { buildCustomerWhere, parseCustomerIdParam } from "./customer-query";

describe("toCustomerListItem", () => {
  it("phone 은 담고 email·address 는 담지 않는다 (NFR-04)", () => {
    const item = toCustomerListItem(CUSTOMER_WITH_REP);

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
