import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEAM_REPORT_LIST_RECORD,
  asAdmin,
  asManager,
  asSalesRep,
  readBody,
  withoutAuth,
} from "@/test/report-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salesRep: { findMany: vi.fn() },
    dailyReport: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const URL = "http://localhost/api/reports/team";

/** 2번 상급자의 직속 팀원은 1번과 5번이다. */
beforeEach(() => {
  vi.mocked(prisma.salesRep.findMany)
    .mockReset()
    .mockResolvedValue([{ repId: 1n }, { repId: 5n }] as never);
  vi.mocked(prisma.dailyReport.findMany)
    .mockReset()
    .mockResolvedValue([TEAM_REPORT_LIST_RECORD] as never);
  vi.mocked(prisma.dailyReport.count).mockReset().mockResolvedValue(1);
});

function lastWhere() {
  return vi.mocked(prisma.dailyReport.findMany).mock.calls[0][0]?.where;
}

describe("GET /api/reports/team — 정상 경로", () => {
  it("직속 팀원의 보고를 작성자와 함께 돌려준다", async () => {
    const response = await GET(asManager(URL));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
    expect((body.data as { content: unknown[] }).content[0]).toEqual({
      reportId: 10,
      rep: { repId: 1, name: "홍길동" },
      reportDate: "2026-06-20",
      visitCount: 3,
      status: "SUBMITTED",
      commentCount: 2,
      updatedAt: "2026-06-20T09:10:00.000Z",
    });
  });

  it("팀원은 호출자의 직속 부하로만 구한다", async () => {
    await GET(asManager(URL));

    expect(prisma.salesRep.findMany).toHaveBeenCalledWith({
      where: { managerId: 2n },
      select: { repId: true },
    });
  });

  it("repIds 미지정이면 전체 소속 팀원이 조회 범위다", async () => {
    await GET(asManager(URL));
    expect(lastWhere()).toEqual({ repId: { in: [1n, 5n] } });
  });

  it("repIds 를 반복 형식과 콤마 형식 모두 받는다", async () => {
    await GET(asManager(`${URL}?repIds=1&repIds=5`));
    expect(lastWhere()).toEqual({ repId: { in: [1n, 5n] } });

    vi.mocked(prisma.dailyReport.findMany).mockClear();
    await GET(asManager(`${URL}?repIds=5,1`));
    expect(lastWhere()).toEqual({ repId: { in: [5n, 1n] } });
  });

  it("기간·상태·고객 필터를 조회 조건으로 넘긴다 (TC-RPT-03·04)", async () => {
    await GET(
      asManager(
        `${URL}?repIds=1&fromDate=2026-06-01&toDate=2026-06-30&status=DRAFT&customerId=7`,
      ),
    );

    expect(lastWhere()).toEqual({
      repId: { in: [1n] },
      reportDate: {
        gte: new Date("2026-06-01T00:00:00.000Z"),
        lte: new Date("2026-06-30T00:00:00.000Z"),
      },
      status: "DRAFT",
      visits: { some: { customerId: 7n } },
    });
    expect(prisma.dailyReport.count).toHaveBeenCalledWith({
      where: lastWhere(),
    });
  });

  it("건수·작성자는 한 쿼리로 읽고 작성자 필드는 repId·name 뿐이다", async () => {
    await GET(asManager(URL));

    const args = vi.mocked(prisma.dailyReport.findMany).mock.calls[0][0];
    expect(args?.select?._count).toEqual({
      select: { visits: true, comments: true },
    });
    expect(args?.select?.rep).toEqual({
      select: { repId: true, name: true },
    });
    expect(prisma.dailyReport.findMany).toHaveBeenCalledTimes(1);
  });

  it("기본 정렬은 reportDate desc 이고 동순위는 reportId 로 안정화한다", async () => {
    await GET(asManager(URL));
    expect(
      vi.mocked(prisma.dailyReport.findMany).mock.calls[0][0]?.orderBy,
    ).toEqual([{ reportDate: "desc" }, { reportId: "desc" }]);
  });

  it("응답에 이메일·사번이 없다 (TC-SEC-06)", async () => {
    vi.mocked(prisma.dailyReport.findMany).mockResolvedValue([
      {
        ...TEAM_REPORT_LIST_RECORD,
        rep: {
          ...TEAM_REPORT_LIST_RECORD.rep,
          email: "x@example.test",
          empNo: "S0001",
        },
      },
    ] as never);

    const text = await (await GET(asManager(URL))).text();
    expect(text).not.toContain("email");
    expect(text).not.toContain("empNo");
    expect(text).not.toContain("example.test");
  });

  it("팀원이 없으면 빈 페이지 200 이고 보고를 조회하지 않는다", async () => {
    vi.mocked(prisma.salesRep.findMany).mockResolvedValue([]);

    const response = await GET(asManager(URL));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    });
    expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/reports/team — 권한 (TC-SEC-02)", () => {
  it("repIds 에 비소속 ID 가 하나라도 있으면 403", async () => {
    const response = await GET(asManager(`${URL}?repIds=1,3`));

    expect(response.status).toBe(403);
    expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
  });

  it("팀원이 없는 상급자가 repIds 를 지정하면 403", async () => {
    vi.mocked(prisma.salesRep.findMany).mockResolvedValue([]);
    expect((await GET(asManager(`${URL}?repIds=1`))).status).toBe(403);
  });

  it("호출자 본인 ID 도 팀원이 아니므로 403", async () => {
    expect((await GET(asManager(`${URL}?repIds=2`))).status).toBe(403);
  });

  it("SALES_REP·ADMIN 은 403, 인증 없음은 401 이며 DB 를 읽지 않는다", async () => {
    expect((await GET(asSalesRep(URL))).status).toBe(403);
    expect((await GET(asAdmin(URL))).status).toBe(403);
    expect((await GET(withoutAuth(URL))).status).toBe(401);
    expect(prisma.salesRep.findMany).not.toHaveBeenCalled();
    expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
  });

  it("역할이 없으면 파라미터가 틀려도 400 이 아니라 403", async () => {
    expect((await GET(asSalesRep(`${URL}?size=abc`))).status).toBe(403);
  });
});

describe("GET /api/reports/team — 잘못된 입력 (TC-SEC-05)", () => {
  it.each([
    "repIds=abc",
    "repIds=1,,2",
    "repIds=0",
    "repIds=-1",
    "repIds=1.5",
    "repIds=9007199254740993",
    "customerId=abc",
    "customerId=0",
    "customerId=9007199254740993",
    "size=0",
    "size=101",
    "size=abc",
    "page=-1",
    "sort=repId,asc",
    "sort=reportDate,sideways",
    "status=X",
    "fromDate=2026-6-1",
    "fromDate=2026-07-01&toDate=2026-06-01",
  ])("%s 는 400", async (query) => {
    const response = await GET(asManager(`${URL}?${query}`));

    expect(response.status).toBe(400);
    expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
  });

  it("repIds 가 100개를 넘으면 400", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
    expect((await GET(asManager(`${URL}?repIds=${ids}`))).status).toBe(400);
  });

  it("빈 repIds 값은 미지정으로 본다", async () => {
    const response = await GET(asManager(`${URL}?repIds=`));
    expect(response.status).toBe(200);
    expect(lastWhere()).toEqual({ repId: { in: [1n, 5n] } });
  });

  it("중복된 repIds 는 합친다", async () => {
    await GET(asManager(`${URL}?repIds=1&repIds=1,1`));
    expect(lastWhere()).toEqual({ repId: { in: [1n] } });
  });
});
