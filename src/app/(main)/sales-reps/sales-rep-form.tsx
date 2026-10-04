"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/client/api-client";
import {
  changeSalesRepStatus,
  createSalesRep,
  listSalesReps,
  resetSalesRepPassword,
  updateSalesRep,
  type Role,
  type SalesRepFormValues,
  type SalesRepListItem,
} from "@/lib/client/sales-rep-api";

const EMPTY: SalesRepFormValues = {
  empNo: "",
  name: "",
  email: "",
  department: "",
  position: "",
  managerId: "",
  role: "SALES_REP",
  status: "ACTIVE",
};

const ROLES: { value: Role; label: string }[] = [
  { value: "SALES_REP", label: "영업사원" },
  { value: "MANAGER", label: "상급자" },
  { value: "ADMIN", label: "관리자" },
];

interface Props {
  /** 수정 대상. 신규 등록이면 undefined. */
  repId?: number;
  initialValues?: SalesRepFormValues;
}

/**
 * SCR-510 영업 등록·수정.
 *
 * 상급자 Select 는 `role=MANAGER` 로 걸러 받는다. 전부 받아 화면에서 거르면
 * 페이지네이션에 걸려 빠지는 사원이 생긴다. 본인은 목록에서 제외한다.
 */
export default function SalesRepForm({ repId, initialValues }: Props) {
  const router = useRouter();
  const isEdit = repId !== undefined;
  const [values, setValues] = useState<SalesRepFormValues>(
    initialValues ?? EMPTY,
  );
  const [managers, setManagers] = useState<SalesRepListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const page = await listSalesReps({
        role: "MANAGER",
        status: "ACTIVE",
        size: 100,
      }).catch(() => null);

      if (!cancelled && page !== null) {
        setManagers(page.content.filter((rep) => rep.repId !== repId));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repId]);

  function update<K extends keyof SalesRepFormValues>(
    key: K,
    value: SalesRepFormValues[K],
  ) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    for (const [key, label] of [
      ["empNo", "사번"],
      ["name", "이름"],
      ["email", "이메일"],
    ] as const) {
      if (values[key].trim() === "") {
        setError(`${label}을(를) 입력하세요.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateSalesRep(repId, values);
        router.push("/sales-reps");
        return;
      }

      const created = await createSalesRep(values);

      // 임시 비밀번호는 이 응답에만 담겨 온다. 다시 볼 수 없다. (#44)
      if (created.temporaryPassword === undefined) {
        router.push("/sales-reps");
        return;
      }

      setNotice(
        `등록했습니다. 임시 비밀번호: ${created.temporaryPassword} — 다시 볼 수 없으므로 본인에게 전달하세요.`,
      );
      setValues(EMPTY);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "저장할 수 없습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!isEdit) {
      return;
    }

    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await changeSalesRepStatus(repId, "INACTIVE");
      router.push("/sales-reps");
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "비활성화할 수 없습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!isEdit) {
      return;
    }

    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const result = await resetSalesRepPassword(repId);
      setNotice(
        `임시 비밀번호: ${result.temporaryPassword} — 다시 볼 수 없으므로 본인에게 전달하세요.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "재발급할 수 없습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg" noValidate>
      <h1 className="mb-6 text-xl font-semibold">
        {isEdit ? "영업 수정" : "영업 등록"}
      </h1>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="empNo">사번</FieldLabel>
          <Input
            id="empNo"
            value={values.empNo}
            onChange={(event) => update("empNo", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="name">이름</FieldLabel>
          <Input
            id="name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="email">이메일</FieldLabel>
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="department">부서</FieldLabel>
          <Input
            id="department"
            value={values.department}
            onChange={(event) => update("department", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="position">직급</FieldLabel>
          <Input
            id="position"
            value={values.position}
            onChange={(event) => update("position", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="role">역할</FieldLabel>
          <select
            id="role"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={values.role}
            onChange={(event) => update("role", event.target.value as Role)}
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <FieldLabel htmlFor="managerId">상급자</FieldLabel>
          <select
            id="managerId"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={values.managerId}
            onChange={(event) => update("managerId", event.target.value)}
          >
            <option value="">없음</option>
            {managers.map((manager) => (
              <option key={manager.repId} value={String(manager.repId)}>
                {manager.name} ({manager.empNo})
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <FieldLabel htmlFor="status">상태</FieldLabel>
          <select
            id="status"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={values.status}
            onChange={(event) =>
              update(
                "status",
                event.target.value as SalesRepFormValues["status"],
              )
            }
          >
            <option value="ACTIVE">활성</option>
            <option value="INACTIVE">비활성</option>
          </select>
        </Field>

        {error === null ? null : <FieldError role="alert">{error}</FieldError>}

        {notice === null ? null : (
          <p role="status" className="rounded-md bg-muted p-3 text-sm">
            {notice}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "저장 중…" : "저장"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/sales-reps")}
          >
            취소
          </Button>

          {isEdit ? (
            <>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeactivate()}
                disabled={submitting}
              >
                비활성화
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleResetPassword()}
                disabled={submitting}
              >
                임시 비밀번호 재발급
              </Button>
            </>
          ) : null}
        </div>
      </FieldGroup>
    </form>
  );
}
