import { describe, expectTypeOf, it } from "vitest";
import type { ReportStatus as DbReportStatus } from "@prisma/client";
import type { Role as DbRole, RepStatus as DbRepStatus } from "@prisma/client";
import type {
  ProblemStatus as DbProblemStatus,
  VisitType as DbVisitType,
} from "@prisma/client";
import type { z } from "zod";
import type { CommentResponse, CommentThreadResponse } from "@/lib/comment";
import type { CustomerListItem as ServerCustomerListItem } from "@/lib/customer";
import type { CustomerResponse } from "@/lib/customer";
import type { PageResponse as ServerPageResponse } from "@/lib/pagination";
import type {
  ReportDetailResponse,
  ReportListItem as ServerReportListItem,
  TeamReportListItem as ServerTeamReportListItem,
} from "@/lib/report";
import type {
  SalesRepListItem as ServerSalesRepListItem,
  SalesRepOption as ServerSalesRepOption,
  CreatedSalesRepResponse,
  ResetPasswordResponse,
  SalesRepResponse,
  SalesRepTeamOption,
} from "@/lib/sales-rep";
import type { reportSaveSchema } from "@/schemas/report";
import type {
  salesRepCreateSchema,
  salesRepUpdateSchema,
} from "@/schemas/sales-rep";
import type { CommentItem, CommentThread } from "./comment-api";
import type {
  CustomerDetail,
  CustomerListItem,
  CustomerStatus,
  SalesRepOption,
} from "./customer-api";
import type {
  ProblemStatus,
  ReportDetail,
  ReportListItem,
  ReportSaveBody,
  ReportStatus,
  TeamReportListItem,
  VisitType,
} from "./report-api";
import type {
  PageResponse,
  RepStatus,
  Role,
  CreatedSalesRep,
  SalesRepDetail,
  SalesRepFormValues,
  SalesRepListItem,
  TeamOption,
  toRequestBody,
} from "./sales-rep-api";

/**
 * 서버 응답 타입 ↔ 화면 응답 타입 계약 테스트. (이슈 #96)
 *
 * 덮는 TC: 없다. 명세서의 TC 는 런타임 동작을 보는 것이고, 이 파일은 **런타임
 * 효과가 없다.** 화면이 서버 타입을 import 하지 않아 한쪽만 바뀌어도 컴파일러가
 * 모르는 문제(#87: 서버가 `problems[].customerId` 를 `customer` 로 바꿨는데
 * tsc·테스트 통과, 런타임에서 `GET /api/customers/undefined`)를 **`tsc` 로
 * 당기는 것이 목적**이다.
 *
 * 게이트는 `npm run typecheck`(CI typecheck 단계)다. `expectTypeOf` 불일치는
 * TS2344 로 잡히고 `vitest run` 은 통과한다. 서버 타입은 반드시 `import type`
 * 으로만 가져온다(Prisma 런타임이 딸려오지 않게).
 */
describe("서버·화면 응답 타입 계약", () => {
  it("보고 목록 항목: 화면 목록 컬럼(reportDate·visitCount·commentCount·updatedAt)이 읽는 모양", () => {
    expectTypeOf<ServerReportListItem>().toEqualTypeOf<ReportListItem>();
  });

  it("팀 보고 목록 항목: 팀 화면이 rep.name 을 작성자 컬럼으로 읽는다", () => {
    expectTypeOf<ServerTeamReportListItem>().toEqualTypeOf<TeamReportListItem>();
  });

  it("보고 상세: 상세·작성 화면이 visits/problems/plans 의 customer 객체를 읽는다(#87)", () => {
    expectTypeOf<ReportDetailResponse>().toEqualTypeOf<ReportDetail>();
  });

  it("댓글: 삭제 여부로 좁혀 content·commenter 를 읽는 분기가 깨진다", () => {
    expectTypeOf<CommentResponse>().toEqualTypeOf<CommentItem>();
  });

  it("댓글 스레드: replies 를 부모 아래에 그리는 화면이 깨진다", () => {
    expectTypeOf<CommentThreadResponse>().toEqualTypeOf<CommentThread>();
  });

  it("고객 목록 항목: editable 로 수정 버튼을 그리고 email·address 는 없어야 한다(NFR-04)", () => {
    expectTypeOf<ServerCustomerListItem>().toEqualTypeOf<CustomerListItem>();
  });

  it("고객 상세: 수정 화면이 email·address 를 폼 초기값으로 읽는다", () => {
    expectTypeOf<CustomerResponse>().toEqualTypeOf<CustomerDetail>();
  });

  it("영업 목록 항목: 목록 화면이 managerName 컬럼을 읽는다", () => {
    expectTypeOf<ServerSalesRepListItem>().toEqualTypeOf<SalesRepListItem>();
  });

  it("영업 상세: 화면 타입이 managerName 을 주장하면 읽었을 때 undefined 가 된다(#96)", () => {
    expectTypeOf<SalesRepResponse>().toEqualTypeOf<SalesRepDetail>();
  });

  /**
   * 임시 비밀번호를 담는 두 응답. **틀리면 가장 비싸다.**
   *
   * 평문 비밀번호는 저장하지 않으므로 이 응답이 **유일한 전달 경로**다(NFR-04).
   * 필드 이름이 바뀌면 등록 화면은 `undefined` 를 받아 "관리자가 비밀번호를
   * 지정한 경우" 로 읽고 **조용히 목록으로 이동한다** — 사본이 사라진다. 재발급
   * 화면은 "임시 비밀번호: undefined" 를 사용자에게 보여준다.
   *
   * 라우트가 객체 리터럴로 만들던 것을 서버에 이름 있는 타입으로 선언해 묶었다.
   * (#96 검토)
   */
  it("영업 등록 응답: 화면이 temporaryPassword 로 임시 비밀번호를 받는다", () => {
    expectTypeOf<CreatedSalesRepResponse>().toEqualTypeOf<CreatedSalesRep>();
  });

  it("비밀번호 재발급 응답: 화면이 temporaryPassword 를 그대로 띄운다", () => {
    expectTypeOf<ResetPasswordResponse>().toEqualTypeOf<
      Awaited<
        ReturnType<typeof import("./sales-rep-api").resetSalesRepPassword>
      >
    >();
  });

  it("담당 영업 Select 옵션: 고객 폼이 repId·name 만 읽는다", () => {
    expectTypeOf<ServerSalesRepOption>().toEqualTypeOf<SalesRepOption>();
  });

  it("팀원 Select 옵션: 팀 보고 필터가 status 로 (비활성) 표시를 붙인다", () => {
    expectTypeOf<SalesRepTeamOption>().toEqualTypeOf<TeamOption>();
  });

  it("페이지 응답: 모든 목록 화면이 totalPages 등으로 페이지 이동을 그린다", () => {
    expectTypeOf<ServerPageResponse<number>>().toEqualTypeOf<
      PageResponse<number>
    >();
  });
});

/**
 * 리터럴 유니온: Prisma 열거형 ↔ 화면 타입. 서버에 값이 늘면 화면의 Select·
 * 배지·`Record<Status, ...>` 매핑이 그 값을 모른 채 렌더링한다.
 * (Zod enum 은 리터럴을 따로 적은 것이라 아래 요청 타입 비교가 함께 잡는다.)
 */
describe("서버·화면 리터럴 유니온 계약", () => {
  it("ReportStatus·VisitType·ProblemStatus", () => {
    expectTypeOf<DbReportStatus>().toEqualTypeOf<ReportStatus>();
    expectTypeOf<DbVisitType>().toEqualTypeOf<VisitType>();
    expectTypeOf<DbProblemStatus>().toEqualTypeOf<ProblemStatus>();
  });

  it("Role·RepStatus·CustomerStatus", () => {
    expectTypeOf<DbRole>().toEqualTypeOf<Role>();
    expectTypeOf<DbRepStatus>().toEqualTypeOf<RepStatus>();
    // 고객 상태는 Prisma 에 별도 열거형이 없고 RepStatus 를 쓴다.
    expectTypeOf<DbRepStatus>().toEqualTypeOf<CustomerStatus>();
  });
});

/**
 * 요청 타입: 화면이 보내는 본문이 서버 Zod 스키마의 **입력** 타입(`z.input`)에
 * 들어가는지(방향: 화면 → 서버)만 본다. 동일성(`toEqualTypeOf`)은 쓰지 않는다.
 *
 * - 서버는 `.default()`·`.transform()`·`preprocess` 로 입력을 느슨하게 받는다.
 *   `z.output` 은 기본값이 채워진 서버 내부 모양이라 요청 본문이 아니다.
 * - `preprocess` 를 거친 필드(visitTime·result·plannedDate 등)의 입력 타입은
 *   `unknown` 이라 그 필드의 모양은 이 단언이 보장하지 못한다.
 * - **`toExtend` 는 할당 가능성이고 초과 속성 검사를 하지 않는다.** 서버가 필드
 *   이름을 바꾸면서 새 필드를 `.optional()`·`.default()` 로 두면, 화면이 옛 이름을
 *   계속 보내도 이 단언은 통과한다 — 저장은 되지만 그 값이 조용히 빠진다(#87 과
 *   같은 종류가 요청 방향에서 일어난다). 이 구멍은 타입으로 막을 수 없고, 저장
 *   후 값을 다시 읽어 확인하는 통합 테스트가 막는다.
 * - `SalesRepFormValues` 는 폼 상태(문자열)이고 요청 본문이 아니다. 본문은
 *   `toRequestBody` 가 변환하며 비공개라 비교하지 않는다. 대신 폼이 가진
 *   `role`·`status` 가 서버가 받는 값인지만 본다.
 */
describe("화면 요청 타입 → 서버 스키마 입력 계약", () => {
  it("ReportSaveBody 는 reportSaveSchema 입력에 들어간다", () => {
    expectTypeOf<ReportSaveBody>().toExtend<z.input<typeof reportSaveSchema>>();
  });

  /**
   * **폼이 실제로 보내는 본문**을 두 스키마에 묶는다. `SalesRepFormValues` 는 폼
   * 상태(전부 문자열)라 본문이 아니다 — 변환은 `toRequestBody` 가 한다.
   *
   * 등록(6.2)과 수정(6.3)이 **다른 스키마**를 쓴다. `salesRepUpdateSchema` 는
   * `role`·`status` 를 필수로 요구하고 기본값이 없다. 등록만 묶어 두면 수정
   * 스키마가 필드를 필수로 바꿰도 신호가 없고, SCR-510 의 모든 수정 제출이 400 이
   * 되는데 typecheck 는 녹색이다. (#96 검토)
   */
  it("폼이 보내는 본문은 등록 스키마 입력에 들어간다", () => {
    expectTypeOf<ReturnType<typeof toRequestBody>>().toExtend<
      z.input<typeof salesRepCreateSchema>
    >();
  });

  it("폼이 보내는 본문은 수정 스키마 입력에도 들어간다", () => {
    expectTypeOf<ReturnType<typeof toRequestBody>>().toExtend<
      z.input<typeof salesRepUpdateSchema>
    >();
  });

  it("SalesRepFormValues 의 role·status 는 서버 스키마가 받는 값이다", () => {
    type ServerInput = z.input<typeof salesRepCreateSchema>;
    expectTypeOf<SalesRepFormValues["role"]>().toExtend<
      NonNullable<ServerInput["role"]>
    >();
    expectTypeOf<SalesRepFormValues["status"]>().toExtend<
      NonNullable<ServerInput["status"]>
    >();
  });
});
