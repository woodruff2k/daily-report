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
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    // 판정과 쓰기를 한 트랜잭션에 묶는다. (#55)
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
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
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
  vi.mocked(prisma.$executeRaw)
    .mockReset()
    .mockResolvedValue(1 as never);
  vi.mocked(prisma.salesRep.count).mockReset().mockResolvedValue(1);
  vi.mocked(prisma.salesRep.findUnique)
    .mockReset()
    .mockResolvedValue(MANAGER_REP);
  vi.mocked(prisma.salesRep.update).mockReset().mockResolvedValue(REP);
});

describe("GET /api/sales-reps/{repId}", () => {
  it("관리자는 상세를 조회한다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(REP);
    const response = await GET(asAdmin(URL), params("1"));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ repId: 1, empNo: "S2026001" });
    expect(prisma.salesRep.findUnique).toHaveBeenCalledWith({
      where: { repId: 1n },
    });
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
      params("1"),
    );

    expect(response.status).toBe(200);
    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: expect.objectContaining({ department: "영업2팀", managerId: 2n }),
    });
  });

  it("비밀번호는 이 경로로 바뀌지 않는다", async () => {
    await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, password: "longenough1" },
      }),
      params("1"),
    );

    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).not.toHaveProperty("password");
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("자기 자신을 상급자로 지정하면 400이다", async () => {
    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, managerId: 1 } }),
      params("1"),
    );

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("SELF_MANAGER");
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("없는 상급자를 지정하면 400이다", async () => {
    // PUT 은 findUnique 를 세 번 쓴다 — 수정 대상, 마지막 관리자 판정,
    // 상급자 조회. 호출 순서에 의존하지 않도록 repId 로 분기한다.
    vi.mocked(prisma.salesRep.findUnique).mockImplementation(((args: {
      where: { repId: bigint };
    }) =>
      Promise.resolve(
        args.where.repId === 2n ? null : { ...MANAGER_REP, managerId: null },
      )) as never);

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1"),
    );

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("MANAGER_NOT_FOUND");
  });

  it("대상 사원이 없으면 404다", async () => {
    vi.mocked(prisma.salesRep.update).mockRejectedValue(prismaError("P2025"));

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("99"),
    );

    expect(response.status).toBe(404);
  });

  it("이메일이 다른 사원과 겹치면 409다", async () => {
    vi.mocked(prisma.salesRep.update).mockRejectedValue(
      prismaError("P2002", ["email"]),
    );

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1"),
    );

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("DUPLICATE_EMAIL");
  });

  it("필수 항목이 빠지면 400이다", async () => {
    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { name: "홍길동" } }),
      params("1"),
    );

    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("영업사원이 호출하면 403이다 (TC-SEC-03)", async () => {
    const response = await PUT(
      asSalesRep(URL, { method: "PUT", body: UPDATE_BODY }),
      params("1"),
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

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body }),
      params("1"),
    );

    // 기본값이 적용되면 MANAGER 가 SALES_REP 로 강등되거나
    // 비활성 계정이 다시 활성화된다. 부서명만 고치려던 요청이 권한을 바꾼다.
    expect(response.status).toBe(400);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("역할을 명시하면 그 값으로 바꾼다", async () => {
    await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, role: "MANAGER" },
      }),
      params("1"),
    );

    expect(prisma.salesRep.update).toHaveBeenCalledWith({
      where: { repId: 1n },
      data: expect.objectContaining({ role: "MANAGER" }),
    });
  });
});

describe("PUT /api/sales-reps/{repId} — 토큰 무효화 (#52)", () => {
  /** 상급자 존재 확인과 현재 상태 조회가 같은 findUnique 를 쓴다. */
  function currentIs(
    role: "SALES_REP" | "MANAGER" | "ADMIN",
    status: "ACTIVE" | "INACTIVE",
  ) {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...MANAGER_REP,
      role,
      status,
    });
  }

  it("역할이 바뀌면 토큰 버전을 올린다", async () => {
    currentIs("MANAGER", "ACTIVE");

    await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, managerId: undefined, role: "SALES_REP" },
      }),
      params("1"),
    );

    // 토큰에 역할이 담겨 있어, 버전을 올리지 않으면 강등된 사람이 만료까지
    // 이전 권한을 그대로 쓴다.
    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).toMatchObject({ tokenVersion: { increment: 1 } });
  });

  it("비활성화하면 토큰 버전을 올린다", async () => {
    currentIs("SALES_REP", "ACTIVE");

    await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, managerId: undefined, status: "INACTIVE" },
      }),
      params("1"),
    );

    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data).toMatchObject({ tokenVersion: { increment: 1 } });
  });

  it("역할·상태가 그대로면 버전을 올리지 않는다", async () => {
    currentIs("SALES_REP", "ACTIVE");

    await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, managerId: undefined },
      }),
      params("1"),
    );

    // 부서명만 고치는 요청이 세션을 끊으면 안 된다.
    const [{ data }] = vi.mocked(prisma.salesRep.update).mock.calls[0];
    expect(data.tokenVersion).toBeUndefined();
  });

  it("대상 사원이 없으면 404 이고 수정하지 않는다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue(null);

    const response = await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, managerId: undefined },
      }),
      params("99"),
    );

    expect(response.status).toBe(404);
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/sales-reps/{repId} — #49 후속 수정", () => {
  it("마지막 활성 관리자를 강등할 수 없다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...MANAGER_REP,
      role: "ADMIN",
      managerId: null,
    });
    vi.mocked(prisma.salesRep.count).mockResolvedValue(0);

    const response = await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, managerId: undefined, role: "SALES_REP" },
      }),
      params("1"),
    );

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("LAST_ACTIVE_ADMIN");
    expect(prisma.salesRep.update).not.toHaveBeenCalled();
  });

  it("상급자가 그대로면 상급자 검증을 다시 하지 않는다", async () => {
    // 상급자가 나중에 비활성화됐어도 이름·부서는 고칠 수 있어야 한다.
    vi.mocked(prisma.salesRep.findUnique).mockResolvedValue({
      ...MANAGER_REP,
      role: "SALES_REP",
      managerId: 2n,
      status: "INACTIVE",
    });

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, managerId: 2 } }),
      params("1"),
    );

    expect(response.status).toBe(200);
  });

  it("상급자를 바꿀 때는 검증한다", async () => {
    vi.mocked(prisma.salesRep.findUnique).mockImplementation(((args: {
      where: { repId: bigint };
    }) =>
      Promise.resolve(
        args.where.repId === 7n
          ? { ...MANAGER_REP, role: "SALES_REP", status: "ACTIVE" }
          : { ...MANAGER_REP, role: "SALES_REP", managerId: 2n },
      )) as never);

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, managerId: 7 } }),
      params("1"),
    );

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe(
      "MANAGER_ROLE_REQUIRED",
    );
  });
});

describe("PUT /api/sales-reps/{repId} — 트랜잭션·잠금 (#55)", () => {
  it("쓰기 전에 잠금을 건다", async () => {
    await PUT(
      asAdmin(URL, {
        method: "PUT",
        body: { ...UPDATE_BODY, managerId: undefined },
      }),
      params("1"),
    );

    const lockOrder = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
    const updateOrder = vi.mocked(prisma.salesRep.update).mock
      .invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(updateOrder);
  });

  it("상급자 검증 실패 시에는 트랜잭션을 열지 않는다", async () => {
    // 체인 추적은 조회가 여러 번이라 잠금 밖에 둔다.
    vi.mocked(prisma.salesRep.findUnique).mockImplementation(((args: {
      where: { repId: bigint };
    }) =>
      Promise.resolve(
        args.where.repId === 7n
          ? { ...MANAGER_REP, role: "SALES_REP" }
          : { ...MANAGER_REP, role: "SALES_REP", managerId: 2n },
      )) as never);

    const response = await PUT(
      asAdmin(URL, { method: "PUT", body: { ...UPDATE_BODY, managerId: 7 } }),
      params("1"),
    );

    expect(response.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
