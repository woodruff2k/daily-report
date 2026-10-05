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
import {
  listCustomers,
  listSalesRepOptions,
  type CustomerFilters,
  type CustomerListItem,
  type SalesRepOption,
} from "@/lib/client/customer-api";
import { GRADES } from "./customer-form";
import { useCustomerErrors } from "./use-customer-errors";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "활성",
  INACTIVE: "비활성",
};

const NOT_EDITABLE_REASON = "담당 영업과 그 상급자만 수정할 수 있습니다";

/**
 * SCR-400 고객 마스터 목록. 영업사원·상급자용.
 *
 * 검색은 서버 필터로 한다. 전부 받아 화면에서 거르면 페이지네이션에 걸려 빠지는
 * 항목이 생긴다. 목록 응답에는 `email`·`address` 가 없으므로(NFR-04) 그 컬럼을
 * 두지 않는다. 관리자는 서버가 403 으로 막는다 — 화면 숨김은 접근통제가 아니다.
 *
 * 목록은 전사 공개라 남의 고객도 보인다. [수정] 은 서버가 준 `editable` 로 가른다.
 * 행 단위로 다시 계산하지 않는다 — 상급자 판정에 필요한 담당 사원의 managerId 가
 * 응답에 없다. `editable: false` 는 링크를 없애지 않고 비활성 버튼으로 두어 이유를
 * 보인다. **`editable` 은 접근통제가 아니다** — 무시해도 PUT·PATCH 를 서버가 403 으로
 * 막는다. (이슈 #68)
 */
export default function CustomerListPage() {
  const report = useCustomerErrors();
  const [keyword, setKeyword] = useState("");
  const [assignedRepId, setAssignedRepId] = useState("");
  const [grade, setGrade] = useState("");
  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [options, setOptions] = useState<SalesRepOption[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters: CustomerFilters = {
      keyword,
      assignedRepId,
      grade,
      status,
      size: 50,
    };
    try {
      const page = await listCustomers(filters);
      setCustomers(page.content);
      setTotal(page.totalElements);
    } catch (caught) {
      setError(report(caught, "목록을 불러올 수 없습니다."));
    } finally {
      setLoading(false);
    }
  }, [keyword, assignedRepId, grade, status, report]);

  // 최초 1회만 불러온다. 이후는 [검색] 으로 다시 부른다.
  // 효과 본문에서 동기 setState 를 피하려고 await 뒤에서만 상태를 바꾼다.
  // (react-hooks/set-state-in-effect, sales-reps/page.tsx 와 같은 이유)
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [pageResult, optionResult] = await Promise.allSettled([
        listCustomers({ size: 50 }),
        listSalesRepOptions(),
      ]);

      if (cancelled) {
        return;
      }

      if (optionResult.status === "fulfilled") {
        setOptions(optionResult.value);
      }

      if (pageResult.status === "fulfilled") {
        setCustomers(pageResult.value.content);
        setTotal(pageResult.value.totalElements);
      } else {
        setError(report(pageResult.reason, "목록을 불러올 수 없습니다."));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [report]);

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">고객 마스터</h1>
        <Link href="/customers/new" className={buttonVariants()}>
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
          <FieldLabel htmlFor="keyword">고객명/회사명</FieldLabel>
          <Input
            id="keyword"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Field>

        <Field className="w-40">
          <FieldLabel htmlFor="assignedRepId">담당 영업</FieldLabel>
          <select
            id="assignedRepId"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={assignedRepId}
            onChange={(event) => setAssignedRepId(event.target.value)}
          >
            <option value="">전체</option>
            {options.map((option) => (
              <option key={option.repId} value={String(option.repId)}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>

        <Field className="w-32">
          <FieldLabel htmlFor="grade">등급</FieldLabel>
          <select
            id="grade"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={grade}
            onChange={(event) => setGrade(event.target.value)}
          >
            <option value="">전체</option>
            {GRADES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
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
            <TableHead>고객명</TableHead>
            <TableHead>회사명</TableHead>
            <TableHead>연락처</TableHead>
            <TableHead>등급</TableHead>
            <TableHead>담당 영업</TableHead>
            <TableHead>상태</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7}>조회 결과가 없습니다.</TableCell>
            </TableRow>
          ) : (
            customers.map((customer) => (
              <TableRow key={customer.customerId}>
                <TableCell>{customer.customerName}</TableCell>
                <TableCell>{customer.companyName ?? "-"}</TableCell>
                <TableCell>{customer.phone ?? "-"}</TableCell>
                <TableCell>{customer.grade ?? "-"}</TableCell>
                <TableCell>{customer.assignedRepName ?? "-"}</TableCell>
                <TableCell>
                  <span
                    className={
                      customer.status === "ACTIVE"
                        ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs"
                        : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    }
                  >
                    {STATUS_LABEL[customer.status] ?? customer.status}
                  </span>
                </TableCell>
                <TableCell>
                  {customer.editable ? (
                    <Link
                      href={`/customers/${customer.customerId}/edit`}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                      })}
                    >
                      수정
                    </Link>
                  ) : (
                    // 비활성 버튼은 호버를 받지 못해 title 을 감싸는 span 에 둔다.
                    <span title={NOT_EDITABLE_REASON}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled
                        aria-label={`수정 (${NOT_EDITABLE_REASON})`}
                      >
                        수정
                      </Button>
                    </span>
                  )}
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
