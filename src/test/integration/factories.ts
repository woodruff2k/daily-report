import type {
  Customer,
  DailyReport,
  ReportComment,
  Role,
  SalesRep,
  VisitRecord,
} from "@prisma/client";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

/**
 * 통합 테스트용 팩토리. 합성 데이터만 만든다. (테스트 명세 1.4)
 *
 * 이름 `테스트사원A`, 이메일 `test-a@example.com`, 사번 `T0001` 형식을 따른다.
 * 전역 시드에 의존하지 않고 각 테스트가 필요한 행을 직접 만든다. 개발용
 * `prisma/seed.ts` 는 쓰지 않는다.
 */

/** 테스트 전용 더미 비밀번호. 실제 자격증명이 아니다. (최소 길이 12자) */
export const TEST_PASSWORD = "test-password-0001";

let sequence = 0;

function nextLabel() {
  const n = sequence++;
  return {
    n: n + 1,
    letter: n < 26 ? String.fromCharCode(65 + n) : String(n + 1),
  };
}

let cachedHash: string | null = null;

async function passwordHashFor(password: string) {
  if (password !== TEST_PASSWORD) {
    return hashPassword(password);
  }
  // bcrypt 는 의도적으로 느리다. 기본 비밀번호의 해시는 재사용한다.
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  return cachedHash;
}

export interface RepOverrides {
  role?: Role;
  status?: "ACTIVE" | "INACTIVE";
  managerId?: bigint | null;
  password?: string;
  mustChangePassword?: boolean;
  tokenVersion?: number;
  empNo?: string;
  email?: string;
  name?: string;
}

export async function createRep(o: RepOverrides = {}): Promise<SalesRep> {
  const { n, letter } = nextLabel();
  return prisma.salesRep.create({
    data: {
      empNo: o.empNo ?? `T${String(n).padStart(4, "0")}`,
      name: o.name ?? `테스트사원${letter}`,
      email: o.email ?? `test-${letter.toLowerCase()}@example.com`,
      role: o.role ?? "SALES_REP",
      status: o.status ?? "ACTIVE",
      managerId: o.managerId ?? null,
      mustChangePassword: o.mustChangePassword ?? false,
      tokenVersion: o.tokenVersion ?? 0,
      passwordHash: await passwordHashFor(o.password ?? TEST_PASSWORD),
    },
  });
}

export async function createCustomer(
  assignedRepId: bigint,
  o: Partial<
    Pick<
      Customer,
      "customerName" | "companyName" | "status" | "phone" | "email" | "address"
    >
  > = {},
): Promise<Customer> {
  const { n } = nextLabel();
  return prisma.customer.create({
    data: {
      customerName: o.customerName ?? `테스트고객${n}`,
      companyName: o.companyName ?? "(주)테스트",
      phone: o.phone ?? "02-0000-0000",
      email: o.email ?? `customer-${n}@example.com`,
      address: o.address ?? "테스트시 테스트구 0",
      status: o.status ?? "ACTIVE",
      assignedRepId,
    },
  });
}

export async function createReport(
  repId: bigint,
  o: { reportDate?: string; status?: "DRAFT" | "SUBMITTED" } = {},
): Promise<DailyReport> {
  const status = o.status ?? "DRAFT";
  return prisma.dailyReport.create({
    data: {
      repId,
      reportDate: new Date(`${o.reportDate ?? "2026-07-01"}T00:00:00.000Z`),
      status,
      submittedAt: status === "SUBMITTED" ? new Date() : null,
    },
  });
}

export async function createVisit(
  reportId: bigint,
  customerId: bigint,
  o: { content?: string; sortOrder?: number } = {},
): Promise<VisitRecord> {
  return prisma.visitRecord.create({
    data: {
      reportId,
      customerId,
      visitType: "VISIT",
      content: o.content ?? "테스트 방문 내용",
      sortOrder: o.sortOrder ?? 1,
    },
  });
}

export async function createComment(
  reportId: bigint,
  commenterId: bigint,
  o: { parentCommentId?: bigint | null; content?: string } = {},
): Promise<ReportComment> {
  return prisma.reportComment.create({
    data: {
      reportId,
      commenterId,
      parentCommentId: o.parentCommentId ?? null,
      content: o.content ?? "테스트 댓글",
    },
  });
}

/** 상급자 1명, 직속 팀원 1명이 있는 기본 구성. */
export async function createTeam() {
  const manager = await createRep({ role: "MANAGER" });
  const member = await createRep({ managerId: manager.repId });
  return { manager, member };
}
