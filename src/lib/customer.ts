import type { Customer } from "@prisma/client";
import { ValidationError } from "./errors";
import { toJsonId, toJsonIdOrNull } from "./identifier";
import { prisma } from "./prisma";

/**
 * 고객 마스터를 다룰 수 있는 역할. (화면정의서 SCR-400·410, API 명세 1.5)
 *
 * ADMIN 은 넣지 않는다. 역할 간 상하 관계를 두지 않으므로 관리자는 영업
 * 마스터만 관리하고 고객 마스터는 담당 범위가 아니다.
 */
export const CUSTOMER_ROLES = ["SALES_REP", "MANAGER"] as const;

/**
 * 상세·등록·수정 응답. (API 명세 5.2, 5.3, 화면정의서 SCR-410)
 *
 * Prisma 모델을 그대로 반환하지 않고 필드를 명시적으로 나열한다. 컬럼이 늘어도
 * 조용히 새 나가지 않게 하려는 것이다. (NFR-04)
 */
export interface CustomerResponse {
  customerId: number;
  customerName: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  grade: string | null;
  assignedRepId: number | null;
  /**
   * 담당 영업 이름. 목록과 같은 이유로 담는다 — 식별자만 주면 화면이 다시
   * 조회해야 한다.
   *
   * 수정 화면(SCR-410)에는 더 구체적인 이유가 있다. 담당 영업 Select 는
   * `GET /api/sales-reps/options` 로 **활성 사원만** 받는다. 기존 담당자가
   * 나중에 비활성화되면(마스터는 비활성화로 남는다, NFR-03) 그 값이 목록에
   * 없어 Select 가 빈칸으로 보이고, 다른 필드만 고치려던 저장이 막힌다.
   * 이름이 있으면 화면이 현재 담당자를 옵션으로 끼워 넣을 수 있다.
   */
  assignedRepName: string | null;
  status: Customer["status"];
  createdAt: string;
  updatedAt: string;
}

/**
 * 목록 응답. (화면정의서 SCR-400)
 *
 * 목록 항목은 「고객명, 회사명, 연락처, 등급, 담당 영업, 상태」다. 그래서
 * `phone` 은 화면이 실제로 쓰므로 담고, `email`·`address` 는 상세(SCR-410)에서만
 * 쓰므로 뺀다. NFR-04 는 노출 최소화이고, 쓰지 않는 필드를 담는 것이 그 노출이다.
 */
export interface CustomerListItem {
  customerId: number;
  customerName: string;
  companyName: string | null;
  phone: string | null;
  grade: string | null;
  assignedRepId: number | null;
  /** 담당 영업 이름. 목록 컬럼이 이름이라 식별자만 주면 화면이 다시 조회해야 한다. */
  assignedRepName: string | null;
  status: Customer["status"];
}

/** 담당 영업 이름을 함께 읽은 레코드. */
export type CustomerWithRep = Customer & {
  assignedRep: { name: string } | null;
};

export function toCustomerListItem(
  customer: CustomerWithRep,
): CustomerListItem {
  return {
    customerId: toJsonId(customer.customerId),
    customerName: customer.customerName,
    companyName: customer.companyName,
    phone: customer.phone,
    grade: customer.grade,
    assignedRepId: toJsonIdOrNull(customer.assignedRepId),
    assignedRepName: customer.assignedRep?.name ?? null,
    status: customer.status,
  };
}

export type CustomerWithRepName = Customer & {
  assignedRep: { name: string } | null;
};

export function toCustomerResponse(
  customer: CustomerWithRepName,
): CustomerResponse {
  return {
    customerId: toJsonId(customer.customerId),
    customerName: customer.customerName,
    companyName: customer.companyName,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    grade: customer.grade,
    assignedRepId: toJsonIdOrNull(customer.assignedRepId),
    assignedRepName: customer.assignedRep?.name ?? null,
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

/**
 * 담당 영업으로 지정할 수 있는 사원인지 확인한다. (SCR-410 담당 영업 필수)
 *
 * 존재와 활성 상태를 본다. 존재하지 않으면 FK 위반이 Prisma 오류로 500 이 되고,
 * 비활성 사원은 로그인할 수 없어 그 고객을 아무도 관리하지 못한다.
 * 상급자 검증(`assertManagerAssignable`)과 달리 역할은 묻지 않는다 — 어떤
 * 역할의 사원이든 담당이 될 수 있다.
 *
 * **`assignedRepId` 가 새로 지정되거나 바뀔 때만 호출해야 한다.** 매 수정마다
 * 호출하면 담당자가 나중에 비활성화된 고객은 연락처만 고치려는 요청까지 막힌다.
 * 마스터는 물리 삭제 대신 비활성화로 남으므로(NFR-03) 그 상태는 정상이다.
 */
export async function assertAssignedRepValid(repId: bigint): Promise<void> {
  const rep = await prisma.salesRep.findUnique({
    where: { repId },
    select: { status: true },
  });

  if (!rep) {
    throw new ValidationError(
      "담당 영업으로 지정한 사원을 찾을 수 없습니다.",
      "ASSIGNED_REP_NOT_FOUND",
    );
  }

  if (rep.status !== "ACTIVE") {
    throw new ValidationError(
      "비활성 사원을 담당 영업으로 지정할 수 없습니다. 기존 관계는 그대로 유지됩니다.",
      "ASSIGNED_REP_INACTIVE",
    );
  }
}
