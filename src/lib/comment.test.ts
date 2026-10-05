import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  assertNoReplies,
  assertReplyParent,
  toCommentResponse,
  toCommentThread,
} from "./comment";
import { HttpError } from "./errors";
import { REPLY, ROOT_COMMENT } from "@/test/comment-fixtures";

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
    const tx = fakeTx({ parent: { reportId: 10n, parentCommentId: null } });
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

describe("assertNoReplies", () => {
  it("대댓글이 없으면 통과한다", async () => {
    expect(
      await codeOf(assertNoReplies(fakeTx({ replies: 0 }), 400n)),
    ).toBeNull();
  });

  it("대댓글이 있으면 409 COMMENT_HAS_REPLIES", async () => {
    expect(await codeOf(assertNoReplies(fakeTx({ replies: 2 }), 400n))).toEqual(
      [409, "COMMENT_HAS_REPLIES"],
    );
  });
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
      "parentCommentId",
    ]);
    expect(result.commentId).toBe(401);
    expect(result.parentCommentId).toBe(400);
  });

  it("스레드는 replies 를 담고 대댓글에는 replies 키가 없다", () => {
    const thread = toCommentThread(ROOT_COMMENT);

    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0]).not.toHaveProperty("replies");
  });
});
