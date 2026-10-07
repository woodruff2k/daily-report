"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getReport,
  reportErrorMessage,
  withdrawReport,
  type ReportDetail,
} from "@/lib/client/report-api";
import { formatUpdatedAt } from "@/lib/client/report-format";
import { useApiErrors } from "@/lib/client/use-api-errors";
import { getStoredRep } from "@/lib/client/auth-storage";
import { ReportComments } from "./report-comments";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  SUBMITTED: "제출",
};
const VISIT_TYPE_LABEL: Record<string, string> = {
  VISIT: "방문",
  CALL: "전화",
  ONLINE: "온라인",
};
const PROBLEM_STATUS_LABEL: Record<string, string> = {
  OPEN: "진행",
  CLOSED: "완료",
};

/**
 * SCR-220 일일보고 상세·조회 (읽기 전용) + 댓글.
 *
 * **[수정]·[회수] 버튼 숨김·댓글 입력창 숨김은 접근통제가 아니다.** 서버가 조회는
 * 본인·직속 상급자로, 수정은 DRAFT 로, 회수는 작성자·SUBMITTED·댓글 0건으로
 * (403·409), 댓글은 관계로 다시 막는다.
 */
export default function ReportDetailPage() {
  const router = useRouter();
  const report = useApiErrors(reportErrorMessage);
  const params = useParams<{ reportId: string }>();
  const reportId = Number(params.reportId);

  /**
   * 상세는 **어느 보고의 것인지와 함께** 담는다. 상세 → 상세로 옮겨 갈 때 앞 보고의
   * 내용이 다음 URL 아래 남으면, 댓글 영역이 **새 reportId 와 앞 보고의 작성자·
   * 상태** 를 함께 받아 입력창이 틀린 작성자 기준으로 뜨거나 DRAFT 보고에 [답글]
   * 이 생긴다. 효과에서 지우지 않고 렌더에서 걸러낸다 — 효과 본문의 동기
   * setState 는 연쇄 렌더를 만들고(이 저장소의 lint 규칙이 막는다) 지우기 전
   * 한 프레임이 여전히 묵은 값으로 그려진다.
   */
  const [loaded, setLoaded] = useState<{
    reportId: number;
    data: ReportDetail;
  } | null>(null);
  const detail = loaded?.reportId === reportId ? loaded.data : null;
  const [error, setError] = useState<string | null>(null);
  // 댓글 유무(소프트 삭제 포함). null 은 모름. 어느 보고의 것인지와 함께 담는다 — 위 loaded 와 같은 이유.
  const [commentState, setCommentState] = useState<{
    reportId: number;
    hasComments: boolean | null;
  } | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentsKey, setCommentsKey] = useState(0);
  // 내 repId. 하이드레이션 때문에 마운트 뒤에 읽는다.
  const [myRepId, setMyRepId] = useState<number | null>(null);
  useEffect(() => {
    void Promise.resolve().then(() =>
      setMyRepId(getStoredRep()?.repId ?? null),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!Number.isInteger(reportId) || reportId <= 0) {
        setLoaded(null);
        setError("보고를 찾을 수 없습니다.");
        return;
      }
      try {
        const data = await getReport(reportId);
        if (cancelled) return;
        setError(null);
        setLoaded({ reportId, data });
      } catch (caught) {
        if (cancelled) return;
        // 조회 실패 시 묵은 데이터를 오류 옆에 남기지 않는다.
        setLoaded(null);
        setError(report(caught, "보고를 불러올 수 없습니다."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId, report]);

  const handleCommentsLoaded = useCallback(
    (hasComments: boolean | null) => setCommentState({ reportId, hasComments }),
    [reportId],
  );

  /**
   * 회수 뒤 상세를 서버 상태로 맞춘다. 실패해도 **기존 상세를 지우지 않는다**
   * (메인 로드와 달리) — 회수는 이미 끝났을 수 있어 화면 전체를 오류로 바꾸면
   * 틀린 안내가 된다. 먼저 난 오류(409 등)는 덮어쓰지 않는다.
   */
  async function refreshDetail(failureMessage: string) {
    try {
      const data = await getReport(reportId);
      setLoaded({ reportId, data });
    } catch (caught) {
      setActionError((prev) => prev ?? report(caught, failureMessage));
    }
  }

  async function handleWithdraw() {
    setWithdrawOpen(false);
    setWithdrawing(true);
    setActionError(null);
    // 댓글 유무를 다시 읽을 때까지 모른다고 두어 [회수] 를 숨긴다. 성공 직후·
    // 실패 직후 묵은 값으로 버튼이 다시 눌리는 것을 막는다.
    let ok = false;
    try {
      const result = await withdrawReport(reportId);
      ok = true;
      // 응답값을 바로 반영한다. 재조회가 끝나기 전에도 DRAFT 로 보인다.
      setLoaded((prev) =>
        prev?.reportId === reportId
          ? {
              reportId,
              data: {
                ...prev.data,
                status: result.status,
                submittedAt: result.submittedAt,
              },
            }
          : prev,
      );
    } catch (caught) {
      setActionError(report(caught, "회수할 수 없습니다."));
    }
    setCommentState({ reportId, hasComments: null });
    setCommentsKey((n) => n + 1);
    await refreshDetail(
      ok
        ? "회수했습니다. 최신 상태를 불러오지 못했습니다. 새로고침하세요."
        : "보고를 불러올 수 없습니다.",
    );
    setWithdrawing(false);
  }

  if (detail === null) {
    return (
      <section>
        <h1 className="mb-6 text-xl font-semibold">일일보고 상세</h1>
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        )}
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold">일일보고 상세</h1>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/reports")}
          >
            목록
          </Button>
          {/*
            제출된 보고는 수정할 수 없고(서버 409 REPORT_LOCKED), **남의 보고도
            수정할 수 없다**(서버 403). 조회는 작성자와 그 직속 상급자 모두에게
            열려 있어 상급자가 팀원의 DRAFT 보고를 이 화면에서 볼 수 있다. 상태만
            보고 버튼을 두면 상급자가 편집 폼까지 들어가 입력한 뒤 저장에서야
            403 을 받는다 — 입력이 전부 사라진다. 작성자 본인에게만 둔다.
            **접근통제가 아니다.** 서버가 PUT 을 막는다.
          */}
          {detail.status === "DRAFT" && myRepId === detail.rep.repId ? (
            <Button
              type="button"
              onClick={() => router.push(`/reports/${reportId}/edit`)}
            >
              수정
            </Button>
          ) : null}
          {/*
            회수는 작성자 본인의 SUBMITTED 보고에 댓글이 **0건으로 확인될 때만**
            보인다. 서버가 소프트 삭제된 댓글도 1건으로 세므로 같은 기준을 쓴다
            (삭제된 댓글도 목록에 `deleted: true` 로 남는다). 건수를 아직 모르거나
            읽지 못했으면 숨긴다 — 보였다가 409 로 막히는 것보다 낫다.
            **접근통제가 아니다.** 서버가 403·409 로 다시 막는다.
          */}
          {detail.status === "SUBMITTED" &&
          myRepId === detail.rep.repId &&
          commentState?.reportId === reportId &&
          commentState.hasComments === false ? (
            <Button
              type="button"
              variant="secondary"
              disabled={withdrawing}
              onClick={() => {
                setActionError(null);
                setWithdrawOpen(true);
              }}
            >
              회수
            </Button>
          ) : null}
        </div>
      </div>
      {actionError === null ? null : (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {actionError}
        </p>
      )}
      <p className="mb-6 flex gap-6 text-sm">
        <span>보고일자: {detail.reportDate}</span>
        <span>작성자: {detail.rep.name}</span>
        <span>상태: {STATUS_LABEL[detail.status] ?? detail.status}</span>
        {detail.submittedAt ? (
          <span>제출: {formatUpdatedAt(detail.submittedAt)}</span>
        ) : null}
      </p>

      <div className="flex flex-col gap-8">
        <h2 className="-mb-6 text-base font-semibold">방문 기록</h2>
        <Table aria-label="방문 기록">
          <TableHeader>
            <TableRow>
              <TableHead>시각</TableHead>
              <TableHead>고객</TableHead>
              <TableHead>방문유형</TableHead>
              <TableHead>방문내용</TableHead>
              <TableHead>상담결과</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.visits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>방문 기록이 없습니다.</TableCell>
              </TableRow>
            ) : (
              detail.visits.map((visit) => (
                <TableRow key={visit.visitId}>
                  <TableCell>{visit.visitTime ?? "-"}</TableCell>
                  <TableCell>{visit.customer.customerName}</TableCell>
                  <TableCell>
                    {VISIT_TYPE_LABEL[visit.visitType] ?? visit.visitType}
                  </TableCell>
                  <TableCell className="whitespace-pre-wrap">
                    {visit.content}
                  </TableCell>
                  <TableCell>{visit.result ?? "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <h2 className="-mb-6 text-base font-semibold">과제/상담</h2>
        <Table aria-label="과제/상담">
          <TableHeader>
            <TableRow>
              <TableHead>관련고객</TableHead>
              <TableHead>내용</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.problems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>과제/상담이 없습니다.</TableCell>
              </TableRow>
            ) : (
              detail.problems.map((problem) => (
                <TableRow key={problem.problemId}>
                  <TableCell>{problem.customer?.customerName ?? "-"}</TableCell>
                  <TableCell className="whitespace-pre-wrap">
                    {problem.content}
                  </TableCell>
                  <TableCell>
                    {PROBLEM_STATUS_LABEL[problem.status] ?? problem.status}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <h2 className="-mb-6 text-base font-semibold">내일 할 일</h2>
        <Table aria-label="내일 할 일">
          <TableHeader>
            <TableRow>
              <TableHead>관련고객</TableHead>
              <TableHead>예정일</TableHead>
              <TableHead>내용</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.plans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>내일 할 일이 없습니다.</TableCell>
              </TableRow>
            ) : (
              detail.plans.map((plan) => (
                <TableRow key={plan.planId}>
                  <TableCell>{plan.customer?.customerName ?? "-"}</TableCell>
                  <TableCell>{plan.plannedDate ?? "-"}</TableCell>
                  <TableCell className="whitespace-pre-wrap">
                    {plan.content}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ReportComments
        key={commentsKey}
        reportId={reportId}
        authorRepId={detail.rep.repId}
        submitted={detail.status === "SUBMITTED"}
        onLoaded={handleCommentsLoaded}
      />

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>제출을 회수할까요?</DialogTitle>
            <DialogDescription>
              보고가 작성중으로 돌아가 다시 수정할 수 있습니다. 다시 제출하면
              제출 시각은 새로 기록되고 처음 제출한 시각은 남지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setWithdrawOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={withdrawing}
              onClick={() => void handleWithdraw()}
            >
              회수 확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
