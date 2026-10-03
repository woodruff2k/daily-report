import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * 트랜잭션 안/밖을 함께 받을 수 있는 클라이언트 타입.
 *
 * 판정 함수를 트랜잭션 안에서도 쓰려면 `prisma` 와 `tx` 를 모두 받아야 한다.
 * (이슈 #55)
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;
