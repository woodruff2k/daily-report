import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REP,
  asAdmin,
  asSalesRep,
  readBody,
  withoutAuth,
} from "@/test/sales-rep-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesRep: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn((password: string) => Promise.resolve(`hashed:${password}`)),
}));

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { GET, POST } from "./route";

const URL = "http://localhost/api/sales-reps";

const CREATE_BODY = {
  empNo: "S2026001",
  name: "홍길동",
  email: "hong@example.com",
  department: "영업1팀",
  position: "대리",
  managerId: 2,
  status: "ACTIVE",
};

function prismaError(code: string, target?: string[]) {
  return Object.assign(new Error(code), { code, meta: { target } });
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.findMany).mockReset().mockResolvedValue([REP]);
  vi.mocked(prisma.salesRep.count).mockReset().mockResolvedValue(1);
  vi.mocked(prisma.salesRep.create).mockReset().mockResolvedValue(REP);
  vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(REP);
  vi.mocked(hashPassword).mockClear();
});

describe("GET /api/sales-reps", () => {
  it("관리자는 목록을 조회한다", async () => {
    const response = await GET(asAdmin(URL));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
  });

  it("응답에 비밀번호 해시가 들어가지 않는다", async () => {
    const response = await GET(asAdmin(URL));

    // 응답 전체를 문자열로 훑어 해시가 어디에도 없음을 확인한다. (NFR-04)
    expect(JSON.stringify(await readBody(response))).not.toContain("$2a$");
  });

  it("영업사원이 호출하면 403이다", async () => {
    const response = await GET(asSalesRep(URL));

    expect(response.status).toBe(403);
    expect((await readBody(response)).error?.code).toBe("FORBIDDEN");
    expect(prisma.salesRep.findMany).not.toHaveBeenCalled();
  });

  it("인증 헤더가 없으면 401이다", async () => {
    expect((await GET(withoutAuth(URL))).status).toBe(401);
  });

  it("page·size 를 skip·take 로 넘긴다", async () => {
    await GET(asAdmin(`${URL}?page=2&size=5`));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 })
    );
  });

  it("keyword 로 이름과 사번을 함께 찾는다", async () => {
    await GET(asAdmin(`${URL}?keyword=홍길`));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "홍길", mode: "insensitive" } },
            { empNo: { contains: "홍길", mode: "insensitive" } },
          ],
        },
      })
    );
  });

  it("status 필터를 where 로 넘긴다", async () => {
    await GET(asAdmin(`${URL}?status=INACTIVE`));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "INACTIVE" } })
    );
  });

  it.each(["status=DELETED", "sort=passwordHash,asc", "size=0", "page=-1"])(
    "잘못된 쿼리(%s)는 400이다",
    async (query) => {
      const response = await GET(asAdmin(`${URL}?${query}`));

      expect(response.status).toBe(400);
      expect(prisma.salesRep.findMany).not.toHaveBeenCalled();
    }
  );
});

describe("POST /api/sales-reps — TC-REP-01", () => {
  it("필수 항목을 넘기면 201로 생성한다", async () => {
    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));
    const body = await readBody(response);

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ repId: 1, empNo: "S2026001", status: "ACTIVE" });
  });

  it("응답에 비밀번호 해시가 들어가지 않는다", async () => {
    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(JSON.stringify(await readBody(response))).not.toContain("$2a$");
  });

  it("managerId 를 자기참조 관계로 저장한다 (TC-REP-03)", async () => {
    await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(prisma.salesRep.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ managerId: 2n }),
      })
    );
  });

  it("managerId 가 없으면 상급자 없이 저장한다", async () => {
    const withoutManager = { ...CREATE_BODY, managerId: undefined };
    await POST(asAdmin(URL, { method: "POST", body: withoutManager }));

    expect(prisma.salesRep.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ managerId: null }) })
    );
  });

  it("존재하지 않는 상급자를 지정하면 400이다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("MANAGER_NOT_FOUND");
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });

  it("사번이 중복이면 409다 (TC-REP-02)", async () => {
    vi.mocked(prisma.salesRep.create).mockRejectedValue(prismaError("P2002", ["empNo"]));

    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("DUPLICATE_EMP_NO");
  });

  it("이메일이 중복이면 409다 (TC-REP-02)", async () => {
    vi.mocked(prisma.salesRep.create).mockRejectedValue(prismaError("P2002", ["email"]));

    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("DUPLICATE_EMAIL");
  });

  it("비밀번호를 받으면 해시해서 저장한다", async () => {
    await POST(
      asAdmin(URL, { method: "POST", body: { ...CREATE_BODY, password: "longenough1" } })
    );

    expect(hashPassword).toHaveBeenCalledWith("longenough1");
  });

  it("비밀번호를 생략하면 아무도 모르는 무작위 값으로 채운다", async () => {
    await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    // 고정값을 쓰면 등록된 계정이 모두 같은 비밀번호로 로그인 가능해진다.
    const [generated] = vi.mocked(hashPassword).mock.calls[0];
    expect(generated).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["empNo 누락", { ...CREATE_BODY, empNo: undefined }],
    ["이메일 형식 오류", { ...CREATE_BODY, email: "abc" }],
    ["본문 없음", undefined],
  ])("잘못된 요청(%s)은 400이다", async (_label, body) => {
    const response = await POST(asAdmin(URL, { method: "POST", body }));

    expect(response.status).toBe(400);
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });

  it("영업사원이 호출하면 403이다 (TC-SEC-03)", async () => {
    const response = await POST(asSalesRep(URL, { method: "POST", body: CREATE_BODY }));

    expect(response.status).toBe(403);
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });
});
