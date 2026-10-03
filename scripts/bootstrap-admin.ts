/**
 * 최초 ADMIN 계정을 만든다. (이슈 #48)
 *
 * 영업 마스터 API 는 ADMIN 전용이고, ADMIN 을 만드는 경로도 그 API 안에 있다.
 * 계정이 하나도 없는 환경에서는 이 고리를 끊을 방법이 필요하다. seed 는 로컬
 * 개발 DB 전용이라(더미 고객·보고까지 넣는다) 운영에서는 쓸 수 없다.
 *
 * 실행:
 *   BOOTSTRAP_ADMIN_EMP_NO=S0000001 \
 *   BOOTSTRAP_ADMIN_NAME=관리자 \
 *   BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='...' \
 *   npm run bootstrap:admin
 *
 * 비밀번호는 환경 변수로만 받는다. 인자로 받으면 셸 히스토리와 프로세스 목록에
 * 남는다. 이 스크립트는 비밀번호를 출력하지 않는다.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경 변수가 필요합니다.`);
  }
  return value;
}

async function main() {
  const empNo = required("BOOTSTRAP_ADMIN_EMP_NO");
  const name = required("BOOTSTRAP_ADMIN_NAME");
  const email = required("BOOTSTRAP_ADMIN_EMAIL");
  const password = required("BOOTSTRAP_ADMIN_PASSWORD");

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  }

  // 이미 쓸 수 있는 관리자가 있으면 멈춘다. 부트스트랩은 고리를 끊는 용도이고,
  // 추가 관리자는 API(POST /api/sales-reps)로 만드는 것이 기록에 남는다.
  const existingAdmin = await prisma.salesRep.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { empNo: true },
  });

  if (existingAdmin) {
    throw new Error(
      `이미 활성 관리자(${existingAdmin.empNo})가 있습니다. 추가 관리자는 API로 등록하세요.`
    );
  }

  const created = await prisma.salesRep.create({
    data: {
      empNo,
      name,
      email,
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash: await hashPassword(password),
    },
    select: { repId: true, empNo: true },
  });

  // 비밀번호와 이메일은 출력하지 않는다. (NFR-04)
  console.log(`관리자 계정을 만들었습니다. repId=${created.repId} empNo=${created.empNo}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "알 수 없는 오류");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
