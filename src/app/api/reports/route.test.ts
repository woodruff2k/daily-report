import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_LIST_RECORD,
  asAdmin,
  asManager,
  asSalesRep,
  readBody,
  withoutAuth,
} from "@/test/report-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyReport: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";

const URL = "http://localhost/api/reports";

beforeEach(() => {
  vi.mocked(prisma.dailyReport.findMany)
    .mockReset()
    .mockResolvedValue([REPORT_LIST_RECORD] as never);
  vi.mocked(prisma.dailyReport.count).mockReset().mockResolvedValue(1);
  vi.mocked(prisma.dailyReport.create)
    .mockReset()
    .mockResolvedValue({ reportId: 10n, status: "DRAFT" } as never);
});

// 환경 스텁은 단언 실패와 무관하게 되돌린다. 테스트 본문 끝에 두면
// 앞선 단언이 실패할 때 다음 테스트로 샌다.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/reports — TC-RPT-03·04", () => {
  it("본인 보고 목록을 건수와 함께 돌려준다", async () => {
    const response = await GET(asSalesRep(URL));
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
      reportDate: "2026-06-20",
      visitCount: 3,
      status: "SUBMITTED",
      commentCount: 2,
      updatedAt: "2026-06-20T09:10:00.000Z",
    });
  });

  it("조회 대상은 항상 호출자 본인이고 건수는 한 쿼리(_count)로 읽는다", async () => {
    await GET(asSalesRep(`${URL}?repId=3`));

    const args = vi.mocked(prisma.dailyReport.findMany).mock.calls[0][0];
    expect(args?.where).toEqual({ repId: 1n });
    expect(args?.select?._count).toEqual({
      select: { visits: true, comments: true },
    });
    expect(prisma.dailyReport.findMany).toHaveBeenCalledTimes(1);
  });

  it("기간·상태 필터를 조회 조건으로 넘긴다", async () => {
    await GET(
      asManager(
        `${URL}?fromDate=2026-06-01&toDate=2026-06-30&status=SUBMITTED`,
      ),
    );

    const args = vi.mocked(prisma.dailyReport.findMany).mock.calls[0][0];
    expect(args?.where).toEqual({
      repId: 2n,
      reportDate: {
        gte: new Date("2026-06-01T00:00:00.000Z"),
        lte: new Date("2026-06-30T00:00:00.000Z"),
      },
      status: "SUBMITTED",
    });
    expect(prisma.dailyReport.count).toHaveBeenCalledWith({
      where: args?.where,
    });
  });

  it.each([
    "fromDate=2026-6-1",
    "toDate=2026-02-30",
    "fromDate=2026-07-01&toDate=2026-06-01",
    "status=X",
    "sort=repId,asc",
    "size=abc",
  ])("%s 는 400", async (query) => {
    expect((await GET(asSalesRep(`${URL}?${query}`))).status).toBe(400);
    expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await GET(asAdmin(URL))).status).toBe(403);
    expect((await GET(withoutAuth(URL))).status).toBe(401);
    expect(prisma.dailyReport.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports — TC-RPT-01·02, TC-NFR-02", () => {
  const post = (body: unknown) =>
    POST(asSalesRep(URL, { method: "POST", body }));

  it("201 로 DRAFT 보고를 만든다. 작성자는 본문이 아니라 인증에서 정한다", async () => {
    const response = await post({ reportDate: "2026-06-20", repId: 3 });
    const body = await readBody(response);

    expect(response.status).toBe(201);
    expect(body.data).toEqual({ reportId: 10, status: "DRAFT" });
    expect(vi.mocked(prisma.dailyReport.create).mock.calls[0][0].data).toEqual({
      repId: 1n,
      reportDate: new Date("2026-06-20T00:00:00.000Z"),
    });
  });

  it("상급자도 본인 보고를 만들 수 있다", async () => {
    const response = await POST(
      asManager(URL, { method: "POST", body: { reportDate: "2026-06-20" } }),
    );
    expect(response.status).toBe(201);
  });

  it("미래 날짜도 막지 않는다", async () => {
    expect((await post({ reportDate: "2099-01-01" })).status).toBe(201);
  });

  it("같은 일자 보고가 있으면 409 REPORT_ALREADY_EXISTS", async () => {
    vi.mocked(prisma.dailyReport.create).mockRejectedValue({
      code: "P2002",
      meta: { target: ["rep_id", "report_date"] },
    });

    const response = await post({ reportDate: "2026-06-20" });
    const body = await readBody(response);

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("REPORT_ALREADY_EXISTS");
  });

  it("동시 요청 둘 중 하나가 유니크 위반을 받으면 409 로 매핑된다", async () => {
    vi.mocked(prisma.dailyReport.create)
      .mockResolvedValueOnce({ reportId: 10n, status: "DRAFT" } as never)
      .mockRejectedValueOnce({ code: "P2002", meta: { target: "x" } });

    const responses = await Promise.all([
      post({ reportDate: "2026-06-20" }),
      post({ reportDate: "2026-06-20" }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("유니크 위반이 아닌 DB 오류는 내용을 응답에 싣지 않고 500 INTERNAL_ERROR 로 응답한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(prisma.dailyReport.create).mockRejectedValue(
      new Error("connection refused: secret-host"),
    );

    const response = await post({ reportDate: "2026-06-20" });

    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).toContain("INTERNAL_ERROR");
    expect(raw).not.toContain("secret-host");
  });

  it.each([
    ["본문 없음", undefined],
    ["reportDate 누락", {}],
    ["형식 오류", { reportDate: "2026/06/20" }],
    ["없는 날짜", { reportDate: "2026-02-30" }],
    ["타입 오류", { reportDate: 20260620 }],
  ])("%s 는 400", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(prisma.dailyReport.create).not.toHaveBeenCalled();
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    const body = { reportDate: "2026-06-20" };
    expect((await POST(asAdmin(URL, { method: "POST", body }))).status).toBe(
      403,
    );
    expect(
      (await POST(withoutAuth(URL, { method: "POST", body }))).status,
    ).toBe(401);
    expect(prisma.dailyReport.create).not.toHaveBeenCalled();
  });
});

// 덮는 TC: 없음(동순위 정렬은 명세에 TC 가 없다). 가장 가까운 것은 TC-RPT-03. (#95)
describe("GET /api/reports — 동순위 보조 정렬 (#95)", () => {
  it.each(["", "?sort=status,asc", "?sort=status,desc"])(
    "쿼리 %s 와 무관하게 reportId desc 를 마지막 보조 키로 붙인다",
    async (query) => {
      await GET(asSalesRep(`${URL}${query}`));

      const args = vi.mocked(prisma.dailyReport.findMany).mock.calls[0][0];
      const orderBy = args?.orderBy as Record<string, string>[];
      expect(orderBy).toHaveLength(2);
      expect(orderBy[1]).toEqual({ reportId: "desc" });
    },
  );
});
