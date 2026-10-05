"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getStoredRep } from "@/lib/client/auth-storage";
import {
  commentErrorMessage,
  createComment,
  deleteComment,
  listComments,
  updateComment,
  type CommentItem,
  type CommentThread,
} from "@/lib/client/comment-api";
import { formatUpdatedAt } from "@/lib/client/report-format";
import { useApiErrors } from "@/lib/client/use-api-errors";

/** 삭제된 댓글의 표시 문구. 서버는 문구를 주지 않는다 — 화면이 정한다(SCR-220). */
export const DELETED_PLACEHOLDER = "삭제된 댓글입니다";

interface Props {
  reportId: number;
  /** 보고 작성자. 상세 응답의 `rep.repId`. */
  authorRepId: number;
  /** 댓글은 SUBMITTED 보고에만 달린다. DRAFT 면 서버가 409 로 막는다. */
  submitted: boolean;
}

/**
 * SCR-220 댓글 영역.
 *
 * **댓글 권한은 역할이 아니라 관계다.** 서버(`assertCanComment`)는
 * `작성자의 직속 상급자` 이거나 `작성자 본인의 대댓글` 일 때만 허용한다. MANAGER
 * 역할이어도 직속 상급자가 아니면 403 이다. 화면은 이것을 이렇게 추론한다.
 *
 *   - 보고 조회도 같은 관계(본인 또는 직속 상급자)로 제한된다. 그러므로 상세가
 *     로드됐고 내 repId 가 작성자와 다르면 나는 **직속 상급자**다 → 루트 댓글 가능.
 *   - 내 repId 가 작성자와 같으면 나는 작성자다 → `[답글]` 로 대댓글만.
 *
 * 조직 구조를 새로 노출하지 않고도 맞게 갈린다. **이것은 접근통제가 아니다.**
 * 입력창을 가려도, 우회해서 호출해도 서버가 403 으로 다시 막는다.
 */
export function ReportComments({ reportId, authorRepId, submitted }: Props) {
  const toMessage = useApiErrors(commentErrorMessage);
  // 하이드레이션: 저장소 값은 초기 상태가 아니라 효과 안에서 읽는다.
  const [myRepId, setMyRepId] = useState<number | null>(null);
  const [threads, setThreads] = useState<CommentThread[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [rootText, setRootText] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  // 느린 응답이 나중 요청의 결과를 덮어쓰지 않게 한다.
  const latest = useRef(0);

  useEffect(() => {
    void Promise.resolve().then(() =>
      setMyRepId(getStoredRep()?.repId ?? null),
    );
  }, []);

  /** 목록을 다시 읽는다. 실패하면 묵은 목록을 오류 옆에 남기지 않는다. */
  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const data = await listComments(reportId);
      if (ticket !== latest.current) return;
      setThreads(data);
      setLoadError(null);
    } catch (caught) {
      if (ticket !== latest.current) return;
      setThreads(null);
      setLoadError(toMessage(caught, "댓글을 불러올 수 없습니다."));
    }
  }, [reportId, toMessage]);

  useEffect(() => {
    // 효과 본문에서 동기 setState 를 피하려고 한 틱 뒤에 부른다(react-hooks/set-state-in-effect).
    void Promise.resolve().then(reload);
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  const isViewerAuthor = myRepId !== null && myRepId === authorRepId;
  // 작성자가 아닌 뷰어 = 직속 상급자(위 주석). 내가 누구인지 모르면 숨긴다.
  const canWriteRoot = submitted && myRepId !== null && !isViewerAuthor;
  // 답글은 상급자·작성자 모두 쓴다. 루트에만, 삭제되지 않은 댓글에만 둔다.
  const canReply = submitted && myRepId !== null;

  /** 쓰기 호출 공통. 성공이든 실패든 목록을 다시 읽어 화면을 서버와 맞춘다. */
  async function mutate(
    action: () => Promise<unknown>,
    fallback: string,
  ): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (caught) {
      setActionError(toMessage(caught, fallback));
      // 부모가 그 사이 삭제됐을 수 있다. 다시 읽어야 버튼이 사라진다.
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitRoot() {
    if (rootText.trim() === "") {
      setActionError("댓글 내용을 입력하세요.");
      return;
    }
    if (
      await mutate(
        () => createComment(reportId, rootText.trim()),
        "댓글을 등록할 수 없습니다.",
      )
    ) {
      setRootText("");
    }
  }

  async function submitReply(parentId: number) {
    if (replyText.trim() === "") {
      setActionError("답글 내용을 입력하세요.");
      return;
    }
    if (
      await mutate(
        () => createComment(reportId, replyText.trim(), parentId),
        "답글을 등록할 수 없습니다.",
      )
    ) {
      setReplyTo(null);
      setReplyText("");
    }
  }

  async function submitEdit(commentId: number) {
    if (editText.trim() === "") {
      setActionError("댓글 내용을 입력하세요.");
      return;
    }
    if (
      await mutate(
        () => updateComment(reportId, commentId, editText.trim()),
        "댓글을 수정할 수 없습니다.",
      )
    ) {
      setEditing(null);
      setEditText("");
    }
  }

  async function confirmDelete() {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await mutate(
      () => deleteComment(reportId, target),
      "댓글을 삭제할 수 없습니다.",
    );
  }

  function renderBody(comment: CommentItem, isRoot: boolean) {
    if (comment.deleted) {
      // 작성자·내용이 없다. 버튼도 없다(서버가 404·400 으로 막는다). 시각은 남긴다.
      return (
        <article aria-label={`댓글 ${comment.commentId}`} className="py-2">
          <p className="text-sm text-muted-foreground italic">
            {DELETED_PLACEHOLDER}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatUpdatedAt(comment.createdAt)}
          </p>
        </article>
      );
    }
    const mine = myRepId !== null && comment.commenter.repId === myRepId;
    const isEditing = editing === comment.commentId;
    return (
      <article aria-label={`댓글 ${comment.commentId}`} className="py-2">
        <p className="text-sm">
          <strong>{comment.commenter.name}</strong>{" "}
          <span className="text-xs text-muted-foreground">
            {formatUpdatedAt(comment.createdAt)}
          </span>
        </p>
        {isEditing ? (
          <div className="mt-1 flex flex-col gap-2">
            <Textarea
              aria-label="댓글 수정 내용"
              value={editText}
              onChange={(e) => {
                setActionError(null);
                setEditText(e.target.value);
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void submitEdit(comment.commentId)}
              >
                저장
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setEditing(null)}
              >
                취소
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm whitespace-pre-wrap">{comment.content}</p>
        )}
        {isEditing ? null : (
          <div className="mt-1 flex gap-2">
            {isRoot && canReply ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="답글"
                onClick={() => {
                  setActionError(null);
                  setReplyTo(comment.commentId);
                  setReplyText("");
                }}
              >
                답글
              </Button>
            ) : null}
            {mine ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="댓글 수정"
                  onClick={() => {
                    setActionError(null);
                    setEditing(comment.commentId);
                    setEditText(comment.content);
                  }}
                >
                  수정
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="댓글 삭제"
                  onClick={() => setDeleteTarget(comment.commentId)}
                >
                  삭제
                </Button>
              </>
            ) : null}
          </div>
        )}
        {isRoot && replyTo === comment.commentId ? (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea
              aria-label="답글 내용"
              value={replyText}
              onChange={(e) => {
                setActionError(null);
                setReplyText(e.target.value);
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void submitReply(comment.commentId)}
              >
                답글 등록
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setReplyTo(null)}
              >
                답글 취소
              </Button>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <section aria-labelledby="comments-title" className="mt-10">
      <h2 id="comments-title" className="mb-3 text-base font-semibold">
        댓글 / 상급자 의견
      </h2>

      {loadError !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : threads === null ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">댓글이 없습니다.</p>
      ) : (
        <ul className="flex flex-col">
          {threads.map((thread) => (
            <li key={thread.commentId} className="border-b">
              {renderBody(thread, true)}
              {thread.replies.length > 0 ? (
                <ul className="ml-6 border-l pl-4">
                  {thread.replies.map((reply) => (
                    <li key={reply.commentId}>{renderBody(reply, false)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {actionError === null ? null : (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {canWriteRoot ? (
        <div className="mt-4 flex flex-col gap-2">
          <Textarea
            aria-label="댓글 내용"
            value={rootText}
            onChange={(e) => {
              setActionError(null);
              setRootText(e.target.value);
            }}
          />
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void submitRoot()}
            >
              등록
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>댓글을 삭제할까요?</DialogTitle>
            <DialogDescription>
              답글이 달린 댓글은 &quot;{DELETED_PLACEHOLDER}&quot; 로 남습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
