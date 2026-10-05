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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    dailyReport: { findUnique: vi.fn(), updateMany: vi.fn() },
    visitRecord: { count: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const URL = "http://localhost/api/reports/10/submit";
const submit = (request = asSalesRep(URL, { method: "POST" })) =>
  POST(request, params("10"));

beforeEach(() => {
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
  vi.mocked(prisma.dailyReport.findUnique)
    .mockReset()
    .mockResolvedValue(REPORT as never);
  vi.mocked(prisma.dailyReport.updateMany)
    .mockReset()
    .mockResolvedValue({ count: 1 });
  vi.mocked(prisma.visitRecord.count).mockReset().mockResolvedValue(2);
});

describe("POST /api/reports/{reportId}/submit — TC-SUB-01·02", () => {
  it("TC-SUB-01: DRAFT 를 SUBMITTED 로 바꾸고 submittedAt 을 기록한다", async () => {
    const response = await submit();
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ reportId: 10, status: "SUBMITTED" });
    expect(typeof body.data?.submittedAt).toBe("string");
    expect(prisma.dailyReport.updateMany).toHaveBeenCalledWith({
      where: { reportId: 10n, status: "DRAFT" },
      data: {
        updatedAt: expect.any(Date),
        status: "SUBMITTED",
        submittedAt: expect.any(Date),
      },
    });
  });

  it("TC-SUB-02: 방문 0건은 400 VISITS_REQUIRED (트랜잭션 예외로 롤백)", async () => {
    vi.mocked(prisma.visitRecord.count).mockResolvedValue(0);
    const response = await submit();
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VISITS_REQUIRED");
  });

  it("이미 제출된 보고의 재호출은 409 REPORT_ALREADY_SUBMITTED", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      SUBMITTED_REPORT as never,
    );
    const response = await submit();

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe(
      "REPORT_ALREADY_SUBMITTED",
    );
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
  });

  it("읽은 뒤 다른 요청이 먼저 제출하면 409 REPORT_ALREADY_SUBMITTED", async () => {
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 0 });
    const response = await submit();

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe(
      "REPORT_ALREADY_SUBMITTED",
    );
    expect(prisma.visitRecord.count).not.toHaveBeenCalled();
  });

  it("타인·상급자는 403 이다. 제출 여부도 알려주지 않는다", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      SUBMITTED_REPORT as never,
    );
    const other = await submit(asOtherRep(URL, { method: "POST" }));
    const manager = await submit(asManager(URL, { method: "POST" }));

    expect(other.status).toBe(403);
    expect(manager.status).toBe(403);
    expect(prisma.dailyReport.updateMany).not.toHaveBeenCalled();
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await submit()).status).toBe(404);
  });

  it.each(["abc", "9007199254740993", "0"])(
    "잘못된 식별자 %s 는 400",
    async (id) => {
      const response = await POST(
        asSalesRep(URL, { method: "POST" }),
        params(id),
      );
      expect(response.status).toBe(400);
    },
  );

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await submit(asAdmin(URL, { method: "POST" }))).status).toBe(403);
    expect((await submit(withoutAuth(URL, { method: "POST" }))).status).toBe(
      401,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
