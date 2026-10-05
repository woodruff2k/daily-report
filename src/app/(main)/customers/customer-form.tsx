"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  changeCustomerStatus,
  createCustomer,
  listSalesRepOptions,
  updateCustomer,
  type CustomerFormValues,
  type CustomerStatus,
  type SalesRepOption,
} from "@/lib/client/customer-api";
import { useCustomerErrors } from "./use-customer-errors";

export const EMPTY_CUSTOMER: CustomerFormValues = {
  customerName: "",
  companyName: "",
  phone: "",
  email: "",
  address: "",
  grade: "",
  assignedRepId: "",
  status: "ACTIVE",
};

export const GRADES = ["A", "B", "C"];

/** 서버 스키마와 같은 규칙. 서버 검증을 대체하지 않고 왕복을 줄일 뿐이다. */
const PHONE_PATTERN = /^[0-9+\-() ]{5,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  /** 수정 대상. 신규 등록이면 undefined. */
  customerId?: number;
  initialValues?: CustomerFormValues;
  /** 수정 시 현재 담당자의 이름. 상세 응답의 `assignedRepName`. */
  initialAssignedRepName?: string | null;
}

/**
 * SCR-410 고객 등록·수정.
 *
 * 담당 영업 Select 는 `GET /api/sales-reps/options` 로 채운다. 그 목록은 활성
 * 사원만 담는다. 그런데 기존 담당자는 나중에 비활성화될 수 있다(마스터는
 * 비활성화로 남는다, NFR-03). 그러면 수정 화면의 Select 에 현재 값이 없어
 * 빈칸으로 보이고, 이름만 고치려던 저장이 필수 항목 검증에 막힌다.
 *
 * 그래서 현재 담당자가 목록에 없으면 `"<이름> (비활성)"` 옵션을 끼워 넣는다.
 * 그 값을 그대로 저장할 수 있다 — 서버의 PUT 은 `assignedRepId` 가 바뀔 때만
 * 담당자를 검증한다. 새로 다른 비활성 사원을 고를 수는 없다(목록에 없다).
 *
 * PUT 은 전체 교체라 모든 필드를 함께 보낸다.
 *
 * 수정·비활성화는 담당 영업과 그 직속 상급자만 할 수 있다. (이슈 #68) 상세 응답에는
 * `editable` 이 없고 수정 화면은 수정하려는 사람이 들어오므로, 막힌 경우는
 * 저장·비활성화의 403 에서 처리한다. 화면이 미리 막는 것은 접근통제가 아니고
 * 실제 차단은 서버가 한다. 등록은 남을 담당자로 지정해도 되지만 그러면 등록자는
 * 그 고객을 바로 고칠 수 없다(의도) — 목록의 비활성 [수정] 이 그 이유를 보여준다.
 */
export default function CustomerForm({
  customerId,
  initialValues,
  initialAssignedRepName,
}: Props) {
  const router = useRouter();
  const report = useCustomerErrors();
  const isEdit = customerId !== undefined;
  const [values, setValues] = useState<CustomerFormValues>(
    initialValues ?? EMPTY_CUSTOMER,
  );
  const [options, setOptions] = useState<SalesRepOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await listSalesRepOptions();
        if (!cancelled) {
          setOptions(loaded);
          setOptionsLoaded(true);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(report(caught, "담당 영업 목록을 불러올 수 없습니다."));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [report]);

  const originalRepId = initialValues?.assignedRepId ?? "";
  const missingCurrent =
    isEdit &&
    originalRepId !== "" &&
    !options.some((option) => String(option.repId) === originalRepId);

  function update<K extends keyof CustomerFormValues>(
    key: K,
    value: CustomerFormValues[K],
  ) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function validate(): string | null {
    if (values.customerName.trim() === "") {
      return "고객/담당자명을 입력하세요.";
    }
    if (values.assignedRepId === "") {
      return "담당 영업을 선택하세요.";
    }
    if (
      values.phone.trim() !== "" &&
      !PHONE_PATTERN.test(values.phone.trim())
    ) {
      return "연락처 형식이 올바르지 않습니다. 숫자와 + - ( ) 만 입력하세요.";
    }
    if (
      values.email.trim() !== "" &&
      !EMAIL_PATTERN.test(values.email.trim())
    ) {
      return "이메일 형식이 올바르지 않습니다.";
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const invalid = validate();
    if (invalid !== null) {
      setError(invalid);
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateCustomer(customerId, values);
      } else {
        await createCustomer(values);
      }
      router.push("/customers");
    } catch (caught) {
      // 수정의 403 은 범위(남의 고객)다. 등록의 403 은 역할이라 기본 문장.
      setError(report(caught, "저장할 수 없습니다."));
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!isEdit) {
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // 삭제가 아니라 PATCH 로 상태를 바꾼다. 활성화로 되돌릴 수 있다.
      await changeCustomerStatus(customerId, "INACTIVE");
      router.push("/customers");
    } catch (caught) {
      setConfirmOpen(false);
      setError(report(caught, "비활성화할 수 없습니다."));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg" noValidate>
      <h1 className="mb-6 text-xl font-semibold">
        {isEdit ? "고객 수정" : "고객 등록"}
      </h1>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="customerName">고객/담당자명</FieldLabel>
          <Input
            id="customerName"
            value={values.customerName}
            onChange={(event) => update("customerName", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="companyName">회사명</FieldLabel>
          <Input
            id="companyName"
            value={values.companyName}
            onChange={(event) => update("companyName", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="phone">연락처</FieldLabel>
          <Input
            id="phone"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
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
          <FieldLabel htmlFor="address">주소</FieldLabel>
          <Input
            id="address"
            value={values.address}
            onChange={(event) => update("address", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="grade">고객등급</FieldLabel>
          <select
            id="grade"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={values.grade}
            onChange={(event) => update("grade", event.target.value)}
          >
            <option value="">선택 안 함</option>
            {/* 목록에 없는 기존 등급도 잃지 않도록 현재 값을 유지한다. */}
            {(GRADES.includes(values.grade) || values.grade === ""
              ? GRADES
              : [...GRADES, values.grade]
            ).map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <FieldLabel htmlFor="assignedRepId">담당 영업</FieldLabel>
          <select
            id="assignedRepId"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={values.assignedRepId}
            onChange={(event) => update("assignedRepId", event.target.value)}
          >
            <option value="">선택하세요</option>
            {missingCurrent ? (
              <option value={originalRepId}>
                {initialAssignedRepName ?? `사원 ${originalRepId}`}
                {optionsLoaded ? " (비활성)" : ""}
              </option>
            ) : null}
            {options.map((option) => (
              <option key={option.repId} value={String(option.repId)}>
                {option.name}
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
              update("status", event.target.value as CustomerStatus)
            }
          >
            <option value="ACTIVE">활성</option>
            <option value="INACTIVE">비활성</option>
          </select>
        </Field>

        {error === null ? null : <FieldError role="alert">{error}</FieldError>}

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "저장 중…" : "저장"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/customers")}
          >
            취소
          </Button>

          {isEdit ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={submitting}
            >
              비활성화
            </Button>
          ) : null}
        </div>
      </FieldGroup>

      {/* window.confirm 대신 Dialog. 브라우저 모달은 테스트·자동화를 막는다. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>고객을 비활성화할까요?</DialogTitle>
            <DialogDescription>
              삭제되지 않고 비활성 상태로 남으며, 이후 다시 활성화할 수
              있습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={submitting}
              onClick={() => void handleDeactivate()}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
