// 통합 테스트(실제 PostgreSQL).
// 덮는 TC: TC-CUS-01, TC-CUS-02, TC-CUS-03, TC-SEC-06(목록에 이메일 미포함)
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import {
  createCustomer,
  createRep,
  createTeam,
} from "@/test/integration/factories";
import { call } from "@/test/integration/http";

describe("POST /api/customers (실제 DB)", () => {
  it("TC-CUS-01: 필수 항목으로 고객을 등록하면 201 이고 DB 에 ACTIVE 로 저장된다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/customers", {
      as: rep,
      body: {
        customerName: "테스트고객1",
        companyName: "(주)테스트",
        assignedRepId: Number(rep.repId),
      },
    });

    expect(result.status).toBe(201);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { customerId: BigInt(result.body.data.customerId) },
    });
    expect(row).toMatchObject({
      customerName: "테스트고객1",
      companyName: "(주)테스트",
      assignedRepId: rep.repId,
      status: "ACTIVE",
    });
  });

  it("TC-CUS-02: 이메일 형식 오류는 400 이고 저장되지 않는다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/customers", {
      as: rep,
      body: {
        customerName: "테스트고객1",
        email: "abc",
        assignedRepId: Number(rep.repId),
      },
    });

    expect(result.status).toBe(400);
    expect(await prisma.customer.count()).toBe(0);
  });

  it("존재하지 않는 담당 영업은 FK 오류(500)가 아니라 400 이다", async () => {
    const rep = await createRep();

    const result = await call(POST, "POST", "/api/customers", {
      as: rep,
      body: { customerName: "테스트고객1", assignedRepId: 99999 },
    });

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("ASSIGNED_REP_NOT_FOUND");
  });

  it("ADMIN 은 고객 마스터를 등록할 수 없다(403)", async () => {
    const admin = await createRep({ role: "ADMIN" });

    const result = await call(POST, "POST", "/api/customers", {
      as: admin,
      body: { customerName: "테스트고객1", assignedRepId: Number(admin.repId) },
    });

    expect(result.status).toBe(403);
    expect(await prisma.customer.count()).toBe(0);
  });
});

describe("GET /api/customers (실제 DB)", () => {
  it("TC-CUS-03: keyword 필터는 조건에 맞는 고객만 돌려주고 목록에 이메일·주소를 싣지 않는다", async () => {
    const rep = await createRep();
    const hit = await createCustomer(rep.repId, {
      customerName: "테스트고객가나",
    });
    await createCustomer(rep.repId, { customerName: "다른고객" });

    const result = await call(GET, "GET", "/api/customers", {
      as: rep,
      query: { keyword: "가나" },
    });

    expect(result.status).toBe(200);
    expect(result.body.data.totalElements).toBe(1);
    expect(result.body.data.content[0].customerId).toBe(Number(hit.customerId));
    // 담당 영업 이름과 수정 가능 여부는 JOIN 으로 읽는다. 목의 단위 테스트로는 그 SELECT
    // 가 열을 빠뜨려도 보이지 않는다(#93 뮤테이션 확인).
    expect(result.body.data.content[0]).toMatchObject({
      assignedRepName: rep.name,
      editable: true,
      status: "ACTIVE",
    });
    expect(result.raw).not.toContain(hit.email!);
    expect(result.raw).not.toContain(hit.address!);
  });

  it("editable 은 담당 영업의 직속 상급자에게만 참이고 관계없는 사원에게는 거짓이다 (#68)", async () => {
    // 상급자 판정에는 담당 사원의 managerId 가 필요하다. 목록 쿼리가 그 열을 읽지 않으면
    // 상급자 버튼이 사라진다. 단위 테스트의 목으로는 보이지 않는다(#93 뮤테이션 확인).
    const { manager, member } = await createTeam();
    const stranger = await createRep();
    await createCustomer(member.repId, { customerName: "테스트고객가나" });

    const asManager = await call(GET, "GET", "/api/customers", { as: manager });
    const asStranger = await call(GET, "GET", "/api/customers", {
      as: stranger,
    });
    const asOwner = await call(GET, "GET", "/api/customers", { as: member });

    expect(asManager.body.data.content[0].editable).toBe(true);
    expect(asOwner.body.data.content[0].editable).toBe(true);
    expect(asStranger.body.data.content[0].editable).toBe(false);
  });
});

// 덮는 TC: 없음(동순위 정렬 안정성은 명세에 TC 가 없다). 가장 가까운 것은 TC-CUS-03. (#95)
describe("GET /api/customers — 동순위 쪽 경계 (#95, 실제 DB)", () => {
  it("status 로 정렬하면 전부 동순위여도 모든 쪽을 합쳐 중복·누락이 없고 조회마다 같다", async () => {
    const rep = await createRep();
    const created = [];
    for (let i = 0; i < 40; i++) created.push(await createCustomer(rep.repId));

    // 물리 저장 순서를 식별자 순서에서 떼어 놓는다(UPDATE 는 행을 새 위치에 쓴다).
    for (const row of [...created].reverse().filter((_, i) => i % 2 === 0)) {
      await prisma.customer.update({
        where: { customerId: row.customerId },
        data: { updatedAt: new Date() },
      });
    }

    const fetchAll = async () => {
      const pages: number[][] = [];
      let totalElements = -1;
      for (let page = 0; page < 50; page++) {
        const result = await call(GET, "GET", "/api/customers", {
          as: rep,
          query: { sort: "status,asc", size: "3", page: String(page) },
        });
        expect(result.status).toBe(200);
        totalElements = result.body.data.totalElements;
        const ids = result.body.data.content.map(
          (row: { customerId: number }) => row.customerId,
        );
        if (ids.length === 0) break;
        pages.push(ids);
      }
      return { pages, totalElements };
    };

    const first = await fetchAll();
    const ids = first.pages.flat();
    const expected = created
      .map((c) => Number(c.customerId))
      .sort((a, b) => a - b);

    expect(first.pages.length).toBeGreaterThan(1);
    expect(ids).toHaveLength(first.totalElements);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(expected);
    // 안정성: 같은 조회는 같은 쪽 내용을 돌려준다.
    expect((await fetchAll()).pages).toEqual(first.pages);
  });
});
