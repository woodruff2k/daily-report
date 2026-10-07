import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT,
  SUBMITTED_REPORT,
  asAdmin,
  asManager,
  asOtherRep,
  asSalesRep,
  params,
  readBody,
  withoutAuth,
} from "@/test/report-fixtures";

// 덮는 TC: TC-WDR-01(정상), TC-WDR-02(타인 403), TC-WDR-03(이미 DRAFT 409),
//          TC-WDR-04·05(댓글 있음 409), TC-WDR-07(404·400·401·403)
// 동시성(TC-WDR-06)은 실제 DB 가 필요해 route.integration.test.ts 에서 본다.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    dailyReport: { findUnique: vi.fn(), updateMany: vi.fn() },
    reportComment: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const URL = "http://localhost/api/reports/10/withdraw";
const withdraw = (request = asSalesRep(URL, { method: "POST" })) =>
  POST(request, params("10"));

beforeEach(() => {
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
  vi.mocked(prisma.dailyReport.findUnique)
    .mockReset()
    .mockResolvedValue(SUBMITTED_REPORT as never);
  vi.mocked(prisma.dailyReport.updateMany)
    .mockReset()
    .mockResolvedValue({ count: 1 });
  vi.mocked(prisma.reportComment.count).mockReset().mockResolvedValue(0);
});

describe("POST /api/reports/{reportId}/withdraw — TC-WDR", () => {
  it("TC-WDR-01: SUBMITTED 를 DRAFT 로 되돌리고 submittedAt 을 null 로 만든다", async () => {
    const response = await withdraw();
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      reportId: 10,
      status: "DRAFT",
      submittedAt: null,
    });
    expect(prisma.dailyReport.updateMany).toHaveBeenCalledWith({
      where: { reportId: 10n, status: "SUBMITTED" },
      data: {
        updatedAt: expect.any(Date),
        status: "DRAFT",
        submittedAt: null,
      },
    });
  });

  it("TC-WDR-04·05: 댓글 수는 deletedAt 으로 거르지 않고 센다", async () => {
    await withdraw();

    expect(prisma.reportComment.count).toHaveBeenCalledWith({
      where: { reportId: 10n },
    });
  });

  it("TC-WDR-04: 댓글이 1건이라도 있으면 409 REPORT_HAS_COMMENTS (예외로 롤백)", async () => {
    vi.mocked(prisma.reportComment.count).mockResolvedValue(1);
    const response = await withdraw();
    const body = await readBody(response);

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("REPORT_HAS_COMMENTS");
    expect(body.data).toBeNull();
  });

  it("TC-WDR-03: 이미 DRAFT 면 409 REPORT_NOT_SUBMITTED 이고 쓰지 않는다", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(REPORT as never);
    const response = await withdraw();

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("REPORT_NOT_SUBMITTED");
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
    expect(prisma.reportComment.count).not.toHaveBeenCalled();
  });

  it("TC-WDR-03: 읽은 뒤 다른 요청이 먼저 회수하면(0행) 409 REPORT_NOT_SUBMITTED", async () => {
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 0 });
    const response = await withdraw();

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("REPORT_NOT_SUBMITTED");
    expect(prisma.reportComment.count).not.toHaveBeenCalled();
  });

  it("TC-WDR-02: 타인·상급자는 403 이다. 상태와 무관하게 상태를 알려주지 않는다", async () => {
    for (const status of [SUBMITTED_REPORT, REPORT]) {
      vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
        status as never,
      );
      const other = await withdraw(asOtherRep(URL, { method: "POST" }));
      const manager = await withdraw(asManager(URL, { method: "POST" }));

      expect(other.status).toBe(403);
      expect(manager.status).toBe(403);
    }
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
  });

  it("TC-WDR-07: 없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await withdraw()).status).toBe(404);
  });

  it.each(["abc", "9007199254740993", "0"])(
    "TC-WDR-07: 잘못된 식별자 %s 는 400",
    async (id) => {
      const response = await POST(
        asSalesRep(URL, { method: "POST" }),
        params(id),
      );
      expect(response.status).toBe(400);
    },
  );

  it("TC-WDR-07: ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await withdraw(asAdmin(URL, { method: "POST" }))).status).toBe(403);
    expect((await withdraw(withoutAuth(URL, { method: "POST" }))).status).toBe(
      401,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
