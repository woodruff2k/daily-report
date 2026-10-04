"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { ApiClientError } from "@/lib/client/api-client";
import { listSalesReps, type SalesRepListItem } from "@/lib/client/sales-rep-api";
import { useAdminRedirect } from "@/lib/client/use-admin-guard";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "활성",
  INACTIVE: "비활성",
};

const ROLE_LABEL: Record<string, string> = {
  SALES_REP: "영업사원",
  MANAGER: "상급자",
  ADMIN: "관리자",
};

/** SCR-500 영업 마스터 목록. 관리자 전용. */
export default function SalesRepListPage() {
  useAdminRedirect();
  const [keyword, setKeyword] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [reps, setReps] = useState<SalesRepListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listSalesReps({ keyword, department, status, size: 50 });
      setReps(page.content);
      setTotal(page.totalElements);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "목록을 불러올 수 없습니다."
      );
    } finally {
      setLoading(false);
    }
  }, [keyword, department, status]);

  // 최초 1회만 불러온다. 이후는 [검색] 으로 다시 부른다.
  //
  // search() 를 그대로 부르지 않는 이유는 그 함수가 동기적으로 setLoading 을
  // 호출하기 때문이다. 효과 본문에서의 동기 setState 는 렌더 직후 추가 렌더를
  // 만들어 react-hooks/set-state-in-effect 가 막는다. 여기서는 await 뒤에만
  // 상태를 바꾼다.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const page = await listSalesReps({ size: 50 }).catch(() => null);

      if (cancelled) {
        return;
      }

      if (page === null) {
        setError("목록을 불러올 수 없습니다.");
        return;
      }

      setReps(page.content);
      setTotal(page.totalElements);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">영업 마스터</h1>
        <Link href="/sales-reps/new" className={buttonVariants()}>
          + 신규 등록
        </Link>
      </div>

      <form
        className="mb-6 flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Field className="w-48">
          <FieldLabel htmlFor="keyword">이름/사번</FieldLabel>
          <Input
            id="keyword"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Field>

        <Field className="w-40">
          <FieldLabel htmlFor="department">부서</FieldLabel>
          <Input
            id="department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
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
            <option value="ACTIVE">활성</option>
            <option value="INACTIVE">비활성</option>
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
            <TableHead>사번</TableHead>
            <TableHead>이름</TableHead>
            <TableHead>부서</TableHead>
            <TableHead>직급</TableHead>
            <TableHead>상급자</TableHead>
            <TableHead>역할</TableHead>
            <TableHead>상태</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {reps.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8}>조회 결과가 없습니다.</TableCell>
            </TableRow>
          ) : (
            reps.map((rep) => (
              <TableRow key={rep.repId}>
                <TableCell>{rep.empNo}</TableCell>
                <TableCell>{rep.name}</TableCell>
                <TableCell>{rep.department ?? "-"}</TableCell>
                <TableCell>{rep.position ?? "-"}</TableCell>
                <TableCell>{rep.managerName ?? "-"}</TableCell>
                <TableCell>{ROLE_LABEL[rep.role] ?? rep.role}</TableCell>
                <TableCell>{STATUS_LABEL[rep.status] ?? rep.status}</TableCell>
                <TableCell>
                  <Link
                    href={`/sales-reps/${rep.repId}/edit`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    수정
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <p className="mt-4 text-sm text-muted-foreground">총 {total}건</p>
    </section>
  );
}
