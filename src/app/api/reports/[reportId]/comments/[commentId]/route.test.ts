import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROOT_COMMENT,
  SUBMITTED_REPORT_ROW,
  asAdmin,
  asManager,
  asOtherManager,
  asOtherRep,
  asSalesRep,
  commentParams,
  readBody,
  withoutAuth,
} from "@/test/comment-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    dailyReport: { findUnique: vi.fn() },
    reportComment: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { DELETE, PUT } from "./route";

const URL = "http://localhost/api/reports/10/comments/400";
// 400 번 댓글의 작성자는 2번(상급자)이다.
const put = (
  body: unknown,
  make: typeof asManager = asManager,
  ids = ["10", "400"],
) => PUT(make(URL, { method: "PUT", body }), commentParams(ids[0], ids[1]));
const del = (make: typeof asManager = asManager, ids = ["10", "400"]) =>
  DELETE(make(URL, { method: "DELETE" }), commentParams(ids[0], ids[1]));

beforeEach(() => {
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
  vi.mocked(prisma.$queryRaw)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(prisma.dailyReport.findUnique)
    .mockReset()
    .mockResolvedValue(SUBMITTED_REPORT_ROW as never);
  vi.mocked(prisma.reportComment.findFirst)
    .mockReset()
    .mockResolvedValue({ commenterId: 2n } as never);
  vi.mocked(prisma.reportComment.count).mockReset().mockResolvedValue(0);
  vi.mocked(prisma.reportComment.update)
    .mockReset()
    .mockResolvedValue({ ...ROOT_COMMENT, content: "수정함" } as never);
  vi.mocked(prisma.reportComment.delete)
    .mockReset()
    .mockResolvedValue({} as never);
});

describe("PUT /api/reports/{reportId}/comments/{commentId}", () => {
  it("본인 댓글은 200 이고 내용만 바꾼다", async () => {
    const response = await put({ content: " 수정함 ", parentCommentId: 1 });
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ commentId: 400, content: "수정함" });
    // 스레드 위치는 바꾸지 못한다.
    expect(prisma.reportComment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { commentId: 400n },
        data: { content: "수정함" },
      }),
    );
  });

  it("댓글은 (commentId, reportId) 로 찾는다 — 다른 보고의 댓글을 건드리지 못한다", async () => {
    await put({ content: "수정함" });
    expect(prisma.reportComment.findFirst).toHaveBeenCalledWith({
      where: { commentId: 400n, reportId: 10n },
      select: { commenterId: true },
    });
  });

  it("TC-CMT-04: 타인 댓글은 403 이다 (보고를 볼 수 있는 작성자여도)", async () => {
    const response = await put({ content: "수정함" }, asSalesRep);

    expect(response.status).toBe(403);
    expect(prisma.reportComment.update).not.toHaveBeenCalled();
  });

  it("다른 보고의 commentId 는 없는 댓글과 같은 404 다", async () => {
    vi.mocked(prisma.reportComment.findFirst).mockResolvedValue(null);
    const response = await put({ content: "수정함" });

    expect(response.status).toBe(404);
    expect(prisma.reportComment.update).not.toHaveBeenCalled();
  });

  it("보고를 볼 수 없으면 댓글 존재 여부와 무관하게 403 이다", async () => {
    vi.mocked(prisma.reportComment.findFirst).mockResolvedValue(null);

    expect((await put({ content: "수정함" }, asOtherRep)).status).toBe(403);
    expect((await put({ content: "수정함" }, asOtherManager)).status).toBe(403);
    expect(prisma.reportComment.findFirst).not.toHaveBeenCalled();
  });

  it("읽은 뒤 삭제되면(P2025) 404", async () => {
    vi.mocked(prisma.reportComment.update).mockRejectedValue({ code: "P2025" });
    expect((await put({ content: "수정함" })).status).toBe(404);
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await put({ content: "수정함" })).status).toBe(404);
  });

  it.each([{}, { content: "  " }, { content: "가".repeat(2001) }])(
    "잘못된 입력 %j 는 400",
    async (body) => {
      expect((await put(body)).status).toBe(400);
      expect(prisma.reportComment.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["abc", "400"],
    ["10", "abc"],
    ["9007199254740993", "400"],
    ["10", "9007199254740993"],
    ["10", "0"],
  ])("잘못된 식별자(%s, %s)는 400", async (reportId, commentId) => {
    expect(
      (await put({ content: "x" }, asManager, [reportId, commentId])).status,
    ).toBe(400);
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await put({ content: "x" }, asAdmin)).status).toBe(403);
    expect((await put({ content: "x" }, withoutAuth)).status).toBe(401);
    expect(prisma.dailyReport.findUnique).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/reports/{reportId}/comments/{commentId}", () => {
  it("TC-CMT-05: 본인 댓글 삭제는 204 이고 본문이 없다", async () => {
    const response = await del();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(prisma.reportComment.delete).toHaveBeenCalledWith({
      where: { commentId: 400n },
    });
    // 대댓글 수를 세기 전에 행을 잠근다.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("타인 댓글은 403 이다", async () => {
    const response = await del(asSalesRep);

    expect(response.status).toBe(403);
    expect(prisma.reportComment.delete).not.toHaveBeenCalled();
  });

  it("대댓글이 달린 댓글은 409 COMMENT_HAS_REPLIES", async () => {
    vi.mocked(prisma.reportComment.count).mockResolvedValue(1);
    const response = await del();

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("COMMENT_HAS_REPLIES");
    expect(prisma.reportComment.delete).not.toHaveBeenCalled();
    expect(prisma.reportComment.count).toHaveBeenCalledWith({
      where: { parentCommentId: 400n },
    });
  });

  it("다른 보고의 commentId 는 404, 삭제하지 않는다", async () => {
    vi.mocked(prisma.reportComment.findFirst).mockResolvedValue(null);
    const response = await del();

    expect(response.status).toBe(404);
    expect(prisma.reportComment.delete).not.toHaveBeenCalled();
  });

  it("보고를 볼 수 없으면 403", async () => {
    expect((await del(asOtherRep)).status).toBe(403);
    expect((await del(asOtherManager)).status).toBe(403);
    expect(prisma.reportComment.findFirst).not.toHaveBeenCalled();
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await del()).status).toBe(404);
  });

  it("삭제 직전에 사라졌다면(P2025) 404", async () => {
    vi.mocked(prisma.reportComment.delete).mockRejectedValue({ code: "P2025" });
    expect((await del()).status).toBe(404);
  });

  it.each([
    ["abc", "400"],
    ["10", "abc"],
    ["10", "9007199254740993"],
    ["10", "0"],
  ])("잘못된 식별자(%s, %s)는 400", async (reportId, commentId) => {
    expect((await del(asManager, [reportId, commentId])).status).toBe(400);
  });

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await del(asAdmin)).status).toBe(403);
    expect((await del(withoutAuth)).status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
