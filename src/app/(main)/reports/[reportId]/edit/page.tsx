"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getCustomer } from "@/lib/client/customer-api";
import {
  getReport,
  reportErrorMessage,
  saveReport,
  submitReport,
  type ReportDetail,
} from "@/lib/client/report-api";
import { formatDate, nextDay } from "@/lib/client/report-format";
import {
  emptyPlan,
  emptyProblem,
  emptyVisit,
  toRows,
  withCustomerName,
  toSaveBody,
  validateForSave,
  validateForSubmit,
  type CustomerRef,
  type FormRows,
  type PlanRow,
  type ProblemRow,
  type VisitRow,
} from "@/lib/client/report-form";
import { useApiErrors } from "@/lib/client/use-api-errors";
import { getStoredRep } from "@/lib/client/auth-storage";
import { customerErrorMessage } from "@/lib/client/customer-api";
import { isUnauthorized } from "@/lib/client/api-client";
import { CustomerPicker } from "./customer-picker";

const NATIVE_SELECT =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "작성중",
  SUBMITTED: "제출",
};

interface Header {
  reportDate: string;
  repName: string;
  status: string;
}

/**
 * SCR-210 일일보고 작성·수정.
 *
 * 폼 상태는 `useState` 와 손으로 쓴 검증이다(고객·영업 폼과 같은 방식).
 * 저장(PUT)은 전체 교체라 세 배열을 항상 보내고, 기존 행의 식별자를 담아 수정으로
 * 처리되게 한다. 제출된 보고는 폼을 보여주지 않고 SCR-220 으로 보낸다.
 *
 * **화면 검증·SUBMITTED 리다이렉트는 접근통제가 아니다.** 서버가 PUT 을 409
 * `REPORT_LOCKED`, 0건 제출을 400 `VISITS_REQUIRED` 로 다시 막는다.
 */
export default function ReportEditPage() {
  const router = useRouter();
  const report = useApiErrors(reportErrorMessage);
  // 고객 검색은 고객 API 를 부른다. 보고 도메인 문장을 쓰면 NOT_FOUND 가 "보고를
  // 찾을 수 없습니다" 로, 403 이 "일일보고는 영업사원·상급자만" 으로 나온다 —
  // 고객 검색창 아래에 틀린 문장이 붙는다. 401 처리는 양쪽 다 같다.
  const customer = useApiErrors(customerErrorMessage);
  const params = useParams<{ reportId: string }>();
  const reportId = Number(params.reportId);

  const [header, setHeader] = useState<Header | null>(null);
  const [rows, setRows] = useState<FormRows | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 고객 id → 이름. 과제·계획 응답에는 이름이 없어 직접 채운다.
  const names = useRef(new Map<number, string>());

  /** 방문 응답에 이미 들어 있는 이름. 추가 조회가 아니다. */
  function cacheVisitNames(detail: ReportDetail) {
    for (const visit of detail.visits) {
      names.current.set(visit.customer.customerId, visit.customer.customerName);
    }
  }

  /** 아직 이름을 모르는 고객 식별자. 과제·계획 응답에는 이름이 없다(명세 3.3). */
  function missingNameIds(detail: ReportDetail): number[] {
    const missing = new Set<number>();
    for (const row of [...detail.problems, ...detail.plans]) {
      if (row.customerId !== null && !names.current.has(row.customerId)) {
        missing.add(row.customerId);
      }
    }
    return [...missing];
  }

  /**
   * 과제·계획의 고객 이름을 **뒤에서** 채운다. 폼을 막지 않는다.
   *
   * 이름은 표시용인데 행마다 요청이 하나씩 늘어난다(최대 200). 전부 끝나기를
   * 기다리면 하나가 늦는 것만으로 이미 받은 방문 기록·머리글까지 못 보고
   * "불러오는 중…" 에 머문다. 받는 대로 그 칸만 채운다.
   */
  const resolveNames = useCallback(
    async (ids: number[], isCancelled: () => boolean) => {
      await Promise.all(
        ids.map(async (id) => {
          try {
            const found = await getCustomer(id);
            names.current.set(id, found.customerName);
            if (isCancelled()) return;
            setRows((prev) =>
              prev === null
                ? prev
                : withCustomerName(prev, id, found.customerName),
            );
          } catch (caught) {
            // 이름을 못 받는 것은 그 칸만 식별자로 두면 된다. 그러나 401 은 세션이
            // 끊긴 것이라 삼키면 안 된다 — 삼키면 "고객 #6" 이 뜬 폼을 쓰다가
            // 임시저장에서야 끊긴 것을 알게 된다. `customer` 가 로그인으로 보낸다.
            if (isUnauthorized(caught)) {
              customer(caught, "");
            }
          }
        }),
      );
    },
    [customer],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!Number.isInteger(reportId) || reportId <= 0) {
        setErrors(["보고를 찾을 수 없습니다."]);
        return;
      }
      try {
        const detail = await getReport(reportId);
        if (cancelled) return;
        if (detail.status === "SUBMITTED") {
          // 저장할 수 없는 폼을 보여주지 않는다.
          router.replace(`/reports/${reportId}`);
          return;
        }
        // 남의 보고도 저장할 수 없다 — 서버가 PUT 을 403 으로 막는다. 조회는
        // 작성자와 직속 상급자 모두에게 열려 있어 상급자가 팀원의 DRAFT 보고로
        // 이 URL 에 닿을 수 있다. 폼을 보여주면 입력한 뒤 저장에서야 403 을 받고
        // **입력이 전부 사라진다.** 상세로 돌려보낸다.
        if (getStoredRep()?.repId !== detail.rep.repId) {
          router.replace(`/reports/${reportId}`);
          return;
        }
        cacheVisitNames(detail);
        setHeader({
          reportDate: detail.reportDate,
          repName: detail.rep.name,
          status: detail.status,
        });
        setRows(toRows(detail, names.current));
        // 폼을 먼저 그리고 이름은 뒤에서 채운다. await 하지 않는다.
        void resolveNames(missingNameIds(detail), () => cancelled);
      } catch (caught) {
        if (cancelled) return;
        setErrors([report(caught, "보고를 불러올 수 없습니다.")]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId, report, router, resolveNames]);

  /**
   * 서버 응답으로 폼을 갱신한다. 새 행의 식별자가 여기서 들어온다.
   * 식별자가 같은 행은 key 를 물려받아 행이 다시 붙지 않는다(입력 중인 검색어 보존).
   */
  function applyDetail(detail: ReportDetail) {
    cacheVisitNames(detail);
    setRows((prev) => toRows(detail, names.current, prev ?? undefined));
    void resolveNames(missingNameIds(detail), () => false);
  }

  /**
   * 입력이 바뀌면 저장 결과 표시를 치운다. 안 치우면 "임시저장했습니다" 가 계속
   * 떠 있는 채로 편집하게 되어 **저장되지 않은 수정이 저장된 것처럼 보인다.**
   * 고친 행의 묵은 오류도 다음 저장까지 남는다.
   */
  function clearSaveResult() {
    setMessage(null);
    setErrors([]);
  }

  function update<K extends keyof FormRows>(
    section: K,
    key: string,
    patch: Partial<FormRows[K][number]>,
  ) {
    clearSaveResult();
    setRows((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            [section]: (prev[section] as { key: string }[]).map((row) =>
              row.key === key ? { ...row, ...patch } : row,
            ),
          },
    );
  }

  function remove(section: keyof FormRows, key: string) {
    clearSaveResult();
    setRows((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            [section]: (prev[section] as { key: string }[]).filter(
              (row) => row.key !== key,
            ),
          },
    );
  }

  function pick(
    section: "visits" | "problems" | "plans",
    key: string,
    customer: CustomerRef | null,
  ) {
    if (customer?.customerName) {
      names.current.set(customer.customerId, customer.customerName);
    }
    update(section, key, { customer });
  }

  /** 검증 후 PUT. 성공하면 응답으로 폼을 갱신하고 true. */
  async function save(forSubmit: boolean): Promise<boolean> {
    if (rows === null || header === null) return false;
    const problems = forSubmit
      ? validateForSubmit(rows)
      : validateForSave(rows);
    setMessage(null);
    setErrors(problems);
    if (problems.length > 0) return false;
    try {
      const detail = await saveReport(reportId, toSaveBody(rows));
      applyDetail(detail);
      return true;
    } catch (caught) {
      setErrors([report(caught, "저장할 수 없습니다.")]);
      return false;
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      if (await save(false)) {
        setMessage("임시저장했습니다.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setBusy(true);
    try {
      // 저장 없이 제출하면 입력한 내용이 반영되지 않는다. 항상 PUT 이 먼저다.
      if (!(await save(true))) return;
      try {
        await submitReport(reportId);
      } catch (caught) {
        setErrors([report(caught, "제출할 수 없습니다.")]);
        return;
      }
      router.push(`/reports/${reportId}`);
    } finally {
      setBusy(false);
    }
  }

  if (rows === null || header === null) {
    return (
      <section>
        <h1 className="mb-6 text-xl font-semibold">일일보고 작성</h1>
        {errors.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {errors[0]}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">불러오는 중…</p>
        )}
      </section>
    );
  }

  return (
    <section>
      <h1 className="mb-2 text-xl font-semibold">일일보고 작성</h1>
      <p className="mb-6 flex gap-6 text-sm">
        <span>보고일자: {header.reportDate}</span>
        <span>작성자: {header.repName}</span>
        <span>상태: {STATUS_LABEL[header.status] ?? header.status}</span>
      </p>

      {errors.length > 0 ? (
        <ul role="alert" className="mb-4 text-sm text-destructive">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      {message === null ? null : (
        <p role="status" className="mb-4 text-sm text-green-700">
          {message}
        </p>
      )}

      {/* 저장·제출 중에는 입력을 잠가 응답이 편집 중인 내용을 덮어쓰지 않게 한다. */}
      <fieldset disabled={busy} className="flex flex-col gap-8">
        <SectionHeader
          title="방문 기록"
          addLabel="방문 기록 행 추가"
          onAdd={() => {
            clearSaveResult();
            setRows({ ...rows, visits: [...rows.visits, emptyVisit()] });
          }}
        />
        <VisitTable
          rows={rows.visits}
          update={(key, patch) => update("visits", key, patch)}
          remove={(key) => remove("visits", key)}
          pick={(key, customer) => pick("visits", key, customer)}
          toMessage={customer}
        />

        <SectionHeader
          title="과제/상담"
          addLabel="과제/상담 행 추가"
          onAdd={() => {
            clearSaveResult();
            setRows({ ...rows, problems: [...rows.problems, emptyProblem()] });
          }}
        />
        <ProblemTable
          rows={rows.problems}
          update={(key, patch) => update("problems", key, patch)}
          remove={(key) => remove("problems", key)}
          pick={(key, customer) => pick("problems", key, customer)}
          toMessage={customer}
        />

        <SectionHeader
          title="내일 할 일"
          addLabel="내일 할 일 행 추가"
          onAdd={() => {
            clearSaveResult();
            // 기본 예정일은 익일. 서버 렌더링과 어긋나지 않게 추가하는 순간 계산한다.
            // "내일" 은 보고일자 기준이다(지난 보고를 고칠 때도 그 다음 날).
            setRows({
              ...rows,
              plans: [
                ...rows.plans,
                emptyPlan(nextDay(header.reportDate || formatDate(new Date()))),
              ],
            });
          }}
        />
        <PlanTable
          rows={rows.plans}
          update={(key, patch) => update("plans", key, patch)}
          remove={(key) => remove("plans", key)}
          pick={(key, customer) => pick("plans", key, customer)}
          toMessage={customer}
        />

        <div className="flex justify-center gap-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleSave()}
          >
            임시저장
          </Button>
          <Button type="button" onClick={() => void handleSubmit()}>
            제출
          </Button>
        </div>
      </fieldset>
    </section>
  );
}

function SectionHeader({
  title,
  addLabel,
  onAdd,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="-mb-6 flex items-center justify-between">
      <h2 className="text-base font-semibold">{title}</h2>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={addLabel}
        onClick={onAdd}
      >
        + 행 추가
      </Button>
    </div>
  );
}

interface TableProps<R> {
  rows: R[];
  update: (key: string, patch: Partial<R>) => void;
  remove: (key: string) => void;
  pick: (key: string, customer: CustomerRef | null) => void;
  toMessage: (caught: unknown, fallback: string) => string;
}

function DeleteButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={onClick}
    >
      x
    </Button>
  );
}

function VisitTable({
  rows,
  update,
  remove,
  pick,
  toMessage,
}: TableProps<VisitRow>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>시각</TableHead>
          <TableHead>고객</TableHead>
          <TableHead>방문유형</TableHead>
          <TableHead>방문내용</TableHead>
          <TableHead>상담결과</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6}>방문 기록이 없습니다.</TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => {
            const n = index + 1;
            return (
              <TableRow key={row.key}>
                <TableCell>
                  <Input
                    type="time"
                    aria-label={`방문 ${n}행 시각`}
                    value={row.visitTime}
                    onChange={(e) =>
                      update(row.key, { visitTime: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <CustomerPicker
                    label={`방문 ${n}행 고객`}
                    value={row.customer}
                    onChange={(c) => pick(row.key, c)}
                    toMessage={toMessage}
                  />
                </TableCell>
                <TableCell>
                  <select
                    aria-label={`방문 ${n}행 방문유형`}
                    className={NATIVE_SELECT}
                    value={row.visitType}
                    onChange={(e) =>
                      update(row.key, {
                        visitType: e.target.value as VisitRow["visitType"],
                      })
                    }
                  >
                    <option value="VISIT">방문</option>
                    <option value="CALL">전화</option>
                    <option value="ONLINE">온라인</option>
                  </select>
                </TableCell>
                <TableCell>
                  <Textarea
                    aria-label={`방문 ${n}행 방문내용`}
                    value={row.content}
                    onChange={(e) =>
                      update(row.key, { content: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`방문 ${n}행 상담결과`}
                    value={row.result}
                    onChange={(e) =>
                      update(row.key, { result: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <DeleteButton
                    label={`방문 ${n}행 삭제`}
                    onClick={() => remove(row.key)}
                  />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function ProblemTable({
  rows,
  update,
  remove,
  pick,
  toMessage,
}: TableProps<ProblemRow>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>관련고객</TableHead>
          <TableHead>내용</TableHead>
          <TableHead>상태</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4}>과제/상담이 없습니다.</TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => {
            const n = index + 1;
            return (
              <TableRow key={row.key}>
                <TableCell>
                  <CustomerPicker
                    label={`과제 ${n}행 고객`}
                    value={row.customer}
                    onChange={(c) => pick(row.key, c)}
                    toMessage={toMessage}
                  />
                </TableCell>
                <TableCell>
                  <Textarea
                    aria-label={`과제 ${n}행 내용`}
                    value={row.content}
                    onChange={(e) =>
                      update(row.key, { content: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <select
                    aria-label={`과제 ${n}행 상태`}
                    className={NATIVE_SELECT}
                    value={row.status}
                    onChange={(e) =>
                      update(row.key, {
                        status: e.target.value as ProblemRow["status"],
                      })
                    }
                  >
                    <option value="OPEN">진행</option>
                    <option value="CLOSED">완료</option>
                  </select>
                </TableCell>
                <TableCell>
                  <DeleteButton
                    label={`과제 ${n}행 삭제`}
                    onClick={() => remove(row.key)}
                  />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function PlanTable({
  rows,
  update,
  remove,
  pick,
  toMessage,
}: TableProps<PlanRow>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>관련고객</TableHead>
          <TableHead>예정일</TableHead>
          <TableHead>내용</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4}>내일 할 일이 없습니다.</TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => {
            const n = index + 1;
            return (
              <TableRow key={row.key}>
                <TableCell>
                  <CustomerPicker
                    label={`계획 ${n}행 고객`}
                    value={row.customer}
                    onChange={(c) => pick(row.key, c)}
                    toMessage={toMessage}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="date"
                    aria-label={`계획 ${n}행 예정일`}
                    value={row.plannedDate}
                    onChange={(e) =>
                      update(row.key, { plannedDate: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Textarea
                    aria-label={`계획 ${n}행 내용`}
                    value={row.content}
                    onChange={(e) =>
                      update(row.key, { content: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <DeleteButton
                    label={`계획 ${n}행 삭제`}
                    onClick={() => remove(row.key)}
                  />
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
