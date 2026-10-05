"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createReport,
  isReportAlreadyExists,
  listReports,
  reportErrorMessage,
  type ReportFilters,
  type ReportListItem,
} from "@/lib/client/report-api";
import {
  defaultRange,
  formatDate,
  formatUpdatedAt,
} from "@/lib/client/report-format";
import { useApiErrors } from "@/lib/client/use-api-errors";

const PAGE_SIZE = 20;
const FALLBACK = "목록을 불러올 수 없습니다.";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  SUBMITTED: "제출",
};

/**
 * SCR-200 일일보고 목록. 영업사원·상급자용 본인 보고.
 *
 * 필터는 서버 쿼리로 넘긴다. 관리자는 서버가 403 으로 막는다 — 화면 숨김은
 * 접근통제가 아니다. 보고 상세·편집(`/reports/{id}`, `/reports/{id}/edit`)은 각각
 * #14·#13 이 만든다. 그 전에는 링크가 404 로 간다.
 */
export default function ReportListPage() {
  const router = useRouter();
  const report = useApiErrors(reportErrorMessage);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("");
  // 적용된 필터. 입력 중인 값이 아니라 [검색] 을 누른 값으로 페이지를 넘긴다.
  // null 은 아직 기본 기간을 정하지 않은 상태(첫 조회 전)다.
  const [applied, setApplied] = useState<{
    fromDate: string;
    toDate: string;
    status: string;
  } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // null 은 "아직 불러오지 않았다" 다. 빈 배열("결과 없음")과 구분해야 한다 —
  // 구분하지 않으면 첫 렌더와 조회 실패에서 "조회 결과가 없습니다" 가 뜬다.
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // 기본 기간은 "오늘" 에 달려 있어 서버 렌더링 결과와 시간대가 다를 수 있다.
  // 초기 상태에 넣으면 하이드레이션이 어긋나므로 마운트 뒤에 정한다.
  // await 뒤에서 바꾸는 이유는 아래와 같다.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const range = defaultRange();
      setFromDate(range.from);
      setToDate(range.to);
      setApplied({ fromDate: range.from, toDate: range.to, status: "" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 효과 본문에서 동기 setState 를 피하려고 await 뒤에서만 상태를 바꾼다.
  // (react-hooks/set-state-in-effect, customers/page.tsx 와 같은 이유)
  useEffect(() => {
    if (applied === null) return;
    let cancelled = false;
    const filters: ReportFilters = {
      ...applied,
      page: pageIndex,
      size: PAGE_SIZE,
      sort: "reportDate,desc",
    };

    void (async () => {
      setLoading(true);
      try {
        const result = await listReports(filters);
        if (cancelled) return;
        setReports(result.content);
        setTotal(result.totalElements);
        setTotalPages(result.totalPages);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        // 묵은 결과를 오류 옆에 남기지 않는다. 남기면 지금 필터와 맞지 않는 행과
        // 건수가 그대로 보이고, 다음 버튼이 없어진 결과 집합을 넘긴다.
        setReports([]);
        setTotal(0);
        setTotalPages(0);
        setError(report(caught, FALLBACK));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applied, pageIndex, report]);

  function search() {
    // 로딩 표시는 조회 효과가 켠다 — 첫 로드와 페이지 이동에도 보여야 한다.
    // 필터를 바꾸면 0 페이지로. 안 되돌리면 뒤쪽 페이지에서 빈 화면이 나온다.
    setPageIndex(0);
    setApplied({ fromDate, toDate, status });
  }

  const createToday = useCallback(async () => {
    setCreating(true);
    setError(null);
    const today = formatDate(new Date());
    try {
      const created = await createReport(today);
      // 이동이 막히거나 취소되면 버튼이 영구히 비활성으로 남는다.
      setCreating(false);
      router.push(`/reports/${created.reportId}/edit`);
    } catch (caught) {
      if (!isReportAlreadyExists(caught)) {
        setError(report(caught, "보고를 작성할 수 없습니다."));
        setCreating(false);
        return;
      }
      // 이미 있는 것은 오류가 아니다. 오늘자 보고를 찾아 그리로 보낸다.
      try {
        const found = await listReports({ fromDate: today, toDate: today });
        const existing = found.content[0];
        if (existing) {
          // 제출된 보고는 작성 화면으로 보내지 않는다. SCR-210 은 DRAFT 전용이고
          // 서버의 lockDraftReport 가 저장을 409 REPORT_LOCKED 로 막으므로,
          // 저장할 수 없는 화면에 데려다 놓는 셈이 된다.
          setCreating(false);
          router.push(
            existing.status === "SUBMITTED"
              ? `/reports/${existing.reportId}`
              : `/reports/${existing.reportId}/edit`,
          );
          return;
        }
        setError("오늘자 보고를 찾을 수 없습니다.");
      } catch (lookup) {
        setError(report(lookup, "오늘자 보고를 찾을 수 없습니다."));
      }
      setCreating(false);
    }
  }, [report, router]);

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">일일보고 목록</h1>
        <Button
          type="button"
          disabled={creating}
          onClick={() => void createToday()}
        >
          + 오늘 보고 작성
        </Button>
      </div>

      <form
        className="mb-6 flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <Field className="w-40">
          <FieldLabel htmlFor="fromDate">시작일</FieldLabel>
          <Input
            id="fromDate"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </Field>

        <Field className="w-40">
          <FieldLabel htmlFor="toDate">종료일</FieldLabel>
          <Input
            id="toDate"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </Field>

        <Field className="w-32">
          <FieldLabel htmlFor="status">상태</FieldLabel>
          <select
            id="status"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">전체</option>
            <option value="DRAFT">작성중</option>
            <option value="SUBMITTED">제출</option>
          </select>
        </Field>

        <Button type="submit" variant="secondary" disabled={loading}>
          {loading ? "검색 중…" : "검색"}
        </Button>
      </form>

      {error === null ? null : (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>보고일자</TableHead>
            <TableHead>방문건수</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>댓글</TableHead>
            <TableHead>최종수정</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>
                {loaded ? "조회 결과가 없습니다." : "불러오는 중…"}
              </TableCell>
            </TableRow>
          ) : (
            reports.map((item) => (
              <TableRow key={item.reportId}>
                <TableCell>{item.reportDate}</TableCell>
                <TableCell>{item.visitCount}</TableCell>
                <TableCell>
                  {/* 고객 화면과 같은 방식(span 알약). Badge 통일은 별도 정리. */}
                  <span
                    className={
                      item.status === "SUBMITTED"
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800"
                        : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    }
                  >
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </TableCell>
                <TableCell>{item.commentCount}</TableCell>
                <TableCell>{formatUpdatedAt(item.updatedAt)}</TableCell>
                <TableCell>
                  <Link
                    href={`/reports/${item.reportId}`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    상세
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
        <span>총 {total}건</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex <= 0}
          onClick={() => setPageIndex((value) => value - 1)}
        >
          이전
        </Button>
        <span>
          {pageIndex + 1} / {Math.max(totalPages, 1)} 페이지
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex + 1 >= totalPages}
          onClick={() => setPageIndex((value) => value + 1)}
        >
          다음
        </Button>
      </div>
    </section>
  );
}
