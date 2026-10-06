import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT,
  SAVE_BODY,
  SUBMITTED_REPORT,
  asAdmin,
  asManager,
  asOtherManager,
  asOtherRep,
  asSalesRep,
  params,
  readBody,
  withoutAuth,
} from "@/test/report-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    dailyReport: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    visitRecord: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    reportProblem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    reportPlan: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    customer: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, PUT } from "./route";

const URL = "http://localhost/api/reports/10";

beforeEach(() => {
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
  vi.mocked(prisma.dailyReport.findUnique)
    .mockReset()
    .mockResolvedValue(REPORT as never);
  vi.mocked(prisma.dailyReport.findUniqueOrThrow)
    .mockReset()
    .mockResolvedValue(REPORT as never);
  vi.mocked(prisma.dailyReport.updateMany)
    .mockReset()
    .mockResolvedValue({ count: 1 });
  // 보고 10 의 기존 자식 행: visit 100, problem 200, plan 300
  vi.mocked(prisma.visitRecord.findMany)
    .mockReset()
    .mockResolvedValue([{ visitId: 100n }] as never);
  vi.mocked(prisma.reportProblem.findMany)
    .mockReset()
    .mockResolvedValue([{ problemId: 200n }] as never);
  vi.mocked(prisma.reportPlan.findMany)
    .mockReset()
    .mockResolvedValue([{ planId: 300n }] as never);
  for (const model of [
    prisma.visitRecord,
    prisma.reportProblem,
    prisma.reportPlan,
  ]) {
    vi.mocked(model.deleteMany).mockReset().mockResolvedValue({ count: 0 });
    vi.mocked(model.updateMany).mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(model.createMany).mockReset().mockResolvedValue({ count: 1 });
  }
  // 고객 5, 8 이 존재한다.
  vi.mocked(prisma.customer.findMany)
    .mockReset()
    .mockImplementation(((args: { where: { customerId: { in: bigint[] } } }) =>
      Promise.resolve(
        args.where.customerId.in
          .filter((id) => id === 5n || id === 8n)
          .map((customerId) => ({ customerId })),
      )) as never);
});

describe("GET /api/reports/{reportId} — TC-RPT-05, TC-SEC-01", () => {
  it("방문·과제·계획을 포함해 돌려주고 날짜는 하루도 밀리지 않는다", async () => {
    const response = await GET(asSalesRep(URL), params("10"));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      reportId: 10,
      rep: { repId: 1, name: "홍길동" },
      reportDate: "2026-06-20",
      status: "DRAFT",
      submittedAt: null,
      visits: [
        {
          visitId: 100,
          customer: { customerId: 5, customerName: "테스트고객" },
          visitType: "VISIT",
          sortOrder: 1,
        },
      ],
      problems: [
        {
          problemId: 200,
          customer: { customerId: 5, customerName: "테스트고객" },
          status: "OPEN",
        },
      ],
      plans: [{ planId: 300, customer: null, plannedDate: "2026-06-21" }],
    });
  });

  it("작성자의 상급자 판정 정보(managerId)와 고객 연락처는 응답에 없다", async () => {
    const body = await readBody(await GET(asSalesRep(URL), params("10")));
    const text = JSON.stringify(body);

    expect(text).not.toContain("managerId");
    expect(text).not.toContain("email");
    expect(text).not.toContain("phone");
  });

  it("직속 상급자는 팀원의 제출된 보고를 조회한다", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      SUBMITTED_REPORT as never,
    );
    expect((await GET(asManager(URL), params("10"))).status).toBe(200);
  });

  // SCR-300 의 검색 조건에 "작성중" 이 있어 목록에 나온다. 열면 403 이 되는
  // 상태를 만들지 않는다. 제출 여부로 갈리는 것은 댓글이다.
  it("직속 상급자는 작성중인 팀원 보고도 볼 수 있다", async () => {
    expect((await GET(asManager(URL), params("10"))).status).toBe(200);
  });

  it("타인 보고는 403 이다 (IDOR)", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      SUBMITTED_REPORT as never,
    );
    expect((await GET(asOtherRep(URL), params("10"))).status).toBe(403);
    expect((await GET(asOtherManager(URL), params("10"))).status).toBe(403);
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await GET(asSalesRep(URL), params("10"))).status).toBe(404);
  });

  it.each(["abc", "9007199254740993", "0", "-1", "1.5"])(
    "잘못된 식별자 %s 는 400",
    async (id) => {
      expect((await GET(asSalesRep(URL), params(id))).status).toBe(400);
      expect(prisma.dailyReport.findUnique).not.toHaveBeenCalled();
    },
  );

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await GET(asAdmin(URL), params("10"))).status).toBe(403);
    expect((await GET(withoutAuth(URL), params("10"))).status).toBe(401);
    expect(prisma.dailyReport.findUnique).not.toHaveBeenCalled();
  });
});

describe("PUT /api/reports/{reportId}", () => {
  const put = (body: unknown, id = "10") =>
    PUT(asSalesRep(URL, { method: "PUT", body }), params(id));

  it("TC-VST-01·04, TC-PRB-01, TC-PLN-01: 수정과 생성을 한 트랜잭션에서 반영하고 갱신된 상세를 돌려준다", async () => {
    const response = await put(SAVE_BODY);
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ reportId: 10 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // visitId 가 있는 행은 reportId 조건과 함께 수정한다.
    expect(prisma.visitRecord.updateMany).toHaveBeenCalledWith({
      where: { visitId: 100n, reportId: 10n },
      data: expect.objectContaining({ customerId: 5n, content: "신제품 소개" }),
    });
    // 없는 행은 생성한다.
    expect(prisma.visitRecord.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          reportId: 10n,
          customerId: 8n,
          visitType: "CALL",
          sortOrder: 2,
        }),
      ],
    });
    expect(prisma.reportProblem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ reportId: 10n, customerId: 5n })],
    });
    expect(prisma.reportPlan.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          reportId: 10n,
          plannedDate: new Date("2026-06-21T00:00:00.000Z"),
        }),
      ],
    });
  });

  it("보고 행을 DRAFT 조건으로 잠그고 updatedAt 을 올린다", async () => {
    await put(SAVE_BODY);

    expect(prisma.dailyReport.updateMany).toHaveBeenCalledWith({
      where: { reportId: 10n, status: "DRAFT" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("TC-VST-05: 요청에 없는 기존 행은 삭제한다", async () => {
    await put({ ...SAVE_BODY, visits: [SAVE_BODY.visits[0]] });

    expect(prisma.visitRecord.deleteMany).toHaveBeenCalledWith({
      where: { reportId: 10n, visitId: { notIn: [100n] } },
    });
  });

  it("배열을 비우면 그 보고의 해당 행이 모두 지워진다", async () => {
    await put({ visits: [], problems: [], plans: [] });

    expect(prisma.visitRecord.deleteMany).toHaveBeenCalledWith({
      where: { reportId: 10n, visitId: { notIn: [] } },
    });
    expect(prisma.reportProblem.deleteMany).toHaveBeenCalledWith({
      where: { reportId: 10n, problemId: { notIn: [] } },
    });
    // reportId 조건이 빠지면 다른 보고의 계획까지 지운다(#93 뮤테이션 확인에서 통과했다).
    expect(prisma.reportPlan.deleteMany).toHaveBeenCalledWith({
      where: { reportId: 10n, planId: { notIn: [] } },
    });
    expect(prisma.visitRecord.createMany).not.toHaveBeenCalled();
  });

  it("방문 0건 저장은 허용한다", async () => {
    expect((await put({ ...SAVE_BODY, visits: [] })).status).toBe(200);
  });

  it("sortOrder 를 생략하면 요청 순서를 따른다", async () => {
    await put({
      ...SAVE_BODY,
      visits: [
        { customerId: 5, visitType: "VISIT", content: "a" },
        { customerId: 5, visitType: "CALL", content: "b" },
      ],
    });

    const rows = vi.mocked(prisma.visitRecord.createMany).mock.calls[0][0]
      ?.data as { sortOrder: number }[];
    expect(rows.map((row) => row.sortOrder)).toEqual([1, 2]);
  });

  it("방문의 sortOrder 를 모두 보내면 그 값을 저장한다 (생성·수정 모두)", async () => {
    // 과제·계획은 아래 테스트가 보지만 방문은 명시값을 무시해도 통과했다(#93).
    await put({
      visits: [
        { customerId: 5, visitType: "VISIT", content: "a", sortOrder: 5 },
        {
          visitId: 100,
          customerId: 5,
          visitType: "CALL",
          content: "b",
          sortOrder: 8,
        },
      ],
      problems: [],
      plans: [],
    });

    const created = vi.mocked(prisma.visitRecord.createMany).mock.calls[0][0]
      ?.data as { sortOrder: number }[];
    expect(created.map((row) => row.sortOrder)).toEqual([5]);
    expect(prisma.visitRecord.updateMany).toHaveBeenCalledWith({
      where: { visitId: 100n, reportId: 10n },
      data: expect.objectContaining({ sortOrder: 8 }),
    });
  });

  // 이슈 #85. 해당 TC 없음(가장 가까운 것: TC-PRB-01, TC-PLN-01).
  it("과제·계획의 sortOrder 를 모두 생략하면 요청 순서를 저장한다", async () => {
    await put({
      visits: [],
      problems: [{ content: "a" }, { content: "b" }],
      plans: [{ content: "a" }],
    });

    const problems = vi.mocked(prisma.reportProblem.createMany).mock.calls[0][0]
      ?.data as { sortOrder: number }[];
    const plans = vi.mocked(prisma.reportPlan.createMany).mock.calls[0][0]
      ?.data as { sortOrder: number }[];
    expect(problems.map((row) => row.sortOrder)).toEqual([1, 2]);
    expect(plans.map((row) => row.sortOrder)).toEqual([1]);
  });

  it("과제·계획의 sortOrder 를 모두 보내면 그 값을 저장한다", async () => {
    await put({
      visits: [],
      problems: [
        { content: "a", sortOrder: 3 },
        { problemId: 200, content: "c", sortOrder: 7 },
      ],
      plans: [
        { content: "a", sortOrder: 4 },
        { planId: 300, content: "b", sortOrder: 9 },
      ],
    });

    const problems = vi.mocked(prisma.reportProblem.createMany).mock.calls[0][0]
      ?.data as { sortOrder: number }[];
    const plans = vi.mocked(prisma.reportPlan.createMany).mock.calls[0][0]
      ?.data as { sortOrder: number }[];
    expect(problems.map((row) => row.sortOrder)).toEqual([3]);
    expect(plans.map((row) => row.sortOrder)).toEqual([4]);
    expect(prisma.reportProblem.updateMany).toHaveBeenCalledWith({
      where: { problemId: 200n, reportId: 10n },
      data: expect.objectContaining({ sortOrder: 7 }),
    });
    expect(prisma.reportPlan.updateMany).toHaveBeenCalledWith({
      where: { planId: 300n, reportId: 10n },
      data: expect.objectContaining({ sortOrder: 9 }),
    });
  });

  // 일부만 보내면 배열 순서(index + 1)와 명시값이 한 배열에서 섞여 충돌한다.
  it("sortOrder 를 일부 행만 보내면 400 이고 아무것도 쓰지 않는다", async () => {
    const response = await put({
      visits: [],
      problems: [
        { content: "D", sortOrder: 2 },
        { problemId: 200, content: "A" },
      ],
      plans: [],
    });

    expect(response.status).toBe(400);
    expect(prisma.reportProblem.createMany).not.toHaveBeenCalled();
    expect(prisma.reportProblem.updateMany).not.toHaveBeenCalled();
  });

  it("범위를 벗어난 과제 sortOrder 는 400 이고 아무것도 쓰지 않는다", async () => {
    const response = await put({
      visits: [],
      problems: [{ content: "a", sortOrder: 10000 }],
      plans: [],
    });

    expect(response.status).toBe(400);
    expect(prisma.reportProblem.createMany).not.toHaveBeenCalled();
  });

  it("비활성 고객도 참조할 수 있다 (고객 존재만 검증한다)", async () => {
    await put(SAVE_BODY);

    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { customerId: { in: [5n, 8n] } },
      select: { customerId: true },
    });
  });

  it("없는 고객은 400 CUSTOMER_NOT_FOUND 이고 아무것도 쓰지 않는다", async () => {
    const response = await put({
      ...SAVE_BODY,
      problems: [{ customerId: 999, content: "x" }],
    });
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("CUSTOMER_NOT_FOUND");
    expect(prisma.visitRecord.deleteMany).not.toHaveBeenCalled();
    expect(prisma.visitRecord.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["visitId", { visits: [{ ...SAVE_BODY.visits[0], visitId: 999 }] }],
    [
      "problemId",
      { problems: [{ problemId: 999, content: "x", customerId: null }] },
    ],
    ["planId", { plans: [{ planId: 999, content: "x" }] }],
  ])(
    "IDOR: 이 보고의 행이 아닌 %s 를 섞으면 400 이고 아무것도 쓰지 않는다",
    async (_name, override) => {
      const response = await put({ ...SAVE_BODY, ...override });

      expect(response.status).toBe(400);
      expect(prisma.visitRecord.deleteMany).not.toHaveBeenCalled();
      expect(prisma.visitRecord.updateMany).not.toHaveBeenCalled();
      expect(prisma.reportProblem.updateMany).not.toHaveBeenCalled();
      expect(prisma.reportPlan.updateMany).not.toHaveBeenCalled();
    },
  );

  it("TC-VST-02: customerId 누락은 400", async () => {
    const response = await put({
      ...SAVE_BODY,
      visits: [{ visitType: "VISIT", content: "x" }],
    });
    expect(response.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("TC-VST-03: 비정상 visitType 은 400", async () => {
    const response = await put({
      ...SAVE_BODY,
      visits: [{ customerId: 5, visitType: "기타", content: "x" }],
    });
    expect(response.status).toBe(400);
  });

  it("세 배열 중 하나라도 빠지면 400 (생략이 조용히 삭제가 되지 않는다)", async () => {
    expect((await put({ visits: SAVE_BODY.visits, problems: [] })).status).toBe(
      400,
    );
    expect((await put(undefined)).status).toBe(400);
  });

  it("TC-SUB-03: 제출된 보고는 409 REPORT_LOCKED", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      SUBMITTED_REPORT as never,
    );
    const response = await put(SAVE_BODY);
    const body = await readBody(response);

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("REPORT_LOCKED");
    expect(prisma.visitRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("읽은 뒤 동시에 제출되면 잠금 단계에서 409 REPORT_LOCKED", async () => {
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 0 });
    const response = await put(SAVE_BODY);

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("REPORT_LOCKED");
    expect(prisma.visitRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("생성 단계가 실패하면 오류가 트랜잭션 밖으로 전파되어 500 INTERNAL_ERROR 가 된다 (롤백은 통합 테스트가 검증)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.visitRecord.createMany).mockRejectedValue(
      new Error("db down"),
    );

    const response = await put(SAVE_BODY);

    expect(response.status).toBe(500);
    expect((await readBody(response)).error?.code).toBe("INTERNAL_ERROR");
  });

  it("타인 보고는 403 이다. 상급자도 대신 저장할 수 없다 (IDOR)", async () => {
    const other = await PUT(
      asOtherRep(URL, { method: "PUT", body: SAVE_BODY }),
      params("10"),
    );
    const manager = await PUT(
      asManager(URL, { method: "PUT", body: SAVE_BODY }),
      params("10"),
    );

    expect(other.status).toBe(403);
    expect(manager.status).toBe(403);
    expect(prisma.visitRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await put(SAVE_BODY)).status).toBe(404);
  });

  it.each(["abc", "9007199254740993"])(
    "잘못된 식별자 %s 는 400",
    async (id) => {
      expect((await put(SAVE_BODY, id)).status).toBe(400);
    },
  );

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect(
      (
        await PUT(
          asAdmin(URL, { method: "PUT", body: SAVE_BODY }),
          params("10"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await PUT(
          withoutAuth(URL, { method: "PUT", body: SAVE_BODY }),
          params("10"),
        )
      ).status,
    ).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
