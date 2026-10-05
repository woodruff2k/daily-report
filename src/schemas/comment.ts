import { z } from "zod";
import { idSchema } from "./identifier";
import { multiLineText } from "./text";

/**
 * 댓글 입력 검증. (FR-09, API 명세 4.2·4.3)
 *
 * 부모 댓글이 같은 보고의 루트 댓글인지는 DB 를 봐야 알 수 있어 여기서
 * 검증하지 않는다. `src/lib/comment.ts` 가 트랜잭션 안에서 검증한다.
 */

/**
 * 공백뿐인 내용은 거부한다. 상한 2000자는 보고 행의 내용(`report.ts`)과 같다.
 * 저장하는 값은 앞뒤 공백을 뗀 값이다.
 */
const content = multiLineText().min(1).max(2000);

/** 댓글 작성. `parentCommentId` 생략·null 은 루트 댓글이다. */
export const commentCreateSchema = z.object({
  content,
  parentCommentId: idSchema.nullish().transform((value) => value ?? null),
});

/**
 * 댓글 수정. 내용만 바꾼다.
 *
 * `parentCommentId` 는 받지 않는다. 스레드 위치를 옮기면 대댓글 규칙(1단계,
 * 같은 보고)을 우회할 수 있다. 본문에 섞여 와도 무시된다.
 */
export const commentUpdateSchema = z.object({ content });

export type CommentCreate = z.infer<typeof commentCreateSchema>;
export type CommentUpdate = z.infer<typeof commentUpdateSchema>;
