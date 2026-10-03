import type { SalesRep } from "@prisma/client";
import { ValidationError } from "./errors";
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

/**
 * 상급자로 지정한 사원이 실제로 있는지 확인한다. (FR-02 자기참조 관계)
 *
 * FK 위반을 그대로 두면 Prisma 오류가 500으로 나가므로 400으로 먼저 막는다.
 * 자기 자신을 상급자로 두는 것도 막는다. 관계가 자기 자신으로 닫히면
 * 팀 범위 판정(assertTeamScope)이 뜻을 잃는다.
 */
export async function assertManagerExists(
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
    select: { repId: true, role: true },
  });

  if (!manager) {
    throw new ValidationError(
      "상급자로 지정한 영업사원을 찾을 수 없습니다.",
      "MANAGER_NOT_FOUND"
    );
  }

  // managerId 와 role 이 어긋나면 데이터상 상급자인데 권한은 없는 상태가 된다.
  // isManagerOf 가 호출자의 role 이 MANAGER 일 것을 요구하므로(#4), 역할이
  // SALES_REP 인 사람을 상급자로 두면 팀 보고 조회·댓글이 전부 403 이 된다.
  if (manager.role !== "MANAGER") {
    throw new ValidationError(
      "상급자로 지정할 사원의 역할이 MANAGER 여야 합니다.",
      "MANAGER_ROLE_REQUIRED"
    );
  }
}
