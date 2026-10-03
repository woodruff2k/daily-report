import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGER_REP,
  REP,
  asAdmin,
  asSalesRep,
  params,
  readBody,
} from "@/test/sales-rep-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesRep: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, PUT } from "./route";

const URL = "http://localhost/api/sales-reps/1";

const UPDATE_BODY = {
  empNo: "S2026001",
  name: "홍길동",
  email: "hong@example.com",
  department: "영업2팀",
  position: "과장",
  managerId: 2,
  role: "SALES_REP",
  status: "ACTIVE",
};

function prismaError(code: string, target?: string[]) {
  return Object.assign(new Error(code), { code, meta: { target } });
}

beforeEach(() => {
  vi.mocked(prisma.salesRep.findUnique).mockReset().mockResolvedValue(MANAGER_REP);
  vi.mocked(prisma.salesRep.update).mockReset().mockResolvedValue(REP);
});

describe("GET /api/sales-reps/{repId}", () => {
  it("관리자는 상세를 조회한다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(REP);
    const response = await GET(asAdmin(URL), params("1"));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ repId: 1, empNo: "S2026001" });
    expect(prisma.salesRep.findUnique).toHaveBeenCalledWith({ where: { repId: 1n } });
  });

  it("응답에 비밀번호 해시가 들어가지 않는다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(REP);
    const response = await GET(asAdmin(URL), params("1"));

    expect(JSON.stringify(await readBody(response))).not.toContain("$2a$");
  });

  it("없는 사원이면 404다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    const response = await GET(asAdmin(URL), params("99"));

    expect(response.status).toBe(404);
    expect((await readBody(response)).error?.code).toBe("NOT_FOUND");
  });

  it("repId 가 숫자가 아니면 400이다", async () => {
    const response = await GET(asAdmin(URL), params("abc"));

    expect(response.status).toBe(400);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });

  it("영업사원이 호출하면 403이다 (TC-SEC-03)", async () => {
    const response = await GET(asSalesRep(URL), params("1"));

    expect(response.status).toBe(403);
    expect(prisma.salesRep.findUnique).not.toHaveBeenCalled();
  });
});

describe("PUT /api/sales-reps/{repId}", () => {
  it("관리자는 전체 필드를 수정한다", async () => {
    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1")
    );

    expect(response.status).toBe(200);
    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: expect.objectContaining({ department: "영업2팀", managerId: 2n }),
    });
  });

  it("비밀번호는 이 경로로 바뀌지 않는다", async () => {
    await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, password: "longenough1" } }),
      params("1")
    );

    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).not.toHaveProperty("password");
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("자기 자신을 상급자로 지정하면 400이다", async () => {
    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, managerId: 1 } }),
      params("1")
    );

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("SELF_MANAGER");
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("없는 상급자를 지정하면 400이다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1")
    );

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("MANAGER_NOT_FOUND");
  });

  it("대상 사원이 없으면 404다", async () => {
    vi.mocked(prisma.salesRep.update).mockRejectedValue(prismaError("P2025"));

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("99")
    );

    expect(response.status).toBe(404);
  });

  it("이메일이 다른 사원과 겹치면 409다", async () => {
    vi.mocked(prisma.salesRep.update).mockRejectedValue(prismaError("P2002", ["email"]));

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1")
    );

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("DUPLICATE_EMAIL");
  });

  it("필수 항목이 빠지면 400이다", async () => {
    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { name: "홍길동" } }),
      params("1")
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("영업사원이 호출하면 403이다 (TC-SEC-03)", async () => {
    const response = await PUT(
      asSalesRep(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1")
    );

    expect(response.status).toBe(403);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/sales-reps/{repId} — 생략된 필드가 조용히 바뀌지 않는다 (#48)", () => {
  it.each([
    ["role", "역할"],
    ["status", "상태"],
  ])("%s 를 빼면 400 이다", async (field) => {
    const body: Record<string, unknown> = { ...UPDATE_BODY };
    delete body[field];

    const response = await PUT(asAdmin(URL, { method: "PUT", body }), params("1"));

    // 기본값이 적용되면 MANAGER 가 SALES_REP 로 강등되거나
    // 비활성 계정이 다시 활성화된다. 부서명만 고치려던 요청이 권한을 바꾼다.
    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("역할을 명시하면 그 값으로 바꾼다", async () => {
    await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, role: "MANAGER" } }),
      params("1")
    );

    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: expect.objectContaining({ role: "MANAGER" }),
    });
  });
});
