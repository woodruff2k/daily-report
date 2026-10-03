import type { SalesRep } from "@prisma/client";
import { ConflictError, ValidationError } from "./errors";
import { prisma } from "./prisma";

/**
 * 응답에 담는 영업 마스터 필드. (API 명세 6)
 *
 * `passwordHash`를 의도적으로 제외한다. Prisma 모델을 그대로 직렬화하면
 * 해시가 그대로 나가므로(NFR-04), 내보낼 필드를 명시적으로 나열한다.
 */
export interface SalesRepResponse {
  repId: number;
  empNo: string;
  name: string;
  email: string;
  department: string | null;
  position: string | null;
  managerId: number | null;
  role: SalesRep["role"];
  status: SalesRep["status"];
  createdAt: string;
  updatedAt: string;
}

/**
 * 목록 응답에 담는 필드. (화면정의서 SCR-500)
 *
 * 상세(`SalesRepResponse`)와 나눈 이유는 목록에 이메일이 실릴 이유가 없기
 * 때문이다. SCR-500 의 목록 항목은 사번·이름·부서·직급·상급자·상태이고,
 * NFR-04 는 직원 사번·이메일의 노출을 최소화하라고 한다. 사번은 목록 항목이라
 * 남기고 이메일은 뺀다. 일시도 화면이 쓰지 않아 제외했다.
 */
export interface SalesRepListItem {
  repId: number;
  empNo: string;
  name: string;
  department: string | null;
  position: string | null;
  managerId: number | null;
  role: SalesRep["role"];
  status: SalesRep["status"];
}

/** Prisma 레코드를 목록 항목으로 바꾼다. */
export function toSalesRepListItem(rep: SalesRep): SalesRepListItem {
  return {
    repId: Number(rep.repId),
    empNo: rep.empNo,
    name: rep.name,
    department: rep.department,
    position: rep.position,
    managerId: rep.managerId === null ? null : Number(rep.managerId),
    role: rep.role,
    status: rep.status,
  };
}

/**
 * Prisma 레코드를 응답 형태로 바꾼다.
 *
 * repId는 DB에서 BigInt지만 API 명세 6.2가 JSON 숫자로 적고 있어 Number로
 * 바꾼다. BigInt는 JSON.stringify가 그대로 던지기 때문에 변환이 필수다.
 * 안전 정수 범위를 넘는 식별자는 입력 단계(salesRepCreateSchema)에서 막는다.
 */
export function toSalesRepResponse(rep: SalesRep): SalesRepResponse {
  return {
    repId: Number(rep.repId),
    empNo: rep.empNo,
    name: rep.name,
    email: rep.email,
    department: rep.department,
    position: rep.position,
    managerId: rep.managerId === null ? null : Number(rep.managerId),
    role: rep.role,
    status: rep.status,
    createdAt: rep.createdAt.toISOString(),
    updatedAt: rep.updatedAt.toISOString(),
  };
}

/** 상급자 체인을 따라 올라갈 때의 깊이 상한. 순환이 아니어도 비용을 묶는다. */
const MANAGER_CHAIN_LIMIT = 20;

/**
 * 상급자로 지정할 수 있는 사원인지 확인한다. (FR-02 자기참조 관계)
 *
 * 네 가지를 본다.
 *
 * 1. 존재 — FK 위반을 그대로 두면 Prisma 오류가 500 으로 나간다
 * 2. 활성 — 비활성 상급자는 로그인할 수 없어 그 팀의 보고를 아무도 검토하지 못한다
 * 3. 역할이 MANAGER — `isManagerOf` 가 호출자의 role 이 MANAGER 일 것을 요구한다(#4).
 *    어긋나면 데이터상 상급자인데 팀 보고 조회·댓글이 전부 403 이 된다
 * 4. 순환 없음 — 자기 자신(A→A)뿐 아니라 체인을 따라 올라가 자기에 닿는
 *    경우(A→B→A)도 막는다. 순환이 생기면 체인을 오르는 처리가 끝나지 않는다
 *
 * **`managerId` 가 바뀔 때만 호출해야 한다.** 매 수정마다 호출하면, 상급자가
 * 나중에 비활성화된 사원은 이름·부서만 고치려는 요청까지 막힌다. 마스터는
 * 물리 삭제 대신 비활성화로 남으므로(NFR-03) 그 상태는 정상이다.
 */
export async function assertManagerAssignable(
  managerId: bigint,
  selfRepId?: bigint
): Promise<void> {
  if (selfRepId !== undefined && managerId === selfRepId) {
    throw new ValidationError(
      "자기 자신을 상급자로 지정할 수 없습니다.",
      "SELF_MANAGER"
    );
  }

  const manager = await prisma.salesRep.findUnique({
    where: { repId: managerId },
    select: { repId: true, role: true, status: true, managerId: true },
  });

  if (!manager) {
    throw new ValidationError(
      "상급자로 지정한 영업사원을 찾을 수 없습니다.",
      "MANAGER_NOT_FOUND"
    );
  }

  if (manager.status !== "ACTIVE") {
    throw new ValidationError(
      "비활성 사원을 상급자로 지정할 수 없습니다. 기존 관계는 그대로 유지됩니다.",
      "MANAGER_INACTIVE"
    );
  }

  if (manager.role !== "MANAGER") {
    throw new ValidationError(
      "상급자로 지정할 사원의 역할이 MANAGER 여야 합니다. 대상 사원의 역할을 먼저 바꾸세요.",
      "MANAGER_ROLE_REQUIRED"
    );
  }

  if (selfRepId !== undefined) {
    await assertNoManagerCycle(manager.managerId, selfRepId);
  }
}

/**
 * 상급자 체인을 따라 올라가며 `selfRepId` 에 닿는지 확인한다.
 *
 * A 의 상급자를 B 로 두려 할 때, B 의 상급자 체인에 A 가 있으면 순환이 된다.
 */
async function assertNoManagerCycle(
  startManagerId: bigint | null,
  selfRepId: bigint
): Promise<void> {
  let cursor = startManagerId;

  for (let depth = 0; cursor !== null && depth < MANAGER_CHAIN_LIMIT; depth += 1) {
    if (cursor === selfRepId) {
      throw new ValidationError(
        "상급자 관계가 순환합니다.",
        "MANAGER_CYCLE"
      );
    }

    const next: { managerId: bigint | null } | null = await prisma.salesRep.findUnique({
      where: { repId: cursor },
      select: { managerId: true },
    });

    cursor = next?.managerId ?? null;
  }
}

/**
 * 마지막 활성 관리자를 잃지 않는지 확인한다.
 *
 * 관리자가 자기 역할을 강등하거나 자신을 비활성화하면 영업 마스터 관리
 * 경로가 영구 차단된다. #52 이후로는 토큰까지 즉시 끊겨 되돌릴 방법이
 * 사실상 DB 직접 수정뿐이다. `npm run bootstrap:admin` 도 "활성 관리자가
 * 이미 있으면 중단" 하므로 우회로가 되지 못한다.
 *
 * 자기 계정 조작 자체는 막지 않는다. 관리자가 여럿일 때 교체·정리는 정상
 * 작업이다. 마지막 한 명이 사라지는 경우만 409 로 막는다.
 */
export async function assertNotLastActiveAdmin(
  repId: bigint,
  next: { role?: SalesRep["role"]; status?: SalesRep["status"] }
): Promise<void> {
  const current = await prisma.salesRep.findUnique({
    where: { repId },
    select: { role: true, status: true },
  });

  if (!current || current.role !== "ADMIN" || current.status !== "ACTIVE") {
    return;
  }

  const losesAdmin =
    (next.role !== undefined && next.role !== "ADMIN") ||
    (next.status !== undefined && next.status !== "ACTIVE");

  if (!losesAdmin) {
    return;
  }

  const others = await prisma.salesRep.count({
    where: { role: "ADMIN", status: "ACTIVE", repId: { not: repId } },
  });

  if (others === 0) {
    throw new ConflictError(
      "LAST_ACTIVE_ADMIN",
      "마지막 활성 관리자입니다. 다른 관리자를 먼저 만드세요."
    );
  }
}
