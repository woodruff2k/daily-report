// 통합 테스트(실제 PostgreSQL). 목으로는 확인할 수 없던 트랜잭션·잠금 동작을 검증한다.
// 덮는 TC: TC-RPT-05, TC-SEC-01, TC-VST-01, TC-VST-02, TC-VST-04, TC-VST-05,
//          TC-VST-06(정책 미정 — 현재 동작 고정), TC-SUB-03,
//          TC-CUS-05(비활성 고객의 과거 방문기록 유지), TC-NFR-01, TC-SEC-06
// 이슈 #85(과제·계획 순서): 해당 TC 없음. 가장 가까운 것은 TC-PRB-01·TC-PLN-01(다중 저장).
// 이슈 #87(과제·계획의 고객 이름): 해당 TC 없음. 가장 가까운 것은 TC-RPT-05·TC-SEC-06.
// 이슈 #7: PUT 전체 교체의 원자성, status=DRAFT 조건부 UPDATE 의 직렬화
import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";
import { POST as submit } from "./submit/route";
import { prisma } from "@/lib/prisma";
import { withHeldTransaction } from "@/test/integration/held-transaction";
import {
  createCustomer,
  createRep,
  createReport,
  createTeam,
  createVisit,
} from "@/test/integration/factories";
import { type Actor, call } from "@/test/integration/http";

const getReport = (reportId: bigint, as: Actor) =>
  call(GET, "GET", `/api/reports/${reportId}`, {
    as,
    params: { reportId },
  });

const putReport = (reportId: bigint, as: Actor, body: unknown) =>
  call(PUT, "PUT", `/api/reports/${reportId}`, {
    as,
    body,
    params: { reportId },
  });

const submitReport = (reportId: bigint, as: Actor) =>
  call(submit, "POST", `/api/reports/${reportId}/submit`, {
    as,
    params: { reportId },
  });

const visitRow = (customerId: bigint, content = "테스트 방문 내용") => ({
  customerId: Number(customerId),
  visitType: "VISIT",
  content,
});

describe("GET /api/reports/{id} (실제 DB)", () => {
  it("TC-RPT-05: 본인 보고 상세에 방문·과제·계획이 포함된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId, { sortOrder: 1 });
    await prisma.reportProblem.create({
      data: {
        reportId: report.reportId,
        customerId: customer.customerId,
        content: "테스트 과제",
      },
    });
    await prisma.reportPlan.create({
      data: { reportId: report.reportId, content: "테스트 계획" },
    });

    const result = await getReport(report.reportId, rep);

    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      reportId: Number(report.reportId),
      status: "DRAFT",
      reportDate: "2026-07-01",
      rep: { repId: Number(rep.repId), name: rep.name },
      visits: [
        {
          customer: {
            customerId: Number(customer.customerId),
            customerName: customer.customerName,
          },
          visitType: "VISIT",
        },
      ],
      problems: [{ content: "테스트 과제", status: "OPEN" }],
      plans: [{ content: "테스트 계획" }],
    });
  });

  it("TC-SEC-06: 상세 응답에 고객 연락처·이메일·주소와 사원 이메일·사번이 실리지 않는다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId);

    const result = await getReport(report.reportId, rep);

    expect(result.raw).toContain(customer.customerName);
    for (const secret of [
      customer.phone!,
      customer.email!,
      customer.address!,
      rep.email,
      rep.empNo,
      rep.passwordHash,
    ]) {
      expect(result.raw).not.toContain(secret);
    }
  });

  it("이슈 #87: 과제·계획이 고객 이름을 담고, 고객이 없으면 null 이며, 비활성 고객도 이름이 온다", async () => {
    const rep = await createRep();
    const active = await createCustomer(rep.repId);
    const inactive = await createCustomer(rep.repId, { status: "INACTIVE" });
    const report = await createReport(rep.repId);
    const base = { reportId: report.reportId };
    await prisma.reportProblem.createMany({
      data: [
        {
          ...base,
          customerId: active.customerId,
          content: "활성 과제",
          sortOrder: 1,
        },
        { ...base, customerId: null, content: "무고객 과제", sortOrder: 2 },
        {
          ...base,
          customerId: inactive.customerId,
          content: "비활성 과제",
          sortOrder: 3,
        },
      ],
    });
    await prisma.reportPlan.createMany({
      data: [
        {
          ...base,
          customerId: active.customerId,
          content: "활성 계획",
          sortOrder: 1,
        },
        { ...base, customerId: null, content: "무고객 계획", sortOrder: 2 },
        {
          ...base,
          customerId: inactive.customerId,
          content: "비활성 계획",
          sortOrder: 3,
        },
      ],
    });

    const result = await getReport(report.reportId, rep);

    expect(result.status).toBe(200);
    const activeRef = {
      customerId: Number(active.customerId),
      customerName: active.customerName,
    };
    const inactiveRef = {
      customerId: Number(inactive.customerId),
      customerName: inactive.customerName,
    };
    const data = result.body.data as {
      problems: { customer: unknown }[];
      plans: { customer: unknown }[];
    };
    expect(data.problems.map((row) => row.customer)).toEqual([
      activeRef,
      null,
      inactiveRef,
    ]);
    expect(data.plans.map((row) => row.customer)).toEqual([
      activeRef,
      null,
      inactiveRef,
    ]);
    expect(data.problems[0]).not.toHaveProperty("customerId");
    for (const secret of [
      active.phone!,
      active.email!,
      active.address!,
      inactive.phone!,
      inactive.email!,
      inactive.address!,
    ]) {
      expect(result.raw).not.toContain(secret);
    }
    for (const key of ['"email"', '"address"', '"phone"']) {
      expect(result.raw).not.toContain(key);
    }
  });

  it("TC-SEC-01: 다른 사원의 보고(상급자 아님)는 403 이다 (IDOR)", async () => {
    const owner = await createRep();
    const intruder = await createRep();
    const report = await createReport(owner.repId);

    const result = await getReport(report.reportId, intruder);

    expect(result.status).toBe(403);
    expect(result.body.data).toBeNull();
  });

  it("TC-SEC-01: 다른 팀 상급자도 403 이다", async () => {
    const { member } = await createTeam();
    const { manager: otherManager } = await createTeam();
    const report = await createReport(member.repId);

    const result = await getReport(report.reportId, otherManager);

    expect(result.status).toBe(403);
  });

  it("직속 상급자는 팀원 보고를 조회할 수 있다", async () => {
    const { manager, member } = await createTeam();
    const report = await createReport(member.repId);

    const result = await getReport(report.reportId, manager);

    expect(result.status).toBe(200);
  });

  it("없는 보고는 404 이다", async () => {
    const rep = await createRep();

    const result = await getReport(99999n, rep);

    expect(result.status).toBe(404);
  });
});

describe("PUT /api/reports/{id} (실제 DB)", () => {
  it("TC-VST-01: 방문 2행을 저장하면 200 이고 DB 에 2건이 저장된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);

    const result = await putReport(report.reportId, rep, {
      visits: [
        visitRow(customer.customerId, "첫 방문"),
        visitRow(customer.customerId, "두번째 방문"),
      ],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    expect(
      result.body.data.visits.map((v: { content: string }) => v.content),
    ).toEqual(["첫 방문", "두번째 방문"]);
    const rows = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows.map((r) => r.content)).toEqual(["첫 방문", "두번째 방문"]);
  });

  it("TC-VST-02: customerId 가 없는 행은 400 이고 DB 가 바뀌지 않는다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    const existing = await createVisit(report.reportId, customer.customerId);

    const result = await putReport(report.reportId, rep, {
      visits: [{ visitType: "VISIT", content: "고객 없는 행" }],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(400);
    const rows = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
    });
    expect(rows.map((r) => r.visitId)).toEqual([existing.visitId]);
  });

  it("TC-VST-05: 전송하지 않은 기존 행은 삭제되고 보낸 행은 유지된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    const keep = await createVisit(report.reportId, customer.customerId, {
      content: "유지",
    });
    await createVisit(report.reportId, customer.customerId, {
      content: "삭제 대상",
      sortOrder: 2,
    });

    const result = await putReport(report.reportId, rep, {
      visits: [
        {
          ...visitRow(customer.customerId, "유지(수정)"),
          visitId: Number(keep.visitId),
        },
      ],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    const rows = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      visitId: keep.visitId,
      content: "유지(수정)",
    });
  });

  it("이슈 #7 원자성: 자식 행 생성 단계에서 DB 오류가 나면 이미 지운 기존 방문·과제·계획이 롤백된다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId, {
      content: "기존1",
    });
    await createVisit(report.reportId, customer.customerId, {
      content: "기존2",
      sortOrder: 2,
    });
    await prisma.reportProblem.create({
      data: { reportId: report.reportId, content: "기존 과제" },
    });
    await prisma.reportPlan.create({
      data: { reportId: report.reportId, content: "기존 계획" },
    });
    const before = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: report.reportId },
    });

    // 실패 주입: 같은 트랜잭션 안에서 deleteMany 3건이 실행된 뒤 방문 createMany 만
    // 던지게 한다. 입력 값(NUL 등)이 아니라 쓰기 단계 자체를 실패시키므로, 입력 검증이
    // 강화돼도 이 테스트는 영향받지 않는다. 롤백은 실제 PostgreSQL 이 한다.
    // 트랜잭션 밖(prisma)에서 쓰도록 바뀌면 deleteMany 가 커밋되어 아래 단언이 깨진다.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const realTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) =>
      realTransaction((tx) =>
        callback(
          new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop !== "visitRecord") {
                return Reflect.get(target, prop, receiver);
              }
              return new Proxy(target.visitRecord, {
                get(model, method) {
                  if (method === "createMany") {
                    return () => Promise.reject(new Error("injected failure"));
                  }
                  return Reflect.get(model, method);
                },
              });
            },
          }),
        ),
      )) as never);

    const failed = await putReport(report.reportId, rep, {
      visits: [visitRow(customer.customerId, "새 행")],
      problems: [],
      plans: [],
    });
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe("INTERNAL_ERROR");

    const visits = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
      orderBy: { visitId: "asc" },
    });
    expect(visits.map((v) => v.content)).toEqual(["기존1", "기존2"]);
    expect(
      await prisma.reportProblem.count({
        where: { reportId: report.reportId },
      }),
    ).toBe(1);
    expect(
      await prisma.reportPlan.count({ where: { reportId: report.reportId } }),
    ).toBe(1);
    const after = await prisma.dailyReport.findUniqueOrThrow({
      where: { reportId: report.reportId },
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("이슈 #75: content 의 NUL 문자는 500 이 아니라 400 이고 기존 행이 그대로다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId, {
      content: "기존",
    });

    const result = await putReport(report.reportId, rep, {
      visits: [visitRow(customer.customerId, "깨지는\u0000행")],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("INVALID_REQUEST");
    expect(result.raw).not.toContain("stack");
    const visits = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
    });
    expect(visits.map((v) => v.content)).toEqual(["기존"]);
  });

  it("이슈 #75: 줄바꿈·탭이 든 content 는 그대로 저장된다 (회귀)", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);

    const result = await putReport(report.reportId, rep, {
      visits: [visitRow(customer.customerId, "1줄\n2줄\t탭")],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    const visit = await prisma.visitRecord.findFirstOrThrow({
      where: { reportId: report.reportId },
    });
    expect(visit.content).toBe("1줄\n2줄\t탭");
  });

  it("TC-SEC-01: 남의 보고 PUT 은 403 이고 내용이 바뀌지 않는다", async () => {
    const owner = await createRep();
    const intruder = await createRep();
    const customer = await createCustomer(owner.repId);
    const report = await createReport(owner.repId);
    await createVisit(report.reportId, customer.customerId);

    const result = await putReport(report.reportId, intruder, {
      visits: [],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(403);
    expect(
      await prisma.visitRecord.count({ where: { reportId: report.reportId } }),
    ).toBe(1);
  });

  it("TC-SUB-03: 제출된 보고의 PUT 은 409 REPORT_LOCKED 이고 내용이 바뀌지 않는다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId, { status: "SUBMITTED" });
    await createVisit(report.reportId, customer.customerId);

    const result = await putReport(report.reportId, rep, {
      visits: [],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("REPORT_LOCKED");
    expect(
      await prisma.visitRecord.count({ where: { reportId: report.reportId } }),
    ).toBe(1);
  });

  it("이슈 #7 직렬화: PUT 과 submit 을 동시에 보내도 제출 뒤에는 어떤 쓰기도 반영되지 않는다", async () => {
    // PUT 은 상태를 바꾸지 않으므로 순서에 따라 결과가 갈린다.
    //   PUT 먼저 → PUT 200, submit 200 (PUT 내용이 제출본에 포함)
    //   submit 먼저 → submit 200, PUT 409 REPORT_LOCKED (원본 유지)
    // 금지되는 결과: PUT 이 200 인데 내용이 반영되지 않았거나, 409 인데 내용이 바뀐 경우,
    // submit 이 실패하는 경우, 500.
    // 순서는 보장되지 않으므로 반복해서 두 갈래를 모두 지난다.
    const outcomes = new Set<string>();

    for (let i = 0; i < 12; i += 1) {
      const rep = await createRep();
      const customer = await createCustomer(rep.repId);
      const report = await createReport(rep.repId, {
        reportDate: `2026-08-${String(i + 1).padStart(2, "0")}`,
      });
      await createVisit(report.reportId, customer.customerId, {
        content: "원본",
      });

      const [put, sub] = await Promise.all([
        putReport(report.reportId, rep, {
          visits: [
            visitRow(customer.customerId, "수정1"),
            visitRow(customer.customerId, "수정2"),
          ],
          problems: [],
          plans: [],
        }),
        submitReport(report.reportId, rep),
      ]);

      expect(sub.status).toBe(200);
      expect([200, 409]).toContain(put.status);

      const row = await prisma.dailyReport.findUniqueOrThrow({
        where: { reportId: report.reportId },
        include: { visits: { orderBy: { visitId: "asc" } } },
      });
      expect(row.status).toBe("SUBMITTED");
      expect(row.submittedAt).not.toBeNull();

      if (put.status === 200) {
        outcomes.add("put-first");
        expect(row.visits.map((v) => v.content).sort()).toEqual([
          "수정1",
          "수정2",
        ]);
      } else {
        outcomes.add("submit-first");
        expect(put.body.error.code).toBe("REPORT_LOCKED");
        expect(row.visits.map((v) => v.content)).toEqual(["원본"]);
      }
    }

    // 어느 갈래가 나왔는지는 보고용 정보일 뿐 단언하지 않는다(실행 순서 비결정).
    expect(outcomes.size).toBeGreaterThan(0);
  });

  it("이슈 #7 직렬화(결정적): 다른 트랜잭션이 제출을 커밋하기 전에 읽은 DRAFT 로 들어온 PUT 은 409 REPORT_LOCKED 이고 내용이 바뀌지 않는다", async () => {
    // PUT 의 첫 읽기는 커밋된 DRAFT 를 본다(assertReportEditable 통과). 그 뒤
    // status=DRAFT 조건부 UPDATE 가 제출 트랜잭션의 행 잠금에 막혀 대기하고, 제출이
    // 커밋되면 조건을 다시 평가해 0행이 된다. 이 재평가가 없으면 PUT 이 제출본을 덮는다.
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId, {
      content: "원본",
    });

    const put = await withHeldTransaction(
      (tx) =>
        tx.dailyReport
          .update({
            where: { reportId: report.reportId },
            data: { status: "SUBMITTED", submittedAt: new Date() },
          })
          .then(() => undefined),
      () =>
        putReport(report.reportId, rep, {
          visits: [visitRow(customer.customerId, "제출 뒤 덮어쓰기")],
          problems: [],
          plans: [],
        }),
    );

    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe("REPORT_LOCKED");
    const visits = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
    });
    expect(visits.map((v) => v.content)).toEqual(["원본"]);
  });

  it("이슈 #7 직렬화(결정적): 같은 상황에서 늦게 도착한 제출은 409 REPORT_ALREADY_SUBMITTED 이다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    await createVisit(report.reportId, customer.customerId);

    const second = await withHeldTransaction(
      (tx) =>
        tx.dailyReport
          .update({
            where: { reportId: report.reportId },
            data: { status: "SUBMITTED", submittedAt: new Date() },
          })
          .then(() => undefined),
      () => submitReport(report.reportId, rep),
    );

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("REPORT_ALREADY_SUBMITTED");
  });

  it("TC-NFR-03: 같은 보고에 PUT 둘을 동시에 보내면 둘 다 성공하고 최종 상태는 한 쪽 내용이다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    const body = (content: string) => ({
      visits: [visitRow(customer.customerId, content)],
      problems: [],
      plans: [],
    });

    const results = await Promise.all([
      putReport(report.reportId, rep, body("A안")),
      putReport(report.reportId, rep, body("B안")),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const rows = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
    });
    expect(rows).toHaveLength(1);
    expect(["A안", "B안"]).toContain(rows[0].content);
  });
});

describe("TC-CUS-05 비활성 고객의 과거 방문기록 유지 (실제 DB)", () => {
  it("고객을 INACTIVE 로 바꿔도 과거 보고 상세에 방문기록과 고객명이 그대로 보인다", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId);
    const report = await createReport(rep.repId, { status: "SUBMITTED" });
    await createVisit(report.reportId, customer.customerId, {
      content: "과거 방문",
    });
    await prisma.customer.update({
      where: { customerId: customer.customerId },
      data: { status: "INACTIVE" },
    });

    const result = await getReport(report.reportId, rep);

    expect(result.status).toBe(200);
    expect(result.body.data.visits).toHaveLength(1);
    expect(result.body.data.visits[0]).toMatchObject({
      content: "과거 방문",
      customer: {
        customerId: Number(customer.customerId),
        customerName: customer.customerName,
      },
    });
  });

  it("비활성 고객을 참조하는 방문기록이 있는 보고를 다시 저장해도 유지된다(NFR-03)", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId, { status: "INACTIVE" });
    const report = await createReport(rep.repId);
    const visit = await createVisit(report.reportId, customer.customerId);

    const result = await putReport(report.reportId, rep, {
      visits: [
        {
          ...visitRow(customer.customerId, "수정"),
          visitId: Number(visit.visitId),
        },
      ],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    expect(result.body.data.visits[0].customer.customerId).toBe(
      Number(customer.customerId),
    );
  });
});

// 이슈 #85. 단위 테스트의 Prisma 목은 orderBy 를 틀리게 써도 통과하므로 실제 DB 로 본다.
describe("과제·계획 순서 (실제 DB, 이슈 #85)", () => {
  type Kind = "problems" | "plans";
  const idKey = { problems: "problemId", plans: "planId" } as const;

  const body = (kind: Kind, rows: object[]) => ({
    visits: [],
    problems: kind === "problems" ? rows : [],
    plans: kind === "plans" ? rows : [],
  });

  const contents = (data: Record<Kind, { content: string }[]>, kind: Kind) =>
    data[kind].map((row) => row.content);

  it.each(["problems", "plans"] as const)(
    "%s: 중간에 끼워 넣고 sortOrder 를 다시 매겨 저장하면 배열한 순서가 유지된다",
    async (kind) => {
      const rep = await createRep();
      const report = await createReport(rep.repId);

      // 1. A·B·C 저장 — 식별자가 오름차순으로 붙는다.
      const first = await putReport(
        report.reportId,
        rep,
        body(kind, [{ content: "A" }, { content: "B" }, { content: "C" }]),
      );
      expect(first.status).toBe(200);
      const saved = first.body.data[kind] as Record<string, number>[] &
        { content: string }[];
      const ids = saved.map((row) => row[idKey[kind]]);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
      expect(contents(first.body.data, kind)).toEqual(["A", "B", "C"]);
      expect(saved.map((row) => row.sortOrder)).toEqual([1, 2, 3]);

      // 2. A 와 B 사이에 D 를 끼워 1·2·3·4 로 다시 매긴다. D 의 식별자가 가장 크다.
      const [a, b, c] = ids;
      const second = await putReport(
        report.reportId,
        rep,
        body(kind, [
          { [idKey[kind]]: a, content: "A", sortOrder: 1 },
          { content: "D", sortOrder: 2 },
          { [idKey[kind]]: b, content: "B", sortOrder: 3 },
          { [idKey[kind]]: c, content: "C", sortOrder: 4 },
        ]),
      );
      expect(second.status).toBe(200);

      // 3. 다시 읽으면 A·D·B·C 다.
      const reread = await getReport(report.reportId, rep);
      expect(contents(reread.body.data, kind)).toEqual(["A", "D", "B", "C"]);
      expect(
        reread.body.data[kind].map(
          (row: { sortOrder: number }) => row.sortOrder,
        ),
      ).toEqual([1, 2, 3, 4]);
    },
  );

  it("sortOrder 를 생략하면 요청에 담은 순서가 저장 순서가 된다", async () => {
    const rep = await createRep();
    const report = await createReport(rep.repId);
    await putReport(
      report.reportId,
      rep,
      body("problems", [{ content: "A" }, { content: "B" }]),
    );
    const [rowA, rowB] = await prisma.reportProblem.findMany({
      where: { reportId: report.reportId },
      orderBy: { problemId: "asc" },
    });

    // B 를 앞으로 옮기되 sortOrder 는 보내지 않는다.
    await putReport(
      report.reportId,
      rep,
      body("problems", [
        { problemId: Number(rowB.problemId), content: "B" },
        { problemId: Number(rowA.problemId), content: "A" },
      ]),
    );

    const reread = await getReport(report.reportId, rep);
    expect(contents(reread.body.data, "problems")).toEqual(["B", "A"]);
  });

  it("sortOrder 가 모두 0 인 기존 데이터는 식별자 순서가 유지된다 (2차 키)", async () => {
    const rep = await createRep();
    const report = await createReport(rep.repId);
    // 마이그레이션 직후의 상태: 컬럼 기본값 0 이 모든 기존 행에 채워진다.
    // 삽입 순서와 식별자 순서가 같도록 하나씩 만든다.
    for (const content of ["A", "B", "C", "D", "E"]) {
      await prisma.reportProblem.create({
        data: { reportId: report.reportId, content, sortOrder: 0 },
      });
      await prisma.reportPlan.create({
        data: { reportId: report.reportId, content, sortOrder: 0 },
      });
    }
    // 앞쪽 행을 갱신해 새 튜플 위치로 옮긴다. 다만 **이것이 2차 키를 지키지는
    // 못한다** — 동점일 때 DB 가 어떤 순서를 주는지는 보장이 없고(힙 배치·HOT
    // 갱신·PK 인덱스 스캔 선택에 달려 있다), 우연히 식별자 순서로 나오면 2차 키를
    // 지워도 이 테스트가 통과한다. 결정적인 보장은 `src/lib/report.test.ts` 의
    // "REPORT_DETAIL_INCLUDE 정렬" 이 `orderBy` 모양을 직접 단언해서 한다.
    // 여기서는 실제 DB 에서도 기대한 순서로 나오는지를 본다.
    await prisma.reportProblem.updateMany({
      where: { reportId: report.reportId, content: { in: ["A", "B"] } },
      data: { sortOrder: 0 },
    });
    await prisma.reportPlan.updateMany({
      where: { reportId: report.reportId, content: { in: ["A", "B"] } },
      data: { sortOrder: 0 },
    });

    const result = await getReport(report.reportId, rep);

    expect(contents(result.body.data, "problems")).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    expect(contents(result.body.data, "plans")).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });
});

// 이슈 #93: 뮤테이션 확인에서 `replaceReportContent` 의 삭제 조건(reportId)을 지워도 단위·
// 통합 테스트가 모두 통과하는 곳이 있었다(계획). 목으로는 where 의 모양만 보이고, 실제로
// 다른 보고의 행이 남는지는 DB 로만 확인된다.
describe("PUT 전체 교체는 그 보고의 행만 건드린다 (실제 DB, IDOR·폭발 반경)", () => {
  it("다른 보고의 방문·과제·계획은 이 보고를 비워도 지워지지 않는다", async () => {
    const rep = await createRep();
    const other = await createRep();
    const customer = await createCustomer(rep.repId);
    const mine = await createReport(rep.repId, { reportDate: "2026-07-01" });
    const theirs = await createReport(other.repId, {
      reportDate: "2026-07-01",
    });
    for (const report of [mine, theirs]) {
      await createVisit(report.reportId, customer.customerId);
      await prisma.reportProblem.create({
        data: { reportId: report.reportId, content: "과제" },
      });
      await prisma.reportPlan.create({
        data: { reportId: report.reportId, content: "계획" },
      });
    }

    const result = await putReport(mine.reportId, rep, {
      visits: [],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    const count = async (reportId: bigint) => ({
      visits: await prisma.visitRecord.count({ where: { reportId } }),
      problems: await prisma.reportProblem.count({ where: { reportId } }),
      plans: await prisma.reportPlan.count({ where: { reportId } }),
    });
    expect(await count(mine.reportId)).toEqual({
      visits: 0,
      problems: 0,
      plans: 0,
    });
    expect(await count(theirs.reportId)).toEqual({
      visits: 1,
      problems: 1,
      plans: 1,
    });
  });

  // 남의 보고의 행 식별자를 섞어 보내도 (IDOR) 그 행이 바뀌거나 가져와지지 않는다.
  it.each([
    ["visits", "VISIT_NOT_IN_REPORT"],
    ["problems", "PROBLEM_NOT_IN_REPORT"],
    ["plans", "PLAN_NOT_IN_REPORT"],
  ] as const)(
    "%s: 남의 보고의 행 식별자를 보내면 400 %s 이고 그 행은 그대로다",
    async (kind, code) => {
      const rep = await createRep();
      const other = await createRep();
      const customer = await createCustomer(rep.repId);
      const mine = await createReport(rep.repId, { reportDate: "2026-07-01" });
      const theirs = await createReport(other.repId, {
        reportDate: "2026-07-01",
      });
      const foreign = {
        visits: await createVisit(theirs.reportId, customer.customerId, {
          content: "남의 방문",
        }),
        problems: await prisma.reportProblem.create({
          data: { reportId: theirs.reportId, content: "남의 과제" },
        }),
        plans: await prisma.reportPlan.create({
          data: { reportId: theirs.reportId, content: "남의 계획" },
        }),
      };
      const foreignId = {
        visits: { visitId: Number(foreign.visits.visitId) },
        problems: { problemId: Number(foreign.problems.problemId) },
        plans: { planId: Number(foreign.plans.planId) },
      } as const;
      const body = {
        visits: [] as unknown[],
        problems: [] as unknown[],
        plans: [] as unknown[],
        [kind]: [
          {
            ...foreignId[kind],
            customerId: Number(customer.customerId),
            visitType: "VISIT",
            content: "가로채기",
          },
        ],
      };

      const result = await putReport(mine.reportId, rep, body);

      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe(code);
      const stillTheirs = {
        visits: await prisma.visitRecord.findUniqueOrThrow({
          where: { visitId: foreign.visits.visitId },
        }),
        problems: await prisma.reportProblem.findUniqueOrThrow({
          where: { problemId: foreign.problems.problemId },
        }),
        plans: await prisma.reportPlan.findUniqueOrThrow({
          where: { planId: foreign.plans.planId },
        }),
      };
      expect(stillTheirs.visits).toMatchObject({
        reportId: theirs.reportId,
        content: "남의 방문",
      });
      expect(stillTheirs.problems).toMatchObject({
        reportId: theirs.reportId,
        content: "남의 과제",
      });
      expect(stillTheirs.plans).toMatchObject({
        reportId: theirs.reportId,
        content: "남의 계획",
      });
    },
  );
});

describe("방문 행 수정·비활성 고객 (실제 DB)", () => {
  it("TC-VST-04: visitId 를 포함해 PUT 하면 그 행이 수정되고 다른 행과 식별자는 그대로다", async () => {
    const rep = await createRep();
    const customerA = await createCustomer(rep.repId);
    const customerB = await createCustomer(rep.repId);
    const report = await createReport(rep.repId);
    const first = await createVisit(report.reportId, customerA.customerId, {
      content: "원래 내용",
      sortOrder: 1,
    });
    const second = await createVisit(report.reportId, customerA.customerId, {
      content: "손대지 않음",
      sortOrder: 2,
    });

    const result = await putReport(report.reportId, rep, {
      visits: [
        {
          visitId: Number(first.visitId),
          customerId: Number(customerB.customerId),
          visitType: "CALL",
          content: "고친 내용",
          result: "고친 결과",
          sortOrder: 1,
        },
        {
          visitId: Number(second.visitId),
          customerId: Number(customerA.customerId),
          visitType: "VISIT",
          content: "손대지 않음",
          sortOrder: 2,
        },
      ],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    const rows = await prisma.visitRecord.findMany({
      where: { reportId: report.reportId },
      orderBy: { visitId: "asc" },
    });
    // 새로 만들고 지운 것이 아니라 같은 행을 고쳤다 — 식별자가 그대로다.
    expect(rows.map((r) => r.visitId)).toEqual([first.visitId, second.visitId]);
    expect(rows[0]).toMatchObject({
      customerId: customerB.customerId,
      visitType: "CALL",
      content: "고친 내용",
      result: "고친 결과",
    });
    expect(rows[1]).toMatchObject({
      customerId: customerA.customerId,
      content: "손대지 않음",
    });
    expect(
      result.body.data.visits.map((v: { visitId: number }) => v.visitId),
    ).toEqual([Number(first.visitId), Number(second.visitId)]);
  });

  // TC-VST-06 (Low): 명세는 "정책에 따른 처리(차단/경고)" 라고만 적고 정책을 정하지 않았다.
  // **정책 결정 필요.** 아래는 현재 구현의 동작을 고정한다 — 비활성 고객으로의 저장을
  // 막지 않는다(NFR-03: 과거 참조를 유지한다). 정책이 "차단" 으로 정해지면 이 테스트를
  // 고쳐야 한다. 기존 행의 재저장은 위 TC-CUS-05 블록이 이미 덮고, 여기는 신규 행이다.
  it("TC-VST-06: 비활성 고객으로 새 방문 행을 저장해도 막지 않고 저장한다 (현재 정책, 결정 필요)", async () => {
    const rep = await createRep();
    const customer = await createCustomer(rep.repId, { status: "INACTIVE" });
    const report = await createReport(rep.repId);

    const result = await putReport(report.reportId, rep, {
      visits: [visitRow(customer.customerId, "비활성 고객 방문")],
      problems: [],
      plans: [],
    });

    expect(result.status).toBe(200);
    const saved = await prisma.visitRecord.findFirstOrThrow({
      where: { reportId: report.reportId },
    });
    expect(saved).toMatchObject({
      customerId: customer.customerId,
      content: "비활성 고객 방문",
    });
  });
});
