import { apiFetch, ApiClientError } from "./api-client";

/** 화면이 쓰는 댓글 타입과 호출. (이슈 #14, API 명세 4.1~4.3) */

interface CommentBase {
  commentId: number;
  parentCommentId: number | null;
  /** ISO 문자열. 삭제된 댓글에도 남는다(스레드 순서). */
  createdAt: string;
}

export interface LiveComment extends CommentBase {
  deleted: false;
  commenter: { repId: number; name: string };
  content: string;
}

/**
 * 소프트 삭제된 댓글. `content`·`commenter` 키가 **없다**(명세 4.1).
 * 옵셔널 필드가 아니라 유니온이라 `deleted` 로 좁혀야 내용에 접근할 수 있다.
 */
export interface DeletedComment extends CommentBase {
  deleted: true;
}

export type CommentItem = LiveComment | DeletedComment;
export type CommentThread = CommentItem & { replies: CommentItem[] };

export function listComments(reportId: number) {
  return apiFetch<CommentThread[]>(`/api/reports/${reportId}/comments`);
}

/** 응답은 생성된 댓글 하나뿐이고 `replies` 트리가 없다. 호출한 쪽이 목록을 다시 읽는다. */
export function createComment(
  reportId: number,
  content: string,
  parentCommentId: number | null = null,
) {
  return apiFetch<LiveComment>(`/api/reports/${reportId}/comments`, {
    method: "POST",
    body: { content, parentCommentId },
  });
}

export function updateComment(
  reportId: number,
  commentId: number,
  content: string,
) {
  return apiFetch<LiveComment>(
    `/api/reports/${reportId}/comments/${commentId}`,
    { method: "PUT", body: { content } },
  );
}

/** 204 다. 행이 사라졌는지 자리표시자로 남았는지 응답으로는 알 수 없다. */
export function deleteComment(reportId: number, commentId: number) {
  return apiFetch<void>(`/api/reports/${reportId}/comments/${commentId}`, {
    method: "DELETE",
  });
}

export const COMMENT_FORBIDDEN_MESSAGE =
  "이 보고에 대한 댓글 권한이 없습니다. 작성자의 직속 상급자만 댓글을 쓸 수 있고, 작성자는 답글만 쓸 수 있습니다.";

const CODE_MESSAGE: Record<string, string> = {
  REPORT_NOT_SUBMITTED: "제출되지 않은 보고에는 댓글을 작성할 수 없습니다.",
  PARENT_IS_REPLY: "답글에는 다시 답글을 달 수 없습니다.",
  PARENT_DELETED: "삭제된 댓글에는 답글을 달 수 없습니다.",
  PARENT_NOT_IN_REPORT: "답글을 달 댓글을 찾을 수 없습니다.",
  NOT_FOUND: "댓글을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.",
};

/**
 * 댓글 호출의 오류 문장. 코드를 먼저 보고, 그 밖의 403 은 권한 문장으로 둔다.
 * INVALID_REQUEST 는 내용이 비었거나 2000자를 넘은 경우다.
 */
export function commentErrorMessage(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) {
    return fallback;
  }
  const byCode = CODE_MESSAGE[caught.code];
  if (byCode) {
    return byCode;
  }
  if (caught.code === "INVALID_REQUEST") {
    return "댓글 내용을 입력하세요. (최대 2000자)";
  }
  // 403 은 서버가 조건별로 정확한 문장을 준다 — 역할 불일치("이 작업을 수행할
  // 권한이 없습니다"), 조회 범위 밖("해당 보고에 접근할 권한이 없습니다"), 댓글
  // 작성 권한, 본인 댓글 아님이 모두 코드 `FORBIDDEN` 하나에 담겨 온다. 화면이
  // 한 문장으로 덮으면 **맞지 않는 안내가 나간다** — 상급자가 조회 범위 밖의
  // 보고를 열었을 때 "영업사원·상급자만 쓸 수 있습니다" 는 사실이 아니다.
  // 그래서 서버 문장을 쓰고, 서버가 문장을 주지 않을 때만 기본 문구로 돌아간다.
  if (caught.status === 403) {
    return caught.message || COMMENT_FORBIDDEN_MESSAGE;
  }
  return fallback;
}
