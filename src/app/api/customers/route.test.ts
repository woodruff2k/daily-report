import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_ASSIGNEE,
  CUSTOMER,
  CUSTOMER_BODY,
  CUSTOMER_WITH_REP,
  asAdmin,
  asManager,
  asSalesRep,
  readBody,
  withoutAuth,
} from "@/test/customer-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    salesRep: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";

const URL = "http://localhost/api/customers";

beforeEach(() => {
  vi.mocked(prisma.customer.findMany)
    .mockReset()
    .mockResolvedValue([CUSTOMER_WITH_REP] as never);
  vi.mocked(prisma.customer.count).mockReset().mockResolvedValue(1);
  vi.mocked(prisma.customer.create).mockReset().mockResolvedValue(CUSTOMER);
  vi.mocked(prisma.salesRep.findUnique)
    .mockReset()
    .mockResolvedValue(ACTIVE_ASSIGNEE as never);
});

describe("GET /api/customers — TC-CUS-03", () => {
  it("영업사원·상급자 모두 조회할 수 있다", async () => {
    expect((await GET(asSalesRep(URL))).status).toBe(200);
    expect((await GET(asManager(URL))).status).toBe(200);
  });

  it("목록에 phone 은 있고 email·address 는 없다 (NFR-04, TC-SEC-06)", async () => {
    const body = await readBody(await GET(asSalesRep(URL)));
    const content = (body.data as { content: Record<string, unknown>[] })
      .content;

    expect(content[0]).toMatchObject({
      customerId: 5,
      phone: "02-000-0000",
      assignedRepName: "홍길동",
    });
    expect(content[0]).not.toHaveProperty("email");
    expect(content[0]).not.toHaveProperty("address");
    expect(JSON.stringify(body)).not.toContain("customer@example.com");
  });

  it("keyword·grade 필터를 조회 조건으로 넘긴다", async () => {
    await GET(asSalesRep(`${URL}?keyword=가상&grade=A&status=ACTIVE`));

    const args = vi.mocked(prisma.customer.findMany).mock.calls[0][0];
    expect(args?.where).toMatchObject({ grade: "A", status: "ACTIVE" });
    expect(args?.where?.OR).toHaveLength(2);
    expect(prisma.customer.count).toHaveBeenCalledWith({ where: args?.where });
  });

  it("페이지네이션 응답 구조를 따른다", async () => {
    const body = await readBody(await GET(asSalesRep(`${URL}?page=0&size=5`)));
    expect(body.data).toMatchObject({
      page: 0,
      size: 5,
      totalElements: 1,
      totalPages: 1,
    });
  });

  it.each(["status=X", "assignedRepId=abc", "sort=password,asc", "size=abc"])(
    "%s 는 400",
    async (query) => {
      expect((await GET(asSalesRep(`${URL}?${query}`))).status).toBe(400);
    },
  );

  it("ADMIN 은 403 (TC-SEC-03)", async () => {
    const response = await GET(asAdmin(URL));
    expect(response.status).toBe(403);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it("인증이 없으면 401 (TC-AUTH-04)", async () => {
    expect((await GET(withoutAuth(URL))).status).toBe(401);
  });
});

describe("POST /api/customers — TC-CUS-01·02", () => {
  it("201 로 생성하고 담당 영업을 검증한다", async () => {
    const response = await POST(
      asSalesRep(URL, { method: "POST", body: CUSTOMER_BODY }),
    );
    const body = await readBody(response);

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ customerId: 5, status: "ACTIVE" });
    expect(prisma.salesRep.findUnique).toHaveBeenCalled();
    expect(
      vi.mocked(prisma.customer.create).mock.calls[0][0].data,
    ).toMatchObject({ assignedRepId: 1n, customerName: "테스트고객" });
  });

  it("상급자도 등록할 수 있다", async () => {
    const response = await POST(
      asManager(URL, { method: "POST", body: CUSTOMER_BODY }),
    );
    expect(response.status).toBe(201);
  });

  it("필수 항목만으로 등록되고 선택 항목은 null 이다", async () => {
    await POST(
      asSalesRep(URL, {
        method: "POST",
        body: { customerName: "최소고객", assignedRepId: 1 },
      }),
    );
    expect(
      vi.mocked(prisma.customer.create).mock.calls[0][0].data,
    ).toMatchObject({ email: null, phone: null, status: "ACTIVE" });
  });

  it("email 형식 오류는 400 (TC-CUS-02)", async () => {
    const response = await POST(
      asSalesRep(URL, {
        method: "POST",
        body: { ...CUSTOMER_BODY, email: "abc" },
      }),
    );
    expect(response.status).toBe(400);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("assignedRepId 가 없으면 400", async () => {
    const rest = { ...CUSTOMER_BODY, assignedRepId: undefined };
    const response = await POST(
      asSalesRep(URL, { method: "POST", body: rest }),
    );
    expect(response.status).toBe(400);
  });

  it("안전 정수를 넘는 assignedRepId 는 400", async () => {
    const response = await POST(
      asSalesRep(URL, {
        method: "POST",
        body: { ...CUSTOMER_BODY, assignedRepId: 2 ** 53 },
      }),
    );
    expect(response.status).toBe(400);
  });

  it.each([
    ["과대 길이 주소(501자)", { address: "a".repeat(501) }],
    ["고객명 NUL", { customerName: "a\u0000b" }],
    ["enum 밖 status", { status: "DELETED" }],
  ])("TC-SEC-05: %s 는 400 이고 스택이 실리지 않는다", async (_n, patch) => {
    const response = await POST(
      asSalesRep(URL, { method: "POST", body: { ...CUSTOMER_BODY, ...patch } }),
    );
    const raw = await response.text();

    expect(response.status).toBe(400);
    expect(raw).toContain("INVALID_REQUEST");
    expect(raw).not.toMatch(/stack|\bat .*\(/);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("본문이 JSON 이 아니면 400", async () => {
    const request = asSalesRep(URL, { method: "POST" });
    expect((await POST(request)).status).toBe(400);
  });

  it("없는 담당 영업은 400 ASSIGNED_REP_NOT_FOUND", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);
    const response = await POST(
      asSalesRep(URL, { method: "POST", body: CUSTOMER_BODY }),
    );
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("ASSIGNED_REP_NOT_FOUND");
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("비활성 담당 영업은 400 ASSIGNED_REP_INACTIVE", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      status: "INACTIVE",
    } as never);
    const response = await POST(
      asSalesRep(URL, { method: "POST", body: CUSTOMER_BODY }),
    );
    expect((await readBody(response)).error?.code).toBe(
      "ASSIGNED_REP_INACTIVE",
    );
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect(
      (await POST(asAdmin(URL, { method: "POST", body: CUSTOMER_BODY })))
        .status,
    ).toBe(403);
    expect(
      (await POST(withoutAuth(URL, { method: "POST", body: CUSTOMER_BODY })))
        .status,
    ).toBe(401);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});

// 덮는 TC: 없음(동순위 정렬은 명세에 TC 가 없다). 가장 가까운 것은 TC-CUS-03. (#95)
describe("GET /api/customers — 동순위 보조 정렬 (#95)", () => {
  it.each(["", "?sort=status,asc", "?sort=status,desc"])(
    "쿼리 %s 와 무관하게 customerId desc 를 마지막 보조 키로 붙인다",
    async (query) => {
      await GET(asSalesRep(`${URL}${query}`));

      const args = vi.mocked(prisma.customer.findMany).mock.calls[0][0];
      const orderBy = args?.orderBy as Record<string, string>[];
      expect(orderBy).toHaveLength(2);
      expect(orderBy[1]).toEqual({ customerId: "desc" });
    },
  );
});
