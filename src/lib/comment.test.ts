import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  deleteComment,
  assertReplyParent,
  toCommentResponse,
  toCommentThread,
} from "./comment";
import { HttpError } from "./errors";
import { DELETED_ROOT, REPLY, ROOT_COMMENT } from "@/test/comment-fixtures";

function fakeTx(overrides: {
  parent?: unknown;
  replies?: number;
}): Prisma.TransactionClient {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    reportComment: {
      findUnique: vi.fn().mockResolvedValue(overrides.parent ?? null),
      count: vi.fn().mockResolvedValue(overrides.replies ?? 0),
    },
  } as unknown as Prisma.TransactionClient;
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof HttpError ? [error.status, error.code] : error;
  }
  return null;
}

describe("assertReplyParent", () => {
  it("같은 보고의 루트 댓글이면 통과하고 부모를 잠근다", async () => {
    const tx = fakeTx({
      parent: { reportId: 10n, parentCommentId: null, deletedAt: null },
    });
    expect(await codeOf(assertReplyParent(tx, 10n, 400n))).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("없는 댓글과 다른 보고의 댓글은 같은 오류다", async () => {
    const missing = await codeOf(assertReplyParent(fakeTx({}), 10n, 400n));
    const foreign = await codeOf(
      assertReplyParent(
        fakeTx({ parent: { reportId: 77n, parentCommentId: null } }),
        10n,
        400n,
      ),
    );

    expect(missing).toEqual([400, "PARENT_NOT_IN_REPORT"]);
    expect(foreign).toEqual(missing);
  });

  it("대댓글을 부모로 지정하면 PARENT_IS_REPLY", async () => {
    const tx = fakeTx({ parent: { reportId: 10n, parentCommentId: 400n } });
    expect(await codeOf(assertReplyParent(tx, 10n, 401n))).toEqual([
      400,
      "PARENT_IS_REPLY",
    ]);
  });
});

describe("assertReplyParent — 삭제된 부모 (이슈 #71)", () => {
  it("같은 보고의 삭제된 댓글은 PARENT_DELETED", async () => {
    const tx = fakeTx({
      parent: { reportId: 10n, parentCommentId: null, deletedAt: new Date() },
    });
    expect(await codeOf(assertReplyParent(tx, 10n, 400n))).toEqual([
      400,
      "PARENT_DELETED",
    ]);
  });

  it("다른 보고의 삭제된 댓글은 소속 오류다 (삭제 여부를 알리지 않는다)", async () => {
    const tx = fakeTx({
      parent: { reportId: 77n, parentCommentId: null, deletedAt: new Date() },
    });
    expect(await codeOf(assertReplyParent(tx, 10n, 400n))).toEqual([
      400,
      "PARENT_NOT_IN_REPORT",
    ]);
  });
});

describe("deleteComment", () => {
  function deleteTx(current: unknown, replies: number) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      reportComment: {
        findUnique: vi.fn().mockResolvedValue(current),
        count: vi.fn().mockResolvedValue(replies),
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    return { tx, client: tx as unknown as Prisma.TransactionClient };
  }

  it("대댓글이 없으면 물리 삭제한다", async () => {
    const { tx, client } = deleteTx({ deletedAt: null }, 0);

    expect(await deleteComment(client, 400n)).toBe("HARD");
    expect(tx.reportComment.delete).toHaveBeenCalledWith({
      where: { commentId: 400n },
    });
    expect(tx.reportComment.update).not.toHaveBeenCalled();
  });

  it("대댓글이 있으면 deletedAt 만 채우고 행은 지우지 않는다", async () => {
    const { tx, client } = deleteTx({ deletedAt: null }, 2);

    expect(await deleteComment(client, 400n)).toBe("SOFT");
    expect(tx.reportComment.delete).not.toHaveBeenCalled();
    expect(tx.reportComment.update).toHaveBeenCalledWith({
      where: { commentId: 400n },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("잠금을 잡은 뒤에 읽고 센다", async () => {
    const { tx, client } = deleteTx({ deletedAt: null }, 0);
    await deleteComment(client, 400n);

    const lock = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(lock).toBeLessThan(
      tx.reportComment.findUnique.mock.invocationCallOrder[0],
    );
    expect(lock).toBeLessThan(
      tx.reportComment.count.mock.invocationCallOrder[0],
    );
  });

  it.each([[null], [{ deletedAt: new Date() }]])(
    "잠근 뒤 이미 없거나 삭제된 댓글(%j)은 404",
    async (current) => {
      const { tx, client } = deleteTx(current, 1);

      expect(await codeOf(deleteComment(client, 400n))).toEqual([
        404,
        "NOT_FOUND",
      ]);
      expect(tx.reportComment.delete).not.toHaveBeenCalled();
      expect(tx.reportComment.update).not.toHaveBeenCalled();
    },
  );
});

describe("응답 변환", () => {
  it("명시한 필드만 담고 식별자를 숫자로 바꾼다", () => {
    const dirty = { ...REPLY, email: "x@y.z", reportId: 10n } as typeof REPLY;
    const result = toCommentResponse(dirty);

    expect(Object.keys(result).sort()).toEqual([
      "commentId",
      "commenter",
      "content",
      "createdAt",
      "deleted",
      "parentCommentId",
    ]);
    expect(result.commentId).toBe(401);
    expect(result.parentCommentId).toBe(400);
  });

  it("삭제된 댓글은 deleted:true 이고 content·commenter 키가 없다", () => {
    const result = toCommentResponse(DELETED_ROOT);

    expect(result).toEqual({
      commentId: 400,
      deleted: true,
      parentCommentId: null,
      createdAt: "2026-06-20T10:00:00.000Z",
    });
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("commenter");
  });

  it("스레드는 replies 를 담고 대댓글에는 replies 키가 없다", () => {
    const thread = toCommentThread(ROOT_COMMENT);

    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0]).not.toHaveProperty("replies");
  });
});
