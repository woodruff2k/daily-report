import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_REPORT_ROW,
  REPLY,
  DELETED_ROOT,
  ROOT_COMMENT,
  SUBMITTED_REPORT_ROW,
  asAdmin,
  asManager,
  asOtherManager,
  asOtherRep,
  asSalesRep,
  readBody,
  reportParams,
  withoutAuth,
} from "@/test/comment-fixtures";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    dailyReport: { findUnique: vi.fn() },
    reportComment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET, POST } from "./route";

const URL = "http://localhost/api/reports/10/comments";
const get = (request = asSalesRep(URL), id = "10") =>
  GET(request, reportParams(id));
const post = (body: unknown, make: typeof asManager = asManager, id = "10") =>
  POST(make(URL, { method: "POST", body }), reportParams(id));

const CREATED = {
  commentId: 402n,
  parentCommentId: null,
  content: "견적 일정 확인 바람",
  createdAt: new Date("2026-06-20T10:00:00.000Z"),
  deletedAt: null,
  commenter: { repId: 2n, name: "테스트상급자" },
};

beforeEach(() => {
  vi.mocked(prisma.$transaction)
    .mockReset()
    .mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
  vi.mocked(prisma.$queryRaw)
    .mockReset()
    .mockResolvedValue([] as never);
  vi.mocked(prisma.dailyReport.findUnique)
    .mockReset()
    .mockResolvedValue(SUBMITTED_REPORT_ROW as never);
  vi.mocked(prisma.reportComment.findMany)
    .mockReset()
    .mockResolvedValue([ROOT_COMMENT] as never);
  vi.mocked(prisma.reportComment.findUnique)
    .mockReset()
    .mockResolvedValue({
      reportId: 10n,
      parentCommentId: null,
      deletedAt: null,
    } as never);
  vi.mocked(prisma.reportComment.create)
    .mockReset()
    .mockResolvedValue(CREATED as never);
});

describe("GET /api/reports/{reportId}/comments — TC-CMT-03", () => {
  it("TC-CMT-03: 루트 댓글 아래 replies 로 계층 구조를 반환한다", async () => {
    const response = await get(asManager(URL));
    const body = await readBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        commentId: 400,
        deleted: false,
        commenter: { repId: 2, name: "테스트상급자" },
        content: "견적 일정 확인 바람",
        parentCommentId: null,
        createdAt: "2026-06-20T10:00:00.000Z",
        replies: [
          {
            commentId: 401,
            deleted: false,
            commenter: { repId: 1, name: "테스트사원" },
            content: "확인했습니다",
            parentCommentId: 400,
            createdAt: "2026-06-20T10:10:00.000Z",
          },
        ],
      },
    ]);
  });

  it("소프트 삭제된 댓글은 deleted:true 이고 content·commenter 가 응답에 없다 (이슈 #71)", async () => {
    vi.mocked(prisma.reportComment.findMany).mockResolvedValue([
      DELETED_ROOT,
    ] as never);
    const body = await readBody(await get());
    const [root] = body.data as unknown as Record<string, unknown>[];

    expect(root).toEqual({
      commentId: 400,
      deleted: true,
      parentCommentId: null,
      createdAt: "2026-06-20T10:00:00.000Z",
      // 스레드 구조는 남는다 — 대댓글은 그대로 부모 아래에 있다.
      replies: [expect.objectContaining({ commentId: 401, deleted: false })],
    });
    expect(JSON.stringify(body)).not.toContain("견적 일정 확인 바람");
    expect(JSON.stringify(body)).not.toContain("테스트상급자");
  });

  it("한 쿼리로 읽고 작성순 정렬하며 작성자는 repId·name 만 읽는다 (NFR-04)", async () => {
    await get();
    const args = vi.mocked(prisma.reportComment.findMany).mock.calls[0][0];

    expect(prisma.reportComment.findMany).toHaveBeenCalledTimes(1);
    expect(args).toMatchObject({
      where: { reportId: 10n, parentCommentId: null },
      orderBy: [{ createdAt: "asc" }, { commentId: "asc" }],
      select: {
        commenter: { select: { repId: true, name: true } },
        replies: {
          orderBy: [{ createdAt: "asc" }, { commentId: "asc" }],
          select: { commenter: { select: { repId: true, name: true } } },
        },
      },
    });
  });

  it("작성자 본인도 볼 수 있고, 응답에 이메일·사번이 없다", async () => {
    const response = await get(asSalesRep(URL));
    const text = JSON.stringify(await readBody(response));

    expect(response.status).toBe(200);
    expect(text).not.toMatch(/email|empNo/);
  });

  it("댓글이 없으면 빈 배열 200", async () => {
    vi.mocked(prisma.reportComment.findMany).mockResolvedValue([]);
    const response = await get();

    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toEqual([]);
  });

  it("작성중 보고도 빈 배열 200 이다 (404 아님)", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      DRAFT_REPORT_ROW as never,
    );
    vi.mocked(prisma.reportComment.findMany).mockResolvedValue([]);
    const response = await get();

    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toEqual([]);
  });

  it("무관한 사원·타 팀 상급자는 403 이고 댓글을 읽지 않는다", async () => {
    expect((await get(asOtherRep(URL))).status).toBe(403);
    expect((await get(asOtherManager(URL))).status).toBe(403);
    expect(prisma.reportComment.findMany).not.toHaveBeenCalled();
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it.each(["abc", "9007199254740993", "0"])(
    "잘못된 식별자 %s 는 400",
    async (id) => {
      expect((await get(asSalesRep(URL), id)).status).toBe(400);
    },
  );

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await get(asAdmin(URL))).status).toBe(403);
    expect((await get(withoutAuth(URL))).status).toBe(401);
    expect(prisma.dailyReport.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/reports/{reportId}/comments — TC-CMT-01·02, TC-SEC-04", () => {
  it("TC-CMT-01: 상급자가 제출된 보고에 댓글을 쓰면 201", async () => {
    const response = await post({ content: "  견적 일정 확인 바람  " });
    const body = await readBody(response);

    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      commentId: 402,
      deleted: false,
      commenter: { repId: 2, name: "테스트상급자" },
      content: "견적 일정 확인 바람",
      parentCommentId: null,
      createdAt: "2026-06-20T10:00:00.000Z",
    });
    // 작성자는 본문이 아니라 인증 컨텍스트, 내용은 trim 된 값이다.
    expect(prisma.reportComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reportId: 10n,
          commenterId: 2n,
          parentCommentId: null,
          content: "견적 일정 확인 바람",
        },
      }),
    );
  });

  it("본문의 commenterId 는 무시한다", async () => {
    await post({ content: "내용", commenterId: 99 });
    expect(prisma.reportComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ commenterId: 2n }),
      }),
    );
  });

  it("TC-CMT-02: 작성자 본인의 대댓글은 201 이고 부모에 연결된다", async () => {
    vi.mocked(prisma.reportComment.create).mockResolvedValue({
      ...REPLY,
      commentId: 403n,
    } as never);
    const response = await post(
      { content: "확인했습니다", parentCommentId: 400 },
      asSalesRep,
    );
    const body = await readBody(response);

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ parentCommentId: 400 });
    expect(prisma.reportComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commenterId: 1n,
          parentCommentId: 400n,
        }),
      }),
    );
  });

  it("상급자의 대댓글도 201 이다", async () => {
    const response = await post({ content: "답글", parentCommentId: 400 });
    expect(response.status).toBe(201);
  });

  it("대댓글 작성 전에 보고 행과 부모 행을 잠근다 (동시 삭제와 직렬화)", async () => {
    await post({ content: "답글", parentCommentId: 400 });
    // 보고 행(회수와 직렬화) + 부모 댓글 행(삭제와 직렬화)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("TC-WDR-06: 인가 뒤 보고 행을 잠그고, 잠금 뒤에 다시 읽는다 (보고 회수와 직렬화)", async () => {
    await post({ content: "루트" });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const lock = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0];
    const reads = vi.mocked(prisma.dailyReport.findUnique).mock
      .invocationCallOrder;
    expect(reads).toHaveLength(2);
    expect(reads[0]).toBeLessThan(lock);
    expect(lock).toBeLessThan(reads[1]);
  });

  it("TC-WDR-06: 잠금 뒤 읽기가 DRAFT 면(그 사이 회수) 409 REPORT_NOT_SUBMITTED", async () => {
    vi.mocked(prisma.dailyReport.findUnique)
      .mockReset()
      .mockResolvedValueOnce(SUBMITTED_REPORT_ROW as never)
      .mockResolvedValueOnce({
        ...SUBMITTED_REPORT_ROW,
        status: "DRAFT",
      } as never);
    const response = await post({ content: "루트" });

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("REPORT_NOT_SUBMITTED");
    expect(prisma.reportComment.create).not.toHaveBeenCalled();
  });

  it("TC-SEC-04: 권한 없는 호출자는 보고 행을 잠그지 않는다", async () => {
    expect((await post({ content: "내용" }, asOtherRep)).status).toBe(403);
    expect((await post({ content: "내용" }, asSalesRep)).status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("작성자 본인의 루트 댓글은 403 이다 (대댓글만 허용)", async () => {
    const response = await post({ content: "내용" }, asSalesRep);

    expect(response.status).toBe(403);
    expect(prisma.reportComment.create).not.toHaveBeenCalled();
  });

  it("TC-SEC-04: 무관한 사원·타 팀 상급자는 403", async () => {
    expect((await post({ content: "내용" }, asOtherRep)).status).toBe(403);
    expect((await post({ content: "내용" }, asOtherManager)).status).toBe(403);
    expect(prisma.reportComment.create).not.toHaveBeenCalled();
  });

  it("작성중 보고에 쓰면 409 REPORT_NOT_SUBMITTED", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      DRAFT_REPORT_ROW as never,
    );
    const response = await post({ content: "내용" });

    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe("REPORT_NOT_SUBMITTED");
  });

  it("작성중 보고라도 권한 없는 호출자는 409 가 아니라 403 이다", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      DRAFT_REPORT_ROW as never,
    );
    expect((await post({ content: "내용" }, asOtherRep)).status).toBe(403);
    expect((await post({ content: "내용" }, asOtherManager)).status).toBe(403);
    expect((await post({ content: "내용" }, asSalesRep)).status).toBe(403);
  });

  it("다른 보고의 parentCommentId 는 400 PARENT_NOT_IN_REPORT (IDOR)", async () => {
    vi.mocked(prisma.reportComment.findUnique).mockResolvedValue({
      reportId: 77n,
      parentCommentId: null,
      deletedAt: null,
    } as never);
    const response = await post({ content: "내용", parentCommentId: 400 });

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("PARENT_NOT_IN_REPORT");
    expect(prisma.reportComment.create).not.toHaveBeenCalled();
  });

  it("없는 parentCommentId 도 같은 응답이다", async () => {
    vi.mocked(prisma.reportComment.findUnique).mockResolvedValue(null);
    const response = await post({ content: "내용", parentCommentId: 400 });
    const body = await readBody(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("PARENT_NOT_IN_REPORT");
  });

  it("다른 보고의 대댓글을 부모로 줘도 PARENT_IS_REPLY 가 아니라 소속 오류다", async () => {
    vi.mocked(prisma.reportComment.findUnique).mockResolvedValue({
      reportId: 77n,
      parentCommentId: 5n,
      deletedAt: null,
    } as never);
    const response = await post({ content: "내용", parentCommentId: 401 });

    expect((await readBody(response)).error?.code).toBe("PARENT_NOT_IN_REPORT");
  });

  it("삭제된 댓글에 대댓글을 달면 400 PARENT_DELETED (이슈 #71)", async () => {
    vi.mocked(prisma.reportComment.findUnique).mockResolvedValue({
      reportId: 10n,
      parentCommentId: null,
      deletedAt: new Date(),
    } as never);
    const response = await post({ content: "내용", parentCommentId: 400 });

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("PARENT_DELETED");
    expect(prisma.reportComment.create).not.toHaveBeenCalled();
  });

  it("다른 보고의 삭제된 댓글은 PARENT_DELETED 가 아니라 소속 오류다 (IDOR)", async () => {
    vi.mocked(prisma.reportComment.findUnique).mockResolvedValue({
      reportId: 77n,
      parentCommentId: null,
      deletedAt: new Date(),
    } as never);
    const response = await post({ content: "내용", parentCommentId: 400 });

    expect((await readBody(response)).error?.code).toBe("PARENT_NOT_IN_REPORT");
  });

  it("대댓글을 부모로 지정하면 400 PARENT_IS_REPLY", async () => {
    vi.mocked(prisma.reportComment.findUnique).mockResolvedValue({
      reportId: 10n,
      parentCommentId: 400n,
      deletedAt: null,
    } as never);
    const response = await post({ content: "내용", parentCommentId: 401 });

    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe("PARENT_IS_REPLY");
    expect(prisma.reportComment.create).not.toHaveBeenCalled();
  });

  it.each([
    ["content 누락", {}],
    ["공백만", { content: "   " }],
    ["2001자", { content: "가".repeat(2001) }],
    ["content 가 숫자", { content: 1 }],
    ["parentCommentId 가 문자열", { content: "내용", parentCommentId: "a" }],
    [
      "parentCommentId 안전 정수 초과",
      { content: "내용", parentCommentId: 9007199254740993 },
    ],
    ["parentCommentId 0", { content: "내용", parentCommentId: 0 }],
  ])("잘못된 입력(%s)은 400", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("JSON 이 아닌 본문은 400", async () => {
    const request = asManager(URL, { method: "POST" });
    expect((await POST(request, reportParams("10"))).status).toBe(400);
  });

  it("2000자는 허용한다", async () => {
    expect((await post({ content: "가".repeat(2000) })).status).toBe(201);
  });

  it("없는 보고는 404", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);
    expect((await post({ content: "내용" })).status).toBe(404);
  });

  it.each(["abc", "9007199254740993", "0"])(
    "잘못된 보고 식별자 %s 는 400",
    async (id) => {
      expect((await post({ content: "내용" }, asManager, id)).status).toBe(400);
    },
  );

  it("ADMIN 은 403, 인증 없음은 401", async () => {
    expect((await post({ content: "내용" }, asAdmin)).status).toBe(403);
    expect((await post({ content: "내용" }, withoutAuth)).status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
