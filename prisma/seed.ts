import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

// 시드 전용 합성 비밀번호 — 실제 계정에 사용되지 않으며 로컬 개발 DB에만 존재합니다.
const SEED_PASSWORD = "seed-dev-only-Passw0rd!";

async function findOrCreateCustomer(data: {
  customerName: string;
  companyName: string;
  phone: string;
  email: string;
  address: string;
  grade: string;
  assignedRepId: bigint;
}) {
  const existing = await prisma.customer.findFirst({
    where: { customerName: data.customerName },
  });
  if (existing) return existing;
  return prisma.customer.create({ data });
}

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const manager = await prisma.salesRep.upsert({
    where: { empNo: "S2026001" },
    update: {},
    create: {
      empNo: "S2026001",
      name: "김부장",
      email: "test-manager@example.com",
      department: "영업1팀",
      position: "부장",
      passwordHash,
      role: "MANAGER",
      status: "ACTIVE",
    },
  });

  const repA = await prisma.salesRep.upsert({
    where: { empNo: "S2026002" },
    update: {},
    create: {
      empNo: "S2026002",
      name: "홍길동",
      email: "test-a@example.com",
      department: "영업1팀",
      position: "대리",
      managerId: manager.repId,
      passwordHash,
      role: "SALES_REP",
      status: "ACTIVE",
    },
  });

  const repB = await prisma.salesRep.upsert({
    where: { empNo: "S2026003" },
    update: {},
    create: {
      empNo: "S2026003",
      name: "이순신",
      email: "test-b@example.com",
      department: "영업1팀",
      position: "사원",
      managerId: manager.repId,
      passwordHash,
      role: "SALES_REP",
      status: "ACTIVE",
    },
  });

  const customerA = await findOrCreateCustomer({
    customerName: "이몽룡",
    companyName: "(주)A상사",
    phone: "02-000-0001",
    email: "customer-a@example.com",
    address: "서울특별시 강남구",
    grade: "A",
    assignedRepId: repA.repId,
  });

  await findOrCreateCustomer({
    customerName: "성춘향",
    companyName: "B마트",
    phone: "02-000-0002",
    email: "customer-b@example.com",
    address: "서울특별시 서초구",
    grade: "B",
    assignedRepId: repA.repId,
  });

  await findOrCreateCustomer({
    customerName: "변학도",
    companyName: "C물산",
    phone: "02-000-0003",
    email: "customer-c@example.com",
    address: "서울특별시 송파구",
    grade: "C",
    assignedRepId: repB.repId,
  });

  const reportDate = new Date("2026-06-20T00:00:00.000Z");

  const report = await prisma.dailyReport.upsert({
    where: {
      repId_reportDate: {
        repId: repA.repId,
        reportDate,
      },
    },
    update: {},
    create: {
      repId: repA.repId,
      reportDate,
      status: "SUBMITTED",
      submittedAt: new Date("2026-06-20T18:10:00.000Z"),
      visits: {
        create: [
          {
            customerId: customerA.customerId,
            visitTime: "10:00",
            visitType: "VISIT",
            content: "신제품 소개",
            result: "견적요청",
            sortOrder: 1,
          },
          {
            customerId: customerA.customerId,
            visitTime: "14:00",
            visitType: "CALL",
            content: "재고 문의",
            result: "보류",
            sortOrder: 2,
          },
        ],
      },
      problems: {
        create: [
          {
            customerId: customerA.customerId,
            content: "납기 단축 요청",
            status: "OPEN",
          },
        ],
      },
      plans: {
        create: [
          {
            customerId: customerA.customerId,
            plannedDate: new Date("2026-06-21T00:00:00.000Z"),
            content: "견적서 발송",
          },
        ],
      },
    },
  });

  const comment = await prisma.reportComment.findFirst({
    where: { reportId: report.reportId, parentCommentId: null },
  });

  const rootComment =
    comment ??
    (await prisma.reportComment.create({
      data: {
        reportId: report.reportId,
        commenterId: manager.repId,
        content: "견적 일정 확인 바람",
      },
    }));

  const reply = await prisma.reportComment.findFirst({
    where: { parentCommentId: rootComment.commentId },
  });

  if (!reply) {
    await prisma.reportComment.create({
      data: {
        reportId: report.reportId,
        commenterId: repA.repId,
        content: "확인했습니다",
        parentCommentId: rootComment.commentId,
      },
    });
  }

  console.log("Seed 완료");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
