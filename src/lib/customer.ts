import type { Customer } from "@prisma/client";
import { type AuthContext, type TargetRep, isManagerOf, isOwner } from "./auth";
import { AuthorizationError, ValidationError } from "./errors";
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
  /**
   * 호출자가 이 고객을 수정·비활성화할 수 있는가. (이슈 #68)
   *
   * 화면이 버튼을 가리는 데 쓰는 힌트다. 접근통제가 아니다 — 서버가 PUT·PATCH
   * 에서 다시 막는다.
   */
  editable: boolean;
}

/** 담당 영업 이름을 함께 읽은 레코드. */
export type CustomerWithRep = Customer & {
  // repId·managerId 는 `editable` 판정에만 쓰고 응답에는 담지 않는다.
  assignedRep: { name: string; repId: bigint; managerId: bigint | null } | null;
};

export function toCustomerListItem(
  customer: CustomerWithRep,
  auth: AuthContext,
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
    editable: isCustomerWritable(auth, customer),
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

/** 쓰기 범위 판정에 필요한 고객의 최소 정보. 담당 사원의 상급자까지 읽어 넘긴다. */
export interface WritableCustomer {
  /** 담당 영업. `assignedRepId` 가 null 인 고객은 null 이다. */
  assignedRep: TargetRep | null;
}

/**
 * 고객을 수정·비활성화할 수 있는 사람인지 판정한다. (이슈 #68 정책 C, TC-SEC-08)
 *
 * 조회(목록·상세)는 전사에 열려 있고, 쓰기만 담당 영업 본인과 그 사원의 **직속**
 * 상급자로 좁힌다. 직속만 보는 이유는 `isManagerOf` 와 같다 — 범위를 다르게 잡으면
 * 한쪽에서는 보이는데 다른 쪽에서는 403 인 모순이 생긴다.
 *
 * **담당 영업이 없는(null) 고객은 쓰기 범위 밖이다.** 통과시키면 그 고객이 전사
 * 쓰기 가능이 되어 정책에 구멍이 생긴다. API 는 등록·수정에서 담당을 필수로 받으므로
 * null 은 레거시·DB 직접 조작으로만 생기며, 복구는 DB 에서 담당자를 지정해야 한다.
 *
 * 등록(POST)에는 쓰지 않는다. 새 데이터를 더하는 것은 남의 데이터를 고치는 것이
 * 아니므로 제한하지 않는다.
 *
 * DB 를 보지 않는 순수 함수다. 호출 측이 고객과 담당 사원을 조회해 넘긴다.
 * 오류 메시지는 담당자 유무나 상태를 드러내지 않는다.
 */
/**
 * 쓰기 범위 안인지 판정만 한다. 던지지 않는다.
 *
 * 목록 응답의 `editable` 이 이것을 쓴다. 화면이 같은 판정을 다시 구현하면
 * 서버와 어긋날 수 있고, 애초에 **화면은 정확히 계산할 수 없다** — 목록 응답에
 * 담당 사원의 `managerId` 가 없고, 담으면 조직 구조가 새어 나간다(NFR-04).
 * 그래서 서버가 계산해 알려준다.
 *
 * 이것은 **화면용 힌트이고 접근통제가 아니다.** 실제 차단은 PUT·PATCH 의
 * `assertCustomerWritable` 이 한다.
 */
export function isCustomerWritable(
  auth: AuthContext,
  customer: WritableCustomer,
): boolean {
  const rep = customer.assignedRep;
  return Boolean(rep) && (isOwner(auth, rep!.repId) || isManagerOf(auth, rep!));
}

export function assertCustomerWritable(
  auth: AuthContext,
  customer: WritableCustomer,
): void {
  if (isCustomerWritable(auth, customer)) {
    return;
  }
  // 범용 FORBIDDEN 이 아니라 전용 코드를 준다. 화면이 "역할이 안 맞는 403"과
  // "남의 고객이라 안 되는 403"을 구분해야 하는데, 호출 지점으로 가르면 새
  // 호출부가 생길 때 조용히 틀린 문구가 나간다. 이 저장소의 다른 조건들도
  // (ASSIGNED_REP_INACTIVE·COMMENT_HAS_REPLIES·LAST_ACTIVE_ADMIN) 전용 코드를 쓴다.
  throw new AuthorizationError(
    "CUSTOMER_WRITE_FORBIDDEN",
    "이 고객을 수정할 권한이 없습니다.",
    403,
  );
}
