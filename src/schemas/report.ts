import { z } from "zod";
import { idSchema } from "./identifier";
import { multiLineText } from "./text";

/**
 * 일일보고 입력 검증. (FR-03·04·06·07, API 명세 3.2·3.4)
 *
 * 고객 존재 여부와 `visitId` 등이 그 보고의 소유인지는 DB 를 봐야 알 수 있어
 * 여기서 검증하지 않는다. `src/lib/report.ts` 가 트랜잭션 안에서 검증한다.
 */

/**
 * `YYYY-MM-DD`. 형식뿐 아니라 실제 존재하는 날짜인지도 본다.
 * `2026-02-30` 은 `Date` 가 3월 2일로 굴려 버리므로 되돌려 비교해 걸러낸다.
 */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  });

/** 공백뿐인 문자열을 null 로 정규화한다. (고객 스키마와 같은 규칙) */
function blankToNull(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalText(max: number) {
  return z
    .preprocess(blankToNull, multiLineText().max(max).nullish())
    .transform((value) => value ?? null);
}

/** 수정이면 식별자, 신규면 생략·null. 라우트에서는 `undefined` 로 통일한다. */
const optionalRowId = idSchema
  .nullish()
  .transform((value) => value ?? undefined);

/** 선택 식별자. 생략·null 모두 "없음"이다. */
const optionalCustomerId = idSchema
  .nullish()
  .transform((value) => value ?? null);

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalTime = z
  .preprocess(blankToNull, z.string().regex(TIME_PATTERN).nullish())
  .transform((value) => value ?? null);

const optionalDate = z
  .preprocess(blankToNull, dateOnlySchema.nullish())
  .transform((value) => value ?? null);

const content = multiLineText().min(1).max(2000);

/** 한 보고에 담을 수 있는 행 수의 상한. 과대 요청이 트랜잭션을 붙잡지 않게 한다. */
const MAX_ROWS = 100;

export const visitInputSchema = z.object({
  visitId: optionalRowId,
  customerId: idSchema,
  visitTime: optionalTime,
  visitType: z.enum(["VISIT", "CALL", "ONLINE"]),
  content,
  result: optionalText(255),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const problemInputSchema = z.object({
  problemId: optionalRowId,
  customerId: optionalCustomerId,
  content,
  // 화면정의서 SCR-210: 상태는 선택이며 기본 OPEN.
  status: z.enum(["OPEN", "CLOSED"]).default("OPEN"),
});

export const planInputSchema = z.object({
  planId: optionalRowId,
  customerId: optionalCustomerId,
  plannedDate: optionalDate,
  content,
});

/** 같은 식별자를 두 번 보내면 한 행이 두 번 갱신된다. 모호한 요청이므로 거부한다. */
function hasUniqueIds<T>(rows: T[], pick: (row: T) => number | undefined) {
  const ids = rows.map(pick).filter((id): id is number => id !== undefined);
  return new Set(ids).size === ids.length;
}

/** 일일보고 생성. (API 명세 3.2) */
export const reportCreateSchema = z.object({
  reportDate: dateOnlySchema,
});

/**
 * 일일보고 저장. (API 명세 3.4) 전체 교체다.
 *
 * 세 배열을 모두 필수로 둔다. 생략을 "변경 없음"으로 읽으면 전체 교체 규칙과
 * 어긋나고, "빈 배열"로 읽으면 배열 하나를 빠뜨린 요청이 그 섹션 전체를 조용히
 * 지운다. 비우려면 `[]` 를 명시해야 한다.
 *
 * `visits` 는 0건도 받는다. 빈 보고를 임시저장할 수 없으면 작성 흐름(SCR-210)이
 * 막히기 때문이다. 최소 1건은 제출 시점에 검증한다. (5.2, TC-SUB-02)
 */
export const reportSaveSchema = z.object({
  visits: z
    .array(visitInputSchema)
    .max(MAX_ROWS)
    .refine((rows) => hasUniqueIds(rows, (row) => row.visitId)),
  problems: z
    .array(problemInputSchema)
    .max(MAX_ROWS)
    .refine((rows) => hasUniqueIds(rows, (row) => row.problemId)),
  plans: z
    .array(planInputSchema)
    .max(MAX_ROWS)
    .refine((rows) => hasUniqueIds(rows, (row) => row.planId)),
});

export type ReportCreate = z.infer<typeof reportCreateSchema>;
export type ReportSave = z.infer<typeof reportSaveSchema>;
