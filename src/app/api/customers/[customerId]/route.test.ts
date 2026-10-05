import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_ASSIGNEE,
  CUSTOMER,
  CUSTOMER_BODY,
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
    customer: { findUnique: vi.fn(), update: vi.fn() },
    salesRep: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, PUT } from "./route";

const URL = "http://localhost/api/customers/5";

beforeEach(() => {
  vi.mocked(prisma.customer.findUnique)
    .mockReset()
    .mockResolvedValue(CUSTOMER_WITH_SCOPE);
  vi.mocked(prisma.customer.update).mockReset().mockResolvedValue(CUSTOMER);
  vi.mocked(prisma.salesRep.findUnique)
    .mockReset()
    .mockResolvedValue(ACTIVE_ASSIGNEE as never);
});

describe("GET /api/customers/{customerId}", () => {
  it("상세에는 email 을 포함한다", async () => {
    const response = await GET(asSalesRep(URL), params("5"));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      customerId: 5,
      email: "customer@example.com",
    });
  });

  it("상급자도 조회할 수 있다", async () => {
    expect((await GET(asManager(URL), params("5"))).status).toBe(200);
  });

  it("없는 고객은 404", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);
    expect((await GET(asSalesRep(URL), params("5"))).status).toBe(404);
  });

  it.each(["abc", "9007199254740993", "0", "-1"])(
    "잘못된 식별자 %s 는 400",
    async (id) => {
      expect((await GET(asSalesRep(URL), params(id))).status).toBe(400);
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    },
  );

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await GET(asAdmin(URL), params("5"))).status).toBe(403);
    expect((await GET(withoutAuth(URL), params("5"))).status).toBe(401);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });
});

describe("PUT /api/customers/{customerId}", () => {
  const put = (body: unknown, id = "5") =>
    PUT(asSalesRep(URL, { method: "PUT", body }), params(id));

  it("전체 교체한다. 생략한 선택 항목은 null 로 비워진다", async () => {
    const response = await put({
      customerName: "수정고객",
      assignedRepId: 1,
      status: "ACTIVE",
    });

    expect(response.status).toBe(200);
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { customerId: 5n },
      data: {
        customerName: "수정고객",
        companyName: null,
        phone: null,
        email: null,
        address: null,
        grade: null,
        assignedRepId: 1n,
        status: "ACTIVE",
      },
      include: { assignedRep: { select: { name: true } } },
    });
  });

  it("status 를 생략하면 400 — 비활성 고객이 조용히 활성화되지 않는다", async () => {
    const rest = { ...CUSTOMER_BODY, status: undefined };
    expect((await put(rest)).status).toBe(400);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("담당 영업이 그대로면 담당자 검증을 건너뛴다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      status: "INACTIVE",
    } as never);
    const response = await put(CUSTOMER_BODY);

    expect(response.status).toBe(200);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });

  it("담당 영업이 바뀌면 검증한다 — 비활성이면 400", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      status: "INACTIVE",
    } as never);
    const response = await put({ ...CUSTOMER_BODY, assignedRepId: 3 });

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe(
      "ASSIGNED_REP_INACTIVE",
    );
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("담당 영업이 없는 사원이면 400", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);
    expect((await put({ ...CUSTOMER_BODY, assignedRepId: 3 })).status).toBe(
      400,
    );
  });

  it("없는 고객은 404", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);
    expect((await put(CUSTOMER_BODY)).status).toBe(404);
  });

  it("조회와 수정 사이에 지워졌다면(P2025) 404", async () => {
    vi.mocked(prisma.customer.update).mockRejectedValue(
      Object.assign(new Error("P2025"), { code: "P2025" }),
    );
    expect((await put(CUSTOMER_BODY)).status).toBe(404);
  });

  it("email 형식 오류·잘못된 식별자는 400", async () => {
    expect((await put({ ...CUSTOMER_BODY, email: "abc" })).status).toBe(400);
    expect((await put(CUSTOMER_BODY, "abc")).status).toBe(400);
    expect((await put(CUSTOMER_BODY, "9007199254740993")).status).toBe(400);
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect(
      (
        await PUT(
          asAdmin(URL, { method: "PUT", body: CUSTOMER_BODY }),
          params("5"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await PUT(
          withoutAuth(URL, { method: "PUT", body: CUSTOMER_BODY }),
          params("5"),
        )
      ).status,
    ).toBe(401);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

// TC-SEC-08: 고객 쓰기 범위 (이슈 #68 정책 C)
describe("PUT /api/customers/{customerId} — 쓰기 범위 (TC-SEC-08)", () => {
  const as = (make: typeof asSalesRep, body: unknown = CUSTOMER_BODY) =>
    PUT(make(URL, { method: "PUT", body }), params("5"));

  it("담당 영업 본인은 수정할 수 있다", async () => {
    expect((await as(asSalesRep)).status).toBe(200);
  });

  it("담당 영업의 직속 상급자는 수정할 수 있다", async () => {
    expect((await as(asManager)).status).toBe(200);
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

  it("담당 영업이 null 인 고객은 누구도 수정할 수 없다(403)", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      ...CUSTOMER,
      assignedRepId: null,
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

  it("본문 검증 실패(400)는 DB 조회보다 앞선다", async () => {
    expect((await as(asStranger, {})).status).toBe(400);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it("범위 판정에 담당 사원의 상급자까지 읽는다", async () => {
    await as(asSalesRep);
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { customerId: 5n },
      select: {
        assignedRepId: true,
        assignedRep: { select: { repId: true, managerId: true } },
      },
    });
  });
});

describe("GET /api/customers/{customerId} — 조회는 전사 (TC-SEC-08 회귀)", () => {
  it.each([
    ["무관한 영업사원", asStranger],
    ["다른 팀 상급자", asOtherTeamManager],
  ])("%s 도 200", async (_name, make) => {
    expect((await GET(make(URL), params("5"))).status).toBe(200);
  });
});
