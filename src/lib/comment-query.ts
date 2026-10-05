import { parseIdParam } from "./customer-query";

/** 경로 파라미터의 commentId 를 BigInt 로 바꾼다. */
export function parseCommentIdParam(raw: string): bigint {
  return parseIdParam(raw, "commentId");
}
