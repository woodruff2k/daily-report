"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CustomerPicker } from "@/components/customer-picker";
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
import { customerErrorMessage } from "@/lib/client/customer-api";
import {
  listTeamReports,
  reportErrorMessage,
  type TeamReportListItem,
} from "@/lib/client/report-api";
import { defaultRange, formatUpdatedAt } from "@/lib/client/report-format";
import { listTeamOptions, type TeamOption } from "@/lib/client/sales-rep-api";
import type { CustomerRef } from "@/lib/client/report-form";
import { useApiErrors } from "@/lib/client/use-api-errors";

const PAGE_SIZE = 20;
const FALLBACK = "목록을 불러올 수 없습니다.";
const TEAM_FALLBACK = "팀원 목록을 불러올 수 없습니다.";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  SUBMITTED: "제출",
};

interface Applied {
  repIds: number[];
  fromDate: string;
  toDate: string;
  customerId: number | null;
  status: string;
}

/**
 * SCR-300 팀 보고 조회. 상급자가 직속 팀원의 보고를 검색한다.
 *
 * 헤더는 `role === "MANAGER"` 일 때만 이 메뉴를 보여주지만 **URL 을 직접 치면
 * 들어온다.** 서버가 403 으로 막고(`assertAnyRole(auth, ["MANAGER"])`) 화면은 그
 * 문장만 보여준다 — **화면 숨김은 접근통제가 아니다.** 403 은 이동시키지 않고
 * 401 만 로그인으로 보낸다(`useApiErrors`).
 *
 * 팀원 선택지는 `/api/sales-reps/team`(명세 6.7)에서 온다. 전사 목록(6.6)을 쓰면
 * 팀원이 아닌 사람을 고를 수 있고 고르면 403 이다.
 */
export default function TeamReportsPage() {
  const report = useApiErrors(reportErrorMessage);
  // 고객 검색은 고객 API 를 부른다. 보고 문장을 넘기면 틀린 안내가 나간다.
  const customerToMessage = useApiErrors(customerErrorMessage);

  const [team, setTeam] = useState<TeamOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [repIds, setRepIds] = useState<number[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [customer, setCustomer] = useState<CustomerRef | null>(null);
  const [status, setStatus] = useState("");

  // 적용된 필터. 입력 중인 값이 아니라 [검색] 을 누른 값으로 페이지를 넘긴다.
  // null 은 아직 기본 기간을 정하지 않은 상태(첫 조회 전)다.
  const [applied, setApplied] = useState<Applied | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  const [reports, setReports] = useState<TeamReportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // "아직 안 불렀음" 과 "결과 없음" 을 구분한다. 안 하면 첫 렌더에 "조회 결과가
  // 없습니다" 가 뜬다.
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  // 기본 기간은 "오늘" 에 달려 있어 서버 렌더링과 어긋난다. 마운트 뒤에 정한다.
  // 효과 본문에서 동기 setState 를 피하려고 마이크로태스크 뒤에서 바꾼다
  // (react-hooks/set-state-in-effect, reports/page.tsx 와 같은 이유).
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const { from, to } = defaultRange();
      setFromDate(from);
      setToDate(to);
      setApplied({
        repIds: [],
        fromDate: from,
        toDate: to,
        customerId: null,
        status: "",
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const options = await listTeamOptions();
        if (cancelled) return;
        setTeam(options);
        setOptionsError(null);
      } catch (caught) {
        if (cancelled) return;
        setTeam([]);
        setOptionsError(report(caught, TEAM_FALLBACK));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report]);

  useEffect(() => {
    if (applied === null) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const result = await listTeamReports({
          repIds: applied.repIds,
          fromDate: applied.fromDate,
          toDate: applied.toDate,
          status: applied.status,
          ...(applied.customerId === null
            ? {}
            : { customerId: applied.customerId }),
          page: pageIndex,
          size: PAGE_SIZE,
          sort: "reportDate,desc",
        });
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

  function toggleRep(repId: number, checked: boolean) {
    setRepIds((prev) =>
      checked ? [...prev, repId] : prev.filter((id) => id !== repId),
    );
  }

  function search() {
    // 로딩 표시는 조회 효과가 켠다 — 첫 로드와 페이지 이동에도 보여야 한다.
    // 필터를 바꾸면 0 페이지로. 안 되돌리면 뒤쪽 페이지에서 빈 화면이 나온다.
    setPageIndex(0);
    setApplied({
      repIds: [...repIds].sort((a, b) => a - b),
      fromDate,
      toDate,
      customerId: customer?.customerId ?? null,
      status,
    });
  }

  const shownError = error ?? optionsError;

  return (
    <section>
      <h1 className="mb-6 text-xl font-semibold">팀 보고 조회</h1>

      {shownError !== null ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {shownError}
        </p>
      ) : null}

      <form
        className="mb-6 flex flex-wrap items-start gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 font-medium">팀원</legend>
          {/*
            안내 문구는 **고를 것이 있을 때** 보여야 한다. 체크를 모두 비우는 것이
            무슨 뜻인지 알려 주는 문구이기 때문이다. 팀원이 없을 때는 "팀 전체를
            조회합니다" 가 거짓이고(조회할 팀원이 없다) 왜 표가 비는지도 설명하지
            못한다. 목록을 못 불러온 경우는 위의 알림이 사유를 말하므로 여기서
            "팀원이 없습니다" 라고 단정하지 않는다.
          */}
          {team.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              선택하지 않으면 팀 전체를 조회합니다.
            </p>
          ) : optionsError === null ? (
            <p className="text-xs text-muted-foreground">팀원이 없습니다.</p>
          ) : null}
          {team.map((member) => (
            <label key={member.repId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={repIds.includes(member.repId)}
                onChange={(event) =>
                  toggleRep(member.repId, event.target.checked)
                }
              />
              {member.status === "INACTIVE"
                ? `${member.name} (비활성)`
                : member.name}
            </label>
          ))}
        </fieldset>

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

        <div className="flex w-56 flex-col gap-1 text-sm">
          <span className="font-medium">방문 고객</span>
          {/*
            검색이므로 비활성 고객도 찾는다. 마스터를 지우지 않고 비활성화하는
            이유가 과거 보고와의 참조 유지(NFR-03)인데, 그 고객으로 필터할 수
            없으면 보존한 이력에 닿을 수 없다. 서버의 customerId 필터에도 상태
            제약이 없다. 입력 화면(SCR-210)은 활성 고객만 고른다 — 그쪽은 새
            방문을 남기는 자리라 기본값을 그대로 쓴다.
          */}
          <CustomerPicker
            label="고객"
            value={customer}
            onChange={setCustomer}
            toMessage={customerToMessage}
            includeInactive
          />
        </div>

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

        <Button type="submit" className="mt-6" disabled={loading}>
          {/* 다른 목록 화면(SCR-200·400·500)과 같은 진행 표시. 비활성만으로는
              조회가 돌고 있는지 알 수 없다. */}
          {loading ? "검색 중…" : "검색"}
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>작성자</TableHead>
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
              <TableCell colSpan={7}>
                {/*
                  조회가 실패한 것은 "결과가 없는" 것이 아니다. 오류 알림 옆에
                  "조회 결과가 없습니다" 를 붙이면 거짓을 말한다 — 질의가 거절된
                  것이지 비어 있는 것이 아니다. loaded 만 보면 finally 에서 켜지므로
                  실패도 "불러왔다" 로 읽힌다.
                */}
                {shownError !== null
                  ? "조회할 수 없습니다."
                  : loaded
                    ? "조회 결과가 없습니다."
                    : "불러오는 중…"}
              </TableCell>
            </TableRow>
          ) : (
            reports.map((item) => (
              <TableRow key={item.reportId}>
                <TableCell>{item.rep.name}</TableCell>
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
          {/*
            조회가 실패하면 totalPages 는 0 이 되는데 pageIndex 는 그대로 남는다
            (0 으로 되돌리면 효과가 다시 돌아 같은 실패를 반복한다). 그대로 쓰면
            "3 / 1 페이지" 처럼 뜻이 없는 값이 보인다. 실패 중에는 쪽수를 감춘다.
          */}
          {shownError !== null
            ? "-"
            : `${pageIndex + 1} / ${Math.max(totalPages, 1)} 페이지`}
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
