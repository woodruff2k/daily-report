import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * 잠금 경합을 `sleep` 없이 결정적으로 재현한다.
 *
 * 1. 별도 트랜잭션이 `hold` 로 변경(과 잠금)을 만들고 **커밋하지 않은 채** 붙잡는다.
 * 2. `whileHeld` 가 요청을 띄운다. 요청은 그 잠금 때문에 DB 에서 대기한다.
 * 3. PostgreSQL 이 "잠금 대기 중인 쿼리가 있다"고 보고할 때까지 조건을 확인한다
 *    (`pg_stat_activity.wait_event_type = 'Lock'`). 시간을 맞추는 sleep 이 아니다.
 * 4. 붙잡은 트랜잭션을 커밋한다. 대기하던 요청이 커밋된 상태를 보고 이어진다.
 *
 * 요청이 애초에 대기하지 않고 끝나면(잠금이 없다는 뜻) 대기를 멈추고 그 결과를
 * 그대로 돌려준다. 호출한 테스트의 단언이 그 차이를 잡는다.
 */
export async function withHeldTransaction<T>(
  hold: (tx: Prisma.TransactionClient) => Promise<void>,
  whileHeld: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const isHeld = new Promise<void>((resolve) => {
    held = resolve;
  });

  const holder = prisma.$transaction(
    async (tx) => {
      await hold(tx);
      held();
      await gate;
    },
    { timeout: 30_000 },
  );
  // hold 가 실패하면 gate 를 기다리는 일이 없으므로 isHeld 대신 holder 가 던진다.
  await Promise.race([isHeld, holder]);

  const pending = whileHeld();
  const settled = pending.then(
    () => undefined,
    () => undefined,
  );

  try {
    await Promise.race([waitForLockWait(), settled]);
  } finally {
    release();
    await holder;
  }

  return pending;
}

async function waitForLockWait(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (n > 0) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error("요청이 잠금 대기 상태에 들어가지 않았습니다.");
}
