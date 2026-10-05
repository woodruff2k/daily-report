import type { CommentTreeRecord } from "@/lib/comment";

/**
 * 합성 데이터. 실제 직원 정보를 쓰지 않는다. (테스트 명세 1.4)
 *
 * 요청 헬퍼(`asSalesRep` 등)와 인물 관계는 `report-fixtures.ts` 와 같다. 1번이
 * 보고 10 의 작성자, 2번이 그 직속 상급자, 3번·4번은 무관한 사원·상급자다.
 */
export {
  SUBMITTED_REPORT,
  REPORT,
  asAdmin,
  asManager,
  asOtherManager,
  asOtherRep,
  asSalesRep,
  readBody,
  withoutAuth,
} from "./report-fixtures";

/** 보고 소유·열람 판정용 조회 결과. `findReportForComment` 의 모양이다. */
export const SUBMITTED_REPORT_ROW = {
  repId: 1n,
  status: "SUBMITTED" as const,
  rep: { managerId: 2n },
};

export const DRAFT_REPORT_ROW = {
  ...SUBMITTED_REPORT_ROW,
  status: "DRAFT" as const,
};

const MANAGER = { repId: 2n, name: "테스트상급자" };
const AUTHOR = { repId: 1n, name: "테스트사원" };

/** 상급자의 루트 댓글(400)과 작성자의 대댓글(401). */
export const REPLY: CommentTreeRecord["replies"][number] = {
  commentId: 401n,
  parentCommentId: 400n,
  content: "확인했습니다",
  createdAt: new Date("2026-06-20T10:10:00.000Z"),
  commenter: AUTHOR,
};

export const ROOT_COMMENT: CommentTreeRecord = {
  commentId: 400n,
  parentCommentId: null,
  content: "견적 일정 확인 바람",
  createdAt: new Date("2026-06-20T10:00:00.000Z"),
  commenter: MANAGER,
  replies: [REPLY],
};

export const ROOT_WITHOUT_REPLIES: CommentTreeRecord = {
  ...ROOT_COMMENT,
  replies: [],
};

export function reportParams(reportId: string) {
  return { params: Promise.resolve({ reportId }) };
}

export function commentParams(reportId: string, commentId: string) {
  return { params: Promise.resolve({ reportId, commentId }) };
}
