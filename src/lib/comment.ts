import type { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "./errors";
import { toJsonId, toJsonIdOrNull } from "./identifier";

/**
 * 댓글 한 건에 읽는 필드. 응답에 쓰는 것만 담는다. (NFR-04)
 *
 * 작성자는 `repId`·`name` 만 읽는다. 이메일·사번은 화면(SCR-220)이 쓰지 않는다.
 * `reportId` 도 읽지 않는다 — 경로에 이미 있다.
 */
export const COMMENT_SELECT = {
  commentId: true,
  parentCommentId: true,
  content: true,
  createdAt: true,
  // 삭제 여부 판정용. 응답에는 `deleted` 플래그로만 나간다.
  deletedAt: true,
  commenter: { select: { repId: true, name: true } },
} satisfies Prisma.ReportCommentSelect;

/**
 * 목록용. 루트 댓글에 대댓글을 `include` 로 한 번에 읽는다. (N+1 방지)
 * 둘 다 작성순이다. 같은 시각이면 식별자 순으로 고정해 순서가 흔들리지 않게 한다.
 */
export const COMMENT_ORDER_BY = [
  { createdAt: "asc" },
  { commentId: "asc" },
] satisfies Prisma.ReportCommentOrderByWithRelationInput[];

export const COMMENT_TREE_SELECT = {
  ...COMMENT_SELECT,
  replies: { orderBy: COMMENT_ORDER_BY, select: COMMENT_SELECT },
} satisfies Prisma.ReportCommentSelect;

export type CommentRecord = Prisma.ReportCommentGetPayload<{
  select: typeof COMMENT_SELECT;
}>;
export type CommentTreeRecord = Prisma.ReportCommentGetPayload<{
  select: typeof COMMENT_TREE_SELECT;
}>;

/**
 * 댓글 응답. (API 명세 4.1·4.2·4.3) Prisma 모델을 그대로 반환하지 않는다.
 *
 * 소프트 삭제된 댓글은 `deleted: true` 이고 `content`·`commenter` 키가 **없다**.
 * 유니온이라 타입 수준에서 삭제된 댓글에 내용을 담을 수 없다. `content` 에
 * "삭제된 댓글입니다" 같은 문구를 써 넣지 않는다 — 사용자가 같은 문장을 직접
 * 입력한 경우와 구별할 수 없다. 상태는 플래그로, 표시 문구는 화면이 정한다.
 */
interface CommentBase {
  commentId: number;
  parentCommentId: number | null;
  createdAt: string;
}

export interface LiveCommentResponse extends CommentBase {
  deleted: false;
  commenter: { repId: number; name: string };
  content: string;
}

export interface DeletedCommentResponse extends CommentBase {
  deleted: true;
}

export type CommentResponse = LiveCommentResponse | DeletedCommentResponse;

export type CommentThreadResponse = CommentResponse & {
  replies: CommentResponse[];
};

export function toCommentResponse(record: CommentRecord): CommentResponse {
  const base = {
    commentId: toJsonId(record.commentId),
    parentCommentId: toJsonIdOrNull(record.parentCommentId),
    createdAt: record.createdAt.toISOString(),
  };

  if (record.deletedAt !== null) {
    return { ...base, deleted: true };
  }

  return {
    ...base,
    deleted: false,
    commenter: {
      repId: toJsonId(record.commenter.repId),
      name: record.commenter.name,
    },
    content: record.content,
  };
}

export function toCommentThread(
  record: CommentTreeRecord,
): CommentThreadResponse {
  return {
    ...toCommentResponse(record),
    replies: record.replies.map(toCommentResponse),
  };
}

/**
 * 행 잠금 모드. 대댓글 작성은 부모를 `SHARE`(동시 작성 허용), 삭제는 대상을
 * `UPDATE` 로 잡는다. 둘은 서로를 기다린다.
 */
type LockMode = "SHARE" | "UPDATE";

/**
 * 댓글 행을 잠근다. 트랜잭션 안에서만 호출한다.
 *
 * 부모를 읽어 확인한 뒤 대댓글을 넣는 사이에 부모가 삭제되면 FK 위반이 나고,
 * 반대로 "대댓글 없음"을 확인한 뒤 삭제하는 사이에 대댓글이 들어오면 대댓글이
 * 루트로 승격된다(`onDelete` 기본 SetNull). 둘 다 check-then-write 이므로 행을
 * 잠가 직렬화한다. Prisma 에 `FOR UPDATE` 가 없어 raw 쿼리를 쓴다. 값은 태그드
 * 템플릿의 바인딩 파라미터이고 잠금 모드는 리터럴 두 개 중 하나다.
 */
export async function lockComment(
  tx: Prisma.TransactionClient,
  commentId: bigint,
  mode: LockMode,
): Promise<void> {
  if (mode === "SHARE") {
    await tx.$queryRaw`SELECT comment_id FROM report_comment WHERE comment_id = ${commentId} FOR SHARE`;
  } else {
    await tx.$queryRaw`SELECT comment_id FROM report_comment WHERE comment_id = ${commentId} FOR UPDATE`;
  }
}

/**
 * 부모 댓글이 대댓글을 달 수 있는 대상인지 확인한다. (결정: 1단계, 같은 보고)
 *
 * - 같은 보고의 댓글이어야 한다. 다른 보고의 댓글 식별자로 남의 보고 스레드에
 *   댓글을 붙이는 것을 막는 IDOR 방어다. 없는 댓글과 다른 보고의 댓글에 **같은
 *   응답**(`PARENT_NOT_IN_REPORT`)을 줘, 다른 보고에 그 댓글이 있다는 사실이
 *   드러나지 않게 한다. (`report.ts` 의 `assertIdsBelong` 과 같은 설계)
 * - 루트 댓글이어야 한다. 명세 4.1 의 응답이 `replies` 한 겹이고 SCR-220 도 두
 *   단이다. 깊이를 허용하면 응답 구조를 재귀로 바꿔야 하는데 명세에 없다.
 *   소속 확인이 먼저다 — 다른 보고의 댓글이 대댓글인지는 알려주지 않는다.
 */
// 삭제된 루트에는 대댓글을 달 수 없다. 그 결과 보고 작성자는 그 스레드에 새
// 댓글을 달 방법이 없어진다 — 루트 댓글은 쓸 수 없고(FR-09) 대댓글에 대댓글도
// 안 된다. 의도한 제약이다: 스레드를 연 상급자가 피드백을 철회했으므로 대화가
// 끝난 것으로 본다. 작성자의 기존 대댓글은 남고 수정·삭제도 된다. 상급자가 새
// 루트 댓글을 달면 대화가 다시 열린다. (명세 4.3)
export async function assertReplyParent(
  tx: Prisma.TransactionClient,
  reportId: bigint,
  parentCommentId: bigint,
): Promise<void> {
  await lockComment(tx, parentCommentId, "SHARE");

  const parent = await tx.reportComment.findUnique({
    where: { commentId: parentCommentId },
    select: { reportId: true, parentCommentId: true, deletedAt: true },
  });

  if (!parent || parent.reportId !== reportId) {
    throw new ValidationError(
      "보고에 속하지 않은 댓글입니다.",
      "PARENT_NOT_IN_REPORT",
    );
  }

  if (parent.parentCommentId !== null) {
    throw new ValidationError(
      "대댓글에는 답글을 달 수 없습니다.",
      "PARENT_IS_REPLY",
    );
  }

  // 소속 확인 뒤에 본다 — 다른 보고의 댓글이 삭제됐는지는 알려주지 않는다.
  // 같은 보고의 삭제된 댓글은 목록에 `deleted: true` 로 보이므로 구분해도 새는
  // 정보가 없고, 화면이 "삭제된 댓글에는 답글을 달 수 없다" 를 말할 수 있다.
  if (parent.deletedAt !== null) {
    throw new ValidationError(
      "삭제된 댓글에는 답글을 달 수 없습니다.",
      "PARENT_DELETED",
    );
  }
}

/**
 * 댓글을 지운다. 트랜잭션 안에서만 호출한다. (이슈 #71)
 *
 * - 대댓글이 없으면 물리 삭제다. 흔적을 남길 이유가 없다.
 * - 대댓글이 있으면 `deletedAt` 만 채운다. 물리 삭제하면 대댓글의 부모가 NULL
 *   (`onDelete` 기본 SetNull)이 되어 루트 댓글로 승격되고 뜻이 바뀐다.
 *
 * 분기 판정(삭제 여부 재확인·대댓글 수)은 **`FOR UPDATE` 를 잡은 뒤에** 한다.
 * 대댓글 작성은 부모를 `FOR SHARE` 로 잡으므로 둘이 직렬화된다. 대댓글이 먼저
 * 커밋되면 수가 1 이라 소프트 삭제, 삭제가 먼저면 대댓글이 부모 없음(400)이다.
 * 잠금 전에 읽은 값은 믿지 않는다 — 동시에 온 두 번째 삭제가 여기서 404 가 된다.
 *
 * 모든 대댓글이 사라져도 소프트 삭제된 부모를 정리하지 않는다. 남은 행은 무해하고
 * 정리를 넣으면 삭제 경로가 재귀가 된다.
 */
export async function deleteComment(
  tx: Prisma.TransactionClient,
  commentId: bigint,
): Promise<"HARD" | "SOFT"> {
  await lockComment(tx, commentId, "UPDATE");

  const current = await tx.reportComment.findUnique({
    where: { commentId },
    select: { deletedAt: true },
  });

  if (!current || current.deletedAt !== null) {
    throw new NotFoundError("댓글을 찾을 수 없습니다.");
  }

  const replies = await tx.reportComment.count({
    where: { parentCommentId: commentId },
  });

  if (replies === 0) {
    await tx.reportComment.delete({ where: { commentId } });
    return "HARD";
  }

  await tx.reportComment.update({
    where: { commentId },
    data: { deletedAt: new Date() },
  });
  return "SOFT";
}

/**
 * 댓글 경로의 보고를 읽는다. 없으면 404. (열람·댓글 권한 판정용)
 *
 * 상급자 판정에 작성자의 `managerId` 가 필요해 관계로 함께 읽는다. 호출 측이
 * `assertReportViewable`·`assertCanComment` 로 판정한다.
 */
export async function findReportForComment(
  client: Prisma.TransactionClient,
  reportId: bigint,
) {
  const report = await client.dailyReport.findUnique({
    where: { reportId },
    select: {
      repId: true,
      status: true,
      rep: { select: { managerId: true } },
    },
  });

  if (!report) {
    throw new NotFoundError("보고를 찾을 수 없습니다.");
  }

  return report;
}
