import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER_REP,
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
  generateTemporaryPassword: vi.fn(() => "generated-temp-password-xyz"),
}));

import { prisma } from "@/lib/prisma";
import { generateTemporaryPassword, hashPassword } from "@/lib/password";
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
  vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(MANAGER_REP);
  vi.mocked(hashPassword).mockClear();
  vi.mocked(generateTemporaryPassword).mockClear();
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

  it("목록에 이메일을 담지 않는다 (#49)", async () => {
    const response = await GET(asAdmin(URL));
    const body = await readBody(response);

    // SCR-500 의 목록 항목에 이메일이 없다. 매 건 실어 보낼 이유가 없다. (NFR-04)
    expect(JSON.stringify(body)).not.toContain(REP.email);
    const [first] = (body.data as { content: Record<string, unknown>[] }).content;
    expect(first).not.toHaveProperty("email");
  });

  it("목록에 화면이 쓰는 항목은 담는다", async () => {
    const body = await readBody(await GET(asAdmin(URL)));
    const [first] = (body.data as { content: Record<string, unknown>[] }).content;

    expect(first).toMatchObject({
      repId: 1,
      empNo: REP.empNo,
      name: REP.name,
      department: REP.department,
      position: REP.position,
      status: REP.status,
    });
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
      asAdmin(URL, { method: "POST", body: { ...CREATE_BODY, password: "longenough-123" } })
    );

    expect(hashPassword).toHaveBeenCalledWith("longenough-123");
  });

  it("비밀번호를 생략하면 임시 비밀번호를 만들어 해시한다", async () => {
    await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(generateTemporaryPassword).toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalledWith("generated-temp-password-xyz");
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

describe("POST /api/sales-reps — role 설정 (#48)", () => {
  it("역할을 지정하지 않으면 SALES_REP 로 만든다", async () => {
    await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(prisma.salesRep.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "SALES_REP" }) })
    );
  });

  it.each(["MANAGER", "ADMIN"])("관리자는 %s 계정을 만들 수 있다", async (role) => {
    await POST(asAdmin(URL, { method: "POST", body: { ...CREATE_BODY, role } }));

    expect(prisma.salesRep.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role }) })
    );
  });

  it("정의되지 않은 역할은 400 이다", async () => {
    const response = await POST(
      asAdmin(URL, { method: "POST", body: { ...CREATE_BODY, role: "SUPERUSER" } })
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });

  it("영업사원은 ADMIN 계정을 만들 수 없다 (권한 상승 방어)", async () => {
    const response = await POST(
      asSalesRep(URL, { method: "POST", body: { ...CREATE_BODY, role: "ADMIN" } })
    );

    expect(response.status).toBe(403);
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });

  it("응답에 역할을 담는다", async () => {
    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    // 관리 화면이 역할을 보여줘야 수정할 수 있다.
    expect((await readBody(response)).data).toMatchObject({ role: "SALES_REP" });
  });

  it("상급자의 역할이 MANAGER 가 아니면 400 이다", async () => {
    // managerId 와 role 이 어긋나면 데이터상 상급자인데 권한은 없는 상태가 된다.
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(REP);

    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("MANAGER_ROLE_REQUIRED");
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/sales-reps — 임시 비밀번호 발급 (#44)", () => {
  it("비밀번호를 생략하면 임시 비밀번호를 응답에 1회 담는다", async () => {
    const response = await POST(asAdmin(URL, { method: "POST", body: CREATE_BODY }));

    // 평문은 저장되지 않으므로 이 응답이 유일한 전달 경로다.
    expect((await readBody(response)).data).toMatchObject({
      temporaryPassword: "generated-temp-password-xyz",
    });
  });

  it("비밀번호를 직접 지정하면 임시 비밀번호를 담지 않는다", async () => {
    const response = await POST(
      asAdmin(URL, { method: "POST", body: { ...CREATE_BODY, password: "longenough-123" } })
    );

    expect(await readBody(response).then((b) => b.data)).not.toHaveProperty(
      "temporaryPassword"
    );
    expect(generateTemporaryPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["생략했을 때", CREATE_BODY],
    ["직접 지정했을 때", { ...CREATE_BODY, password: "longenough-123" }],
  ])("비밀번호를 %s 모두 변경을 강제한다", async (_label, body) => {
    // 관리자가 지정한 값도 관리자가 아는 값이다.
    await POST(asAdmin(URL, { method: "POST", body }));

    expect(prisma.salesRep.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: true }) })
    );
  });

  it("12자 미만 비밀번호는 400 이다", async () => {
    const response = await POST(
      asAdmin(URL, { method: "POST", body: { ...CREATE_BODY, password: "short-11ch" } })
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.create).not.toHaveBeenCalled();
  });
});
