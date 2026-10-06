// 통합 테스트(실제 PostgreSQL). 유니크 제약 위반(P2002)이 실제 DB 에서 409 로 매핑되는지 본다.
// 덮는 TC: TC-REP-01, TC-REP-02, TC-REP-03, TC-SEC-03, TC-SEC-06(응답에 해시 미포함)
import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { prisma } from "@/lib/prisma";
import { TEST_PASSWORD, createRep } from "@/test/integration/factories";
import { call } from "@/test/integration/http";

const validBody = {
  empNo: "T0100",
  name: "테스트사원Z",
  email: "test-z@example.com",
  password: TEST_PASSWORD,
};

describe("POST /api/sales-reps (실제 DB)", () => {
  it("TC-REP-01: 관리자가 등록하면 201 이고 해시만 저장되며 응답에 해시가 없다", async () => {
    const admin = await createRep({ role: "ADMIN" });

    const result = await call(POST, "POST", "/api/sales-reps", {
      as: admin,
      body: validBody,
    });

    expect(result.status).toBe(201);
    const row = await prisma.salesRep.findUniqueOrThrow({
      where: { repId: BigInt(result.body.data.repId) },
    });
    expect(row).toMatchObject({
      empNo: "T0100",
      role: "SALES_REP",
      status: "ACTIVE",
      mustChangePassword: true,
    });
    expect(row.passwordHash).not.toBe(TEST_PASSWORD);
    expect(result.raw).not.toContain(row.passwordHash);
  });

  it("TC-REP-02: 같은 사번이면 409 이고 행이 늘지 않는다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    await createRep({ empNo: "T0100" });

    const result = await call(POST, "POST", "/api/sales-reps", {
      as: admin,
      body: validBody,
    });

    expect(result.status).toBe(409);
    expect(await prisma.salesRep.count({ where: { empNo: "T0100" } })).toBe(1);
  });

  // Prisma 는 P2002 의 meta.target 을 컬럼명(`emp_no`)으로 준다. 필드명만
  // 비교하던 구현이 사번 중복을 DUPLICATE_VALUE 로 떨어뜨렸고, 이 테스트가
  // 그것을 잡았다(#19). 지금은 통과한다 — 회귀 방지로 남긴다.
  it("TC-REP-02: 같은 사번의 오류 코드는 DUPLICATE_EMP_NO 이다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    await createRep({ empNo: "T0100" });

    const result = await call(POST, "POST", "/api/sales-reps", {
      as: admin,
      body: validBody,
    });

    expect(result.body.error.code).toBe("DUPLICATE_EMP_NO");
  });

  it("TC-REP-02: 같은 이메일이면 409 DUPLICATE_EMAIL 이다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    await createRep({ email: "test-z@example.com" });

    const result = await call(POST, "POST", "/api/sales-reps", {
      as: admin,
      body: validBody,
    });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("TC-REP-02: 같은 사번을 동시에 등록하면 하나는 201, 하나는 409 이고 행은 1건이다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const create = (email: string) =>
      call(POST, "POST", "/api/sales-reps", {
        as: admin,
        body: { ...validBody, email },
      });

    const results = await Promise.all([
      create("test-y1@example.com"),
      create("test-y2@example.com"),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.salesRep.count({ where: { empNo: "T0100" } })).toBe(1);
  });

  it("TC-REP-03: managerId 를 주면 자기참조 상급자 관계가 저장된다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const manager = await createRep({ role: "MANAGER" });

    const result = await call(POST, "POST", "/api/sales-reps", {
      as: admin,
      body: { ...validBody, managerId: Number(manager.repId) },
    });

    expect(result.status).toBe(201);
    const row = await prisma.salesRep.findUniqueOrThrow({
      where: { repId: BigInt(result.body.data.repId) },
    });
    expect(row.managerId).toBe(manager.repId);
  });

  it.each(["SALES_REP", "MANAGER"] as const)(
    "TC-SEC-03: %s 는 영업 마스터를 등록할 수 없고(403) 행이 생기지 않는다",
    async (role) => {
      const caller = await createRep({ role });

      const result = await call(POST, "POST", "/api/sales-reps", {
        as: caller,
        body: validBody,
      });

      expect(result.status).toBe(403);
      expect(await prisma.salesRep.count()).toBe(1);
    },
  );

  it("TC-SEC-03: 인증 헤더가 없으면 401 이다", async () => {
    const result = await call(POST, "POST", "/api/sales-reps", {
      body: validBody,
    });

    expect(result.status).toBe(401);
  });
});

describe("GET /api/sales-reps (실제 DB)", () => {
  it("TC-SEC-03: 영업사원의 목록 조회는 403 이다", async () => {
    const rep = await createRep();

    const result = await call(GET, "GET", "/api/sales-reps", { as: rep });

    expect(result.status).toBe(403);
  });

  it("TC-SEC-06: 관리자 목록 응답에 이메일·해시가 실리지 않는다", async () => {
    const admin = await createRep({ role: "ADMIN" });

    const result = await call(GET, "GET", "/api/sales-reps", { as: admin });

    expect(result.status).toBe(200);
    expect(result.raw).toContain(admin.empNo);
    expect(result.raw).not.toContain(admin.email);
    expect(result.raw).not.toContain(admin.passwordHash);
  });
});

// 덮는 TC: 없음(동순위 정렬 안정성은 명세에 TC 가 없다). 가장 가까운 것은 TC-REP-01. (#95)
describe("GET /api/sales-reps — 동순위 쪽 경계 (#95, 실제 DB)", () => {
  it("status 로 정렬하면 전부 동순위여도 모든 쪽을 합쳐 중복·누락이 없고 조회마다 같다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const created = [admin];
    for (let i = 0; i < 39; i++) created.push(await createRep());

    // 물리 저장 순서를 식별자 순서에서 떼어 놓는다(UPDATE 는 행을 새 위치에 쓴다).
    for (const row of [...created].reverse().filter((_, i) => i % 2 === 0)) {
      await prisma.salesRep.update({
        where: { repId: row.repId },
        data: { updatedAt: new Date() },
      });
    }

    const fetchAll = async () => {
      const pages: number[][] = [];
      let totalElements = -1;
      for (let page = 0; page < 50; page++) {
        const result = await call(GET, "GET", "/api/sales-reps", {
          as: admin,
          query: { sort: "status,asc", size: "3", page: String(page) },
        });
        expect(result.status).toBe(200);
        totalElements = result.body.data.totalElements;
        const ids = result.body.data.content.map(
          (row: { repId: number }) => row.repId,
        );
        if (ids.length === 0) break;
        pages.push(ids);
      }
      return { pages, totalElements };
    };

    const first = await fetchAll();
    const ids = first.pages.flat();
    const expected = created.map((r) => Number(r.repId)).sort((a, b) => a - b);

    expect(first.pages.length).toBeGreaterThan(1);
    expect(ids).toHaveLength(first.totalElements);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(expected);
    // 안정성: 같은 조회는 같은 쪽 내용을 돌려준다.
    expect((await fetchAll()).pages).toEqual(first.pages);
  });
});
