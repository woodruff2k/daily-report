"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isUnauthorized } from "@/lib/client/api-client";
import { customerErrorMessage, getCustomer } from "@/lib/client/customer-api";
import {
  getReport,
  reportErrorMessage,
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
 * **[수정] 버튼 숨김·댓글 입력창 숨김은 접근통제가 아니다.** 서버가 조회는
 * 본인·직속 상급자로, 수정은 DRAFT 로, 댓글은 관계로 다시 막는다.
 */
export default function ReportDetailPage() {
  const router = useRouter();
  const report = useApiErrors(reportErrorMessage);
  // 이름 조회는 고객 API 다. 보고 문장을 쓰면 틀린 안내가 나간다(#13 검토).
  const customer = useApiErrors(customerErrorMessage);
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
  // 고객 id → 이름. 과제·계획 응답에는 이름이 없어 직접 채운다.
  const [nameCache, setNameCache] = useState<{
    reportId: number;
    byId: Record<number, string>;
  } | null>(null);
  const names = nameCache?.reportId === reportId ? nameCache.byId : {};

  /** 과제·계획의 고객 이름을 뒤에서 채운다. 화면을 막지 않고 받는 대로 그 칸만 바꾼다. */
  const resolveNames = useCallback(
    async (ids: number[], isCancelled: () => boolean) => {
      await Promise.all(
        ids.map(async (id) => {
          try {
            const found = await getCustomer(id);
            if (isCancelled()) return;
            setNameCache((prev) =>
              prev === null
                ? prev
                : { ...prev, byId: { ...prev.byId, [id]: found.customerName } },
            );
          } catch (caught) {
            // 실패하면 그 칸만 `고객 #id` 로 둔다. 401 은 세션이 끊긴 것이라 삼키지 않는다.
            if (isUnauthorized(caught)) {
              customer(caught, "");
            }
          }
        }),
      );
    },
    [customer],
  );

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
        const known: Record<number, string> = {};
        for (const visit of data.visits) {
          known[visit.customer.customerId] = visit.customer.customerName;
        }
        setNameCache({ reportId, byId: known });
        const missing = new Set<number>();
        for (const row of [...data.problems, ...data.plans]) {
          if (row.customerId !== null && !(row.customerId in known)) {
            missing.add(row.customerId);
          }
        }
        // 먼저 그리고 이름은 뒤에서 채운다. await 하지 않는다.
        void resolveNames([...missing], () => cancelled);
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
  }, [reportId, report, resolveNames]);

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

  const nameOf = (id: number | null) =>
    id === null ? "-" : (names[id] ?? `고객 #${id}`);

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
        </div>
      </div>
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
                  <TableCell>{nameOf(problem.customerId)}</TableCell>
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
                  <TableCell>{nameOf(plan.customerId)}</TableCell>
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
        reportId={reportId}
        authorRepId={detail.rep.repId}
        submitted={detail.status === "SUBMITTED"}
      />
    </section>
  );
}
