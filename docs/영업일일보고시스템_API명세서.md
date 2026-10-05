# 영업 일일 보고 시스템 — API 명세서

| 항목 | 내용 |
| :---- | :---- |
| 문서명 | 영업 일일 보고 시스템 API 명세서 |
| 버전 | v1.0 |
| 작성일 | 2026-06-20 |
| 관련 문서 | 요구사항 정의서, ER 다이어그램, 화면 정의서 |

---

## 1\. 공통 사항

### 1.1 기본 정보

| 항목 | 내용 |
| :---- | :---- |
| Base URL | `https://{host}/api` |
| 데이터 포맷 | `application/json; charset=utf-8` |
| 인증 | `Authorization: Bearer {accessToken}` (로그인 제외 전 API) |
| 토큰 수명 | 8시간. 서버가 무효화할 수 있다 — 아래 1.5 참고 |
| 시간 표기 | ISO 8601 (`2026-06-20T18:10:00+09:00`) |

### 1.2 공통 응답 구조

```json
{
  "success": true,
  "data": { },
  "error": null
}
```

오류 시:

```json
{
  "success": false,
  "data": null,
  "error": { "code": "INVALID_REQUEST", "message": "필수 항목 누락" }
}
```

**식별자 표기** — `repId`, `customerId`, `reportId`, `visitId`, `commentId` 등 모든 식별자는 **JSON 숫자**로 주고받는다. DB 는 BigInt 로 다루지만 `JSON.stringify`가 BigInt 를 직렬화하지 못하므로 경계에서 변환한다. 변환은 `src/lib/identifier.ts`의 `toJsonId` 한 곳에서 한다.

요청으로 들어오는 식별자는 **안전 정수(2^53-1) 범위를 넘으면 400**이다. 범위를 넘는 값은 변환 과정에서 정밀도를 잃고, 식별자에서 그것은 다른 레코드를 가리키는 값이 된다.

예외는 JWT 클레임이다. 토큰의 `repId`는 문자열로 담는다. 외부 응답이 아니고 프록시가 BigInt 로 되돌린다.

### 1.3 페이지네이션 (목록 공통)

- 요청 파라미터: `page`(0부터), `size`(기본 20), `sort`(예: `reportDate,desc`)  
- 응답 `data`: `{ "content": [], "page": 0, "size": 20, "totalElements": 0, "totalPages": 0 }`

### 1.4 공통 HTTP 상태 코드

| 코드 | 의미 |
| :---- | :---- |
| 200 | 조회/수정 성공 |
| 201 | 생성 성공 |
| 204 | 삭제 성공(본문 없음) |
| 400 | 잘못된 요청(유효성 실패) |
| 401 | 인증 필요/실패 |
| 403 | 권한 없음 (임시 비밀번호 미변경 시 `PASSWORD_CHANGE_REQUIRED` 포함) |
| 404 | 리소스 없음 |
| 409 | 충돌(중복 보고 등) |
| 500 | 처리하지 못한 서버 오류 (`INTERNAL_ERROR`) |

**`INTERNAL_ERROR` 는 분류되지 않은 오류의 봉투다.** 서버가 예상하지 못한 오류를 만나면 그것을 권한 오류나 유효성 오류 같은 **특정 코드로 바꾸지 않는다.** 대신 공통 구조(1.2)를 유지한 채 이 코드로 응답한다.

```json
{ "success": false, "data": null,
  "error": { "code": "INTERNAL_ERROR", "message": "서버 오류가 발생했습니다." } }
```

- **운영(`NODE_ENV=production`)에서는 원인을 응답에 담지 않는다.** 스택트레이스도, 오류 메시지도 싣지 않는다
- 개발에서는 `error.detail` 에 마스킹한 메시지를 담는다. 스택은 담지 않는다
- 서버 로그에는 남긴다. 그 로그에서 `password`·`phone`·`email`·토큰 같은 값은 가린다(NFR-04, TC-SEC-07)

### 1.5 권한 정책

- 모든 권한은 **서버 측에서 검증**한다. 영업사원은 본인 보고만, 상급자는 소속 팀원 보고 조회·댓글, 관리자는 영업 마스터 관리.
- **임시 비밀번호 상태에서는 비밀번호 변경과 로그아웃만 허용한다.** 토큰에 `mustChangePassword`가 담기고, 프록시가 그 외 모든 `/api/*` 요청을 403 `PASSWORD_CHANGE_REQUIRED`로 막는다. 화면이 변경 폼으로 보내주기를 기대하지 않는다.
- **발급된 토큰은 서버가 무효화할 수 있다.** 토큰에 `tokenVersion`이 담기고, 프록시가 요청마다 DB의 값과 비교해 다르면 401이다. 다음 조작이 그 값을 올려 **해당 계정의 기존 토큰을 즉시 끊는다.**
  - 비밀번호 변경(2.3) — 다른 기기 세션까지 끊긴다
  - 임시 비밀번호 재발급(6.5) — 탈취된 세션을 끊는 것이 재발급의 목적이다
  - 계정 비활성화(6.3·6.4) — 토큰 만료를 기다리지 않는다
  - 역할 변경(6.3) — 토큰에 역할이 담겨 있어 강등이 즉시 반영되어야 한다
  - 로그아웃(2.2)
  비활성화된 계정의 토큰도 같은 검사에서 막힌다. 무효화 사유는 응답에서 구분하지 않는다(모두 `UNAUTHORIZED`) — 구분하면 계정 상태가 드러난다.
- **고객 마스터는 조회는 전사, 쓰기는 담당자 범위다.** 상세는 5장 권한 절을 따른다. 고객을 수정·비활성화할 수 있는 사람은 담당 영업 본인과 그 사원의 직속 상급자뿐이다.
- **역할 간 상하 관계는 두지 않는다.** 관리자(ADMIN)가 영업사원의 보고를 조회할 수 없고, 상급자(MANAGER)가 영업 마스터를 관리할 수 없다. 각 역할은 요구사항 5.1의 담당 범위만 가진다.

---

## 2\. 인증 API

### 2.1 로그인

`POST /api/auth/login`

요청

```json
{ "loginId": "hong@company.com", "password": "********" }
```

응답 200

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhb...",
    "rep": { "repId": 1, "name": "홍길동", "role": "SALES_REP" },
    "mustChangePassword": false
  }
}
```

`mustChangePassword`가 `true`면 임시 비밀번호 상태다. 로그인 자체는 성공하고 토큰도 발급되지만(토큰이 없으면 비밀번호를 바꿀 수도 없다), 비밀번호를 바꾸기 전까지 다른 API는 403이다. 화면은 곧바로 비밀번호 변경으로 보낸다.

### 2.2 로그아웃

`POST /api/auth/logout` — 응답 204

- **인증이 필요하다.** 누구의 토큰을 거둘지 알아야 한다. 토큰이 없거나 이미 무효화된 토큰이면 401이다.
- 토큰 버전을 올려 **그 계정의 모든 기기 세션을 끊는다.** 기기별 종료는 지원하지 않는다(세션 식별자가 필요하다).

### 2.3 비밀번호 변경 (본인)

`PUT /api/me/password`

요청

```json
{ "currentPassword": "********", "newPassword": "********" }
```

| 항목 | 규칙 |
| :---- | :---- |
| currentPassword | 필수. 틀리면 401 |
| newPassword | 필수, 12자 이상 72자 이하. 기존과 같으면 400 |

응답 200

```json
{ "success": true, "data": { "accessToken": "eyJhb..." } }
```

- 임시 비밀번호 상태를 푸는 유일한 경로다.
- **현재 비밀번호를 함께 받는다.** 토큰만으로 변경을 허용하면 탈취한 토큰으로 계정을 가져갈 수 있다.
- 성공 시 **새 토큰**을 돌려준다. 기존 토큰에는 `mustChangePassword`가 `true`로 박혀 있어 그대로 쓰면 계속 막힌다.

---

## 3\. 일일보고 API

### 3.1 일일보고 목록 (본인)

`GET /api/reports`

| 파라미터 | 타입 | 필수 | 설명 |
| :---- | :---- | :---: | :---- |
| fromDate | date | N | 보고일자 시작 |
| toDate | date | N | 보고일자 종료 |
| status | enum | N | DRAFT / SUBMITTED |

응답 200

```json
{
  "success": true,
  "data": {
    "content": [
      { "reportId": 10, "reportDate": "2026-06-20", "visitCount": 3,
        "status": "SUBMITTED", "commentCount": 2, "updatedAt": "2026-06-20T18:10:00+09:00" }
    ],
    "page": 0, "size": 20, "totalElements": 1, "totalPages": 1
  }
}
```

### 3.2 일일보고 생성 (오늘자)

`POST /api/reports`

요청

```json
{ "reportDate": "2026-06-20" }
```

- (`repId`, `reportDate`) 중복 시 **409** 반환 또는 기존 보고 반환 정책 적용.

응답 201

```json
{ "success": true, "data": { "reportId": 10, "status": "DRAFT" } }
```

### 3.3 일일보고 상세

`GET /api/reports/{reportId}`

응답 200

```json
{
  "success": true,
  "data": {
    "reportId": 10,
    "rep": { "repId": 1, "name": "홍길동" },
    "reportDate": "2026-06-20",
    "status": "SUBMITTED",
    "submittedAt": "2026-06-20T18:10:00+09:00",
    "visits": [
      { "visitId": 100, "customer": { "customerId": 5, "customerName": "(주)A상사" },
        "visitTime": "10:00", "visitType": "VISIT", "content": "신제품 소개",
        "result": "견적요청", "sortOrder": 1 }
    ],
    "problems": [
      { "problemId": 200, "customerId": 5, "content": "납기 단축 요청", "status": "OPEN", "sortOrder": 1 }
    ],
    "plans": [
      { "planId": 300, "customerId": 5, "plannedDate": "2026-06-21", "content": "견적서 발송", "sortOrder": 1 }
    ]
  }
}
```

### 3.4 일일보고 저장 (방문/과제/계획 일괄)

`PUT /api/reports/{reportId}`

- 화면(SCR-210)의 임시저장에 대응. 본문의 배열로 방문/과제/계획을 **일괄 반영**한다.  
- `id`가 있으면 수정, 없으면 신규, 응답에 없는 기존 항목은 삭제 처리(전체 교체 방식).  
- DRAFT 상태에서만 허용.

요청

```json
{
  "visits": [
    { "visitId": 100, "customerId": 5, "visitTime": "10:00", "visitType": "VISIT",
      "content": "신제품 소개", "result": "견적요청", "sortOrder": 1 },
    { "customerId": 8, "visitTime": "14:00", "visitType": "CALL",
      "content": "재고 문의", "result": "보류", "sortOrder": 2 }
  ],
  "problems": [
    { "customerId": 5, "content": "납기 단축 요청", "status": "OPEN", "sortOrder": 1 }
  ],
  "plans": [
    { "customerId": 5, "plannedDate": "2026-06-21", "content": "견적서 발송", "sortOrder": 1 }
  ]
}
```

응답 200 — 갱신된 상세 반환

| 유효성 | 규칙 |
| :---- | :---- |
| visits | 최소 1건, 각 항목 customerId·visitType·content 필수 |
| visitType | VISIT / CALL / ONLINE |
| customerId | 활성 또는 참조 가능한 고객 |
| sortOrder | visits·problems·plans 의 각 항목에 선택. 0~9999 정수. 생략하면 요청 배열 순서(1부터)를 따른다. 응답은 `sortOrder` 오름차순, 같으면 식별자 오름차순으로 돌려준다 |

### 3.5 일일보고 제출

`POST /api/reports/{reportId}/submit`

- DRAFT → SUBMITTED 전환. 방문기록 1건 이상 등 유효성 통과 시 처리.

응답 200

```json
{ "success": true, "data": { "reportId": 10, "status": "SUBMITTED",
  "submittedAt": "2026-06-20T18:10:00+09:00" } }
```

### 3.6 팀 보고 조회 (상급자)

`GET /api/reports/team`

| 파라미터 | 타입 | 필수 | 설명 |
| :---- | :---- | :---: | :---- |
| repIds | array | N | 팀원 rep\_id 다중 |
| fromDate / toDate | date | N | 보고일자 범위 |
| customerId | bigint | N | 방문 고객 기준 |
| status | enum | N | DRAFT / SUBMITTED |

- 호출자의 소속 팀원 범위 밖 조회는 **403**.

---

## 4\. 댓글 API

### 4.1 댓글 목록

`GET /api/reports/{reportId}/comments`

응답 200

```json
{
  "success": true,
  "data": [
    { "commentId": 400, "deleted": false,
      "commenter": { "repId": 2, "name": "김부장" },
      "content": "견적 일정 확인 바람", "parentCommentId": null,
      "createdAt": "2026-06-20T19:00:00+09:00",
      "replies": [
        { "commentId": 401, "deleted": false,
          "commenter": { "repId": 1, "name": "홍길동" },
          "content": "확인했습니다", "parentCommentId": 400,
          "createdAt": "2026-06-20T19:10:00+09:00" }
      ] }
  ]
}
```

**삭제된 댓글(소프트 삭제).** 대댓글이 달린 채 삭제된 댓글은 목록에 그대로 나오되 `deleted` 가 `true` 이고 **`content` 와 `commenter` 키가 없다.** 대댓글은 그 부모 아래에 남는다. `content` 에 "삭제된 댓글입니다" 같은 문구를 담지 않는다 — 표시 문구는 화면이 정한다. 삭제된 댓글도 `commentCount` 에 센다.

```json
{ "commentId": 400, "deleted": true, "parentCommentId": null,
  "createdAt": "2026-06-20T19:00:00+09:00", "replies": [ ... ] }
```

### 4.2 댓글 작성

`POST /api/reports/{reportId}/comments`

- 상급자(또는 대댓글의 경우 본인) 권한 검증.

요청

```json
{ "content": "견적 일정 확인 바람", "parentCommentId": null }
```

응답 201 — 생성된 댓글 반환(`deleted: false`)

- 삭제된 댓글(소프트 삭제)에는 대댓글을 달 수 없다 — **400** `PARENT_DELETED`. 다른 보고의 댓글·없는 댓글은 기존대로 400 `PARENT_NOT_IN_REPORT` 이며 삭제 여부를 드러내지 않는다.

### 4.3 댓글 수정 / 삭제

- `PUT /api/reports/{reportId}/comments/{commentId}` (본인 작성 한정) → 200  
- `DELETE /api/reports/{reportId}/comments/{commentId}` (본인 작성 한정) → 204

삭제 동작은 대댓글 유무로 갈린다. 둘 다 응답은 204 다.

| 상황 | 처리 |
| :---- | :---- |
| 대댓글이 없는 댓글 | **물리 삭제.** 행이 없어진다 |
| 대댓글이 있는 댓글 | **소프트 삭제.** `deletedAt` 만 기록하고 행·스레드 구조는 남는다. 대댓글은 루트로 승격되지 않는다 |

- 삭제된 댓글의 **수정(PUT)·재삭제(DELETE)는 404** 다. 작성자 판정(403)보다 먼저 보므로 삭제된 댓글의 작성자는 드러나지 않는다.
- 모든 대댓글이 사라져도 소프트 삭제된 부모 행은 정리하지 않는다. 그러면 `replies` 가 빈 삭제된 댓글이 남는다 — 목록에 자리표시자만 있는 줄로 나오고, **지울 수 없으며**(PUT·DELETE 가 404) `commentCount` 에도 계속 포함된다. 무해하다고 보고 정리 작업을 두지 않았다.
- 상급자 댓글에 작성자가 대댓글을 달아도 상급자는 자기 댓글을 지울 수 있다. 이전의 409 `COMMENT_HAS_REPLIES` 는 **없어졌다.**
- 없는 댓글과 다른 보고의 댓글은 기존대로 같은 404 다.
- **루트 댓글이 삭제되면 그 스레드에 새 대댓글을 달 수 없다.** 작성자는 루트 댓글을 쓸 수 없고(FR-09, 4.2), 삭제된 루트에는 400 `PARENT_DELETED`, 자기 대댓글에는 400 `PARENT_IS_REPLY` 다. 스레드를 연 상급자가 피드백을 철회한 상황이므로 대화가 끝난 것으로 본다. **작성자의 기존 대댓글은 그대로 남고 수정·삭제도 된다.** 이전에는 루트를 지울 수 없어 이 상태가 생기지 않았다 — 상급자가 자기 댓글을 영구히 지울 수 없던 것과의 맞교환이다.
- **루트 댓글이 삭제되면 그 스레드에 새 대댓글을 달 수 없다.** 작성자는 루트 댓글을 쓸 수 없고(FR-09, 4.2), 삭제된 루트는 400 `PARENT_DELETED`, 대댓글은 400 `PARENT_IS_REPLY` 이기 때문이다.
  - **의도한 결과다.** 스레드를 연 상급자가 피드백을 철회한 상황이므로 대화가 끝난 것으로 본다. 작성자의 기존 대댓글은 그대로 남고 수정·삭제도 된다.
  - 이전에는 루트를 지울 수 없어(409) 이 상태가 생기지 않았다. 상급자가 실수로 쓴 피드백을 영구히 거둘 수 없는 것과 맞바꾼 제약이다.
  - 상급자는 새 루트 댓글을 달아 대화를 다시 열 수 있다.

---

## 5\. 고객 마스터 API

### 5.0 접근 범위 (권한)

고객 마스터는 SALES_REP·MANAGER 역할만 다룬다. ADMIN 은 모든 조작에서 403 이다. 역할 안에서의 범위는 조작마다 다르다.

| 조작 | 엔드포인트 | 범위 |
| :---- | :---- | :---- |
| 목록·상세 조회 | `GET /api/customers`, `GET /api/customers/{customerId}` | **전사.** 담당과 무관하게 조회한다. 상담 중 다른 담당 고객을 찾아봐야 하는 업무가 있어 열어 둔다. 목록에는 `email`·`address` 를 담지 않는다(NFR-04) |
| 등록 | `POST /api/customers` | **제한 없음.** `assignedRepId` 를 누구로 지정하든 허용한다. 새 데이터를 더하는 것이지 남의 데이터를 고치는 것이 아니다. 단 존재하는 활성 사원이어야 한다(400) |
| 수정·비활성화 | `PUT /api/customers/{customerId}`, `PATCH /api/customers/{customerId}/status` | **담당 영업 본인 + 그 사원의 직속 상급자(`managerId`).** 그 밖은 403 `FORBIDDEN` |

- 상급자 판정은 **직속만** 본다. 상급자의 상급자는 해당하지 않는다(보고 조회 범위와 같은 규칙).
- **담당 영업이 없는(null) 고객은 쓰기 범위 밖이다 — 403.** API 는 등록·수정에서 담당 영업을 필수로 받으므로 null 은 레거시·DB 직접 조작으로만 생긴다. 이 고객은 API 로 복구할 수 없고 DB 에서 담당자를 지정해야 한다.
- **담당 이관은 PUT 으로 한다.** 현재 담당자(또는 그 직속 상급자)가 `assignedRepId` 를 바꾸면 이후부터 받은 사람이 수정할 수 있고 보낸 사람은 못 한다. 남을 담당자로 지정해 등록한 사람도 그 뒤로는 그 고객을 수정할 수 없다.
- **판정 순서**: 인증 401 → 역할 403 → 식별자·본문 검증 400 → 고객 존재 404 → 쓰기 범위 403. 조회가 전사에 열려 있어 고객의 존재 여부는 비밀이 아니므로 404 를 403 보다 먼저 돌려준다. 403 메시지는 담당자·고객의 상태를 드러내지 않는다.


**범위를 벗어난 쓰기는 403 `CUSTOMER_WRITE_FORBIDDEN` 이다.** 범용 `FORBIDDEN`(역할이 맞지 않음, 예: ADMIN)과 코드로 구분된다 — 화면이 "역할이 안 맞아서" 와 "남의 고객이라서" 를 다른 문장으로 보여줘야 하고, 호출 지점으로 가르면 새 호출부가 생길 때 조용히 틀린 문구가 나간다.

### 5.1 고객 목록

`GET /api/customers`

| 파라미터 | 타입 | 필수 | 설명 |
| :---- | :---- | :---: | :---- |
| keyword | string | N | 고객명/회사명 검색 |
| assignedRepId | bigint | N | 담당 영업 |
| grade | string | N | 고객등급 |
| status | enum | N | ACTIVE / INACTIVE |

응답의 목록 항목은 화면(SCR-400)이 쓰는 것만 담는다 — `customerId`, `customerName`, `companyName`, `phone`, `grade`, `assignedRepId`, `assignedRepName`, `status`, `editable`. **이메일과 주소는 포함하지 않는다**(NFR-04). 필요하면 상세(5.3)를 쓴다.

- `assignedRepName` 은 담당 영업 이름이다. 목록 컬럼이 이름이라 식별자만 주면 화면이 다시 조회해야 한다.
- **`editable` 은 호출자가 그 고객을 수정·비활성화할 수 있는지다**(범위는 5.0). 화면이 버튼을 가리는 데 쓴다.
  - **이것은 접근통제가 아니다.** 실제 차단은 `PUT`(5.3)과 `PATCH`(5.4)가 한다. 화면이 이 값을 무시해도 쓰기는 막힌다.
  - 서버가 계산해 주는 이유는 **화면이 정확히 계산할 수 없기 때문**이다. 상급자 판정에는 담당 사원의 상급자 식별자가 필요한데, 그것을 목록에 담으면 조직 구조가 새어 나간다(NFR-04).

### 5.2 고객 등록

`POST /api/customers`

요청

```json
{
  "customerName": "이몽룡", "companyName": "(주)A상사",
  "phone": "02-000-0000", "email": "a@corp.com", "address": "서울...",
  "grade": "A", "assignedRepId": 1, "status": "ACTIVE"
}
```

응답 201 — 생성된 고객 반환

### 5.3 고객 상세 / 수정

- `GET /api/customers/{customerId}` → 200  
- `PUT /api/customers/{customerId}` → 200 (담당 영업 본인·직속 상급자만, 그 외 403 — 5.0)

### 5.4 고객 비활성화

`PATCH /api/customers/{customerId}/status`

- 물리 삭제 대신 상태 전환.
- 담당 영업 본인·직속 상급자만 가능하다. 그 외 403 (5.0)

```json
{ "status": "INACTIVE" }
```

응답 200

---

## 6\. 영업 마스터 API (관리자)

### 6.1 영업 목록

`GET /api/sales-reps`

| 파라미터 | 타입 | 필수 | 설명 |
| :---- | :---- | :---: | :---- |
| keyword | string | N | 이름/사번 |
| department | string | N | 부서 |
| status | enum | N | ACTIVE / INACTIVE |
| role | enum | N | SALES_REP / MANAGER / ADMIN |

응답의 목록 항목은 화면(SCR-500)이 쓰는 것만 담는다 — `repId`, `empNo`, `name`, `department`, `position`, `managerId`, `managerName`, `role`, `status`. **이메일은 포함하지 않는다**(NFR-04). 이메일이 필요하면 상세(6.3)를 쓴다.

- `managerName`은 상급자 이름이다. 목록 컬럼이 이름이라 식별자만 주면 화면이 다시 조회해야 하고, 페이지네이션 때문에 같은 목록 안에 상급자가 있다는 보장도 없다.
- `role` 필터는 SCR-510의 상급자 Select가 쓴다. 전부 받아 화면에서 거르면 페이지네이션에 걸려 빠지는 사원이 생긴다.

### 6.2 영업 등록

`POST /api/sales-reps`

요청

```json
{
  "empNo": "S2026001", "name": "홍길동", "email": "hong@company.com",
  "department": "영업1팀", "position": "대리", "managerId": 2,
  "role": "SALES_REP", "status": "ACTIVE"
}
```

- `role`은 `SALES_REP` / `MANAGER` / `ADMIN` 중 하나이며 생략하면 `SALES_REP`다. 이 API 자체가 관리자 전용이므로 역할 지정도 관리자만 할 수 있다.
- `managerId`로 지정하는 사원은 다음을 만족해야 한다. 어긋나면 400이다.
  - **존재**(`MANAGER_NOT_FOUND`)
  - **활성 상태**(`MANAGER_INACTIVE`) — 비활성 상급자는 로그인할 수 없어 그 팀의 보고를 아무도 검토하지 못한다
  - **role이 `MANAGER`**(`MANAGER_ROLE_REQUIRED`) — 데이터상 상급자인데 팀 보고 조회·댓글 권한이 없는 상태를 막는다
  - **순환 없음**(`SELF_MANAGER`, `MANAGER_CYCLE`) — 자기 자신은 물론 A→B→A 같은 간접 순환도 막는다

- `empNo`, `email`은 유일값(중복 시 409).

응답 201 — 생성된 영업 반환. `password`를 생략했으면 `temporaryPassword`가 함께 담긴다.

```json
{
  "success": true,
  "data": {
    "repId": 10, "empNo": "S2026001", "name": "홍길동", "role": "SALES_REP",
    "temporaryPassword": "9Qx2...1회만 반환"
  }
}
```

- 평문은 저장되지 않으므로 **이 응답이 유일한 전달 경로다.** 다시 볼 수 없고, 분실 시 6.5로 재발급한다.
- `password`를 직접 지정해도 **변경 강제는 동일하게 걸린다.** 관리자가 아는 값이기 때문이다.

### 6.3 영업 상세 / 수정

- `GET /api/sales-reps/{repId}` → 200  
- `PUT /api/sales-reps/{repId}` → 200

요청 본문은 6.2와 같다(비밀번호 제외). `role` 변경도 이 경로로 한다.

- PUT은 **전체 교체**다. `role`과 `status`는 생성과 달리 **필수**이며 생략하면 400이다. 기본값으로 메우면 보내지 않은 필드가 조용히 바뀐다 — `role`을 빼면 상급자가 영업사원으로 강등되고, `status`를 빼면 비활성 계정이 다시 활성화된다.
- `managerId`를 생략하면 상급자 관계가 해제된다(전체 교체).
- **`managerId`가 바뀔 때만 상급자 제약(6.2)을 검증한다.** 값이 그대로면 검증을 건너뛴다. 매번 검증하면 상급자가 나중에 비활성화된 사원은 이름·부서만 고치려는 요청까지 막힌다. 마스터는 물리 삭제 대신 비활성화로 남으므로(NFR-03) 그 상태는 정상이다.
- **마지막 활성 관리자의 역할 강등·비활성화는 409(`LAST_ACTIVE_ADMIN`)로 막는다.** 영업 마스터 관리 경로가 차단되고, 토큰까지 즉시 끊긴다(1.5). 활성 관리자가 0명이 된 경우의 복구는 `npm run bootstrap:admin`(활성 관리자가 없을 때만 동작) 또는 DB 직접 수정뿐이므로, 운영 중 수동 개입이 필요한 상태다. 관리자가 여럿이면 교체·정리는 정상 작업이므로 허용한다.

### 6.4 영업 비활성화

`PATCH /api/sales-reps/{repId}/status` → 200

- 마지막 활성 관리자는 비활성화할 수 없다 — 409 `LAST_ACTIVE_ADMIN`. 6.3과 같은 규칙이다.

### 6.5 임시 비밀번호 재발급

`POST /api/sales-reps/{repId}/password/reset`

응답 200

```json
{
  "success": true,
  "data": { "repId": 10, "empNo": "S2026001", "temporaryPassword": "9Qx2...1회만 반환" }
}
```

- 관리자 전용. 비밀번호를 잊은 사원의 계정을 다시 쓸 수 있게 한다.
- 관리자는 기존 비밀번호를 알 수 없다(해시만 저장한다). 확인이 아니라 **재발급**이다.
- 발급 후 `mustChangePassword`가 서고, 본인이 바꿀 때까지 다른 API는 403이다.

### 6.6 영업 Select 옵션

`GET /api/sales-reps/options`

고객 등록·수정(SCR-410)의 담당 영업 Select, 고객 목록(SCR-400)의 담당 영업 검색 조건을 채운다. **인증된 모든 역할**(SALES_REP · MANAGER · ADMIN)이 호출할 수 있다. 이 절의 나머지(6.1~6.5)는 관리자 전용이다.

응답 200

```json
{
  "success": true,
  "data": [
    { "repId": 1, "name": "홍길동" },
    { "repId": 2, "name": "김부장" }
  ],
  "error": null
}
```

- **6.1 과 별도인 이유.**
  - 필드: `repId`·`name` 만 담는다. 사번·이메일·부서·직급·역할·상태는 담지 않는다(NFR-04). 6.1 은 그것들을 담아 관리자 전용이다. 권한을 넓히면 전 직원에게 그 정보가 보이므로 6.1 은 그대로 두고 최소 필드 엔드포인트를 따로 둔다.
  - 역할: SCR-400·410 의 접근 권한은 영업사원/상급자인데 6.1 은 관리자 전용이라 화면을 채울 수 없었다. 페이로드가 활성 사원의 이름뿐이므로 역할별로 가리지 않고 인증만 요구한다(401). 역할 검사는 하지 않는다.
- **`ACTIVE` 사원만 반환한다.** 새 고객의 담당자로 비활성 사원을 고를 수 없어야 한다. 그래서 기존 담당자가 이미 비활성인 고객의 수정 화면에는 그 값이 이 목록에 없다 — 화면이 별도로 다뤄야 한다.
- **정렬은 `name` 오름차순이고 페이지네이션이 없다.** Select 는 전체 목록이 필요하고, 페이지로 자르면 빠지는 사원이 생긴다(6.1 `role` 필터와 같은 이유). 조직이 커지면 검색형 Select 로 바꿔야 한다.

### 6.7 팀원 Select 옵션

`GET /api/sales-reps/team`

팀 보고 조회(SCR-300)의 "팀원" 다중 선택 Select 를 채운다. 호출자의 **직속 팀원**(`managerId` 가 호출자 `repId` 인 사원)을 준다. **MANAGER 만** 호출할 수 있다.

응답 200

```json
{
  "success": true,
  "data": [
    { "repId": 1, "name": "홍길동", "status": "ACTIVE" },
    { "repId": 7, "name": "이퇴사", "status": "INACTIVE" }
  ],
  "error": null
}
```

- **6.6 이 아니라 따로 둔 이유.** 6.6 은 전사 활성 사원 전체를 준다. 그것으로 Select 를 채우면 상급자가 팀원이 아닌 사람을 고를 수 있고, 고르면 3.6 이 403(`소속 팀원 범위를 벗어난 조회입니다.`)을 준다. 선택지가 403 을 만드는 화면이 된다. 조직 전체 명단이 이 화면에 필요하지도 않다. 6.1 은 관리자 전용이라 상급자가 부를 수 없다.
- **범위가 3.6 팀 보고 조회와 정확히 같다.** 직속 부하만이고 손자 팀원은 없다. 3.6 이 쓰는 조건(`managerId = 호출자`)과 같은 조건을 쓴다. 두 범위가 어긋나면 고를 수 있는데 403 이거나, 목록에 나오는데 필터할 수 없는 사람이 생긴다.
- **`status` 로 거르지 않는다(6.6 과 다르다).** 3.6 은 팀원을 `status` 로 거르지 않으므로 비활성 팀원의 과거 보고도 목록에 나온다. 6.6 처럼 `ACTIVE` 만 주면 그 보고가 목록에는 있는데 그 사람으로 필터할 수 없게 된다. 6.6 이 `ACTIVE` 만 주는 이유(새 고객의 담당자로 비활성 사원을 고를 수 없어야 함)는 이 화면에 해당하지 않는다. 그래서 응답에 `status` 를 담아 화면이 "(비활성)" 을 표시하게 한다. 일관성을 이유로 `ACTIVE` 필터를 넣지 않는다.
- **역할 검사를 한다(6.6 과 다르다).** SALES_REP·ADMIN 은 403 이다. 6.6 의 페이로드는 전사 이름뿐이지만 이 응답은 "누가 누구의 부하인가" 라는 조직 구조라 상급자 본인에게만 준다. 역할 검사를 입력 처리보다 먼저 한다.
- **필드는 `repId`·`name`·`status` 뿐이다.** 사번·이메일·부서·직급은 담지 않는다(NFR-04). 6.1 은 그것들을 담아 관리자 전용이다.
- **팀원이 없으면 빈 배열 200 이다.** 404 가 아니다(3.6 과 같다).
- **정렬은 `name` 오름차순이고 페이지네이션이 없다.** Select 는 전체가 필요하다(6.6 과 같다).

---

## 7\. 엔드포인트 요약

| 분류 | 메서드 | 경로 | 설명 |
| :---- | :---- | :---- | :---- |
| 인증 | POST | /api/auth/login | 로그인 |
| 인증 | POST | /api/auth/logout | 로그아웃 |
| 인증 | PUT | /api/me/password | 본인 비밀번호 변경 |
| 일일보고 | GET | /api/reports | 본인 보고 목록 |
| 일일보고 | POST | /api/reports | 오늘자 보고 생성 |
| 일일보고 | GET | /api/reports/{reportId} | 상세 |
| 일일보고 | PUT | /api/reports/{reportId} | 방문/과제/계획 일괄 저장 |
| 일일보고 | POST | /api/reports/{reportId}/submit | 제출 |
| 일일보고 | GET | /api/reports/team | 팀 보고 조회(상급자) |
| 댓글 | GET | /api/reports/{reportId}/comments | 댓글 목록 |
| 댓글 | POST | /api/reports/{reportId}/comments | 댓글 작성 |
| 댓글 | PUT | /api/reports/{reportId}/comments/{commentId} | 댓글 수정 |
| 댓글 | DELETE | /api/reports/{reportId}/comments/{commentId} | 댓글 삭제 |
| 고객 | GET | /api/customers | 목록 |
| 고객 | POST | /api/customers | 등록 |
| 고객 | GET | /api/customers/{customerId} | 상세 |
| 고객 | PUT | /api/customers/{customerId} | 수정 |
| 고객 | PATCH | /api/customers/{customerId}/status | 비활성화 |
| 영업 | GET | /api/sales-reps | 목록 |
| 영업 | POST | /api/sales-reps | 등록 |
| 영업 | GET | /api/sales-reps/{repId} | 상세 |
| 영업 | PUT | /api/sales-reps/{repId} | 수정 |
| 영업 | PATCH | /api/sales-reps/{repId}/status | 비활성화 |
| 영업 | POST | /api/sales-reps/{repId}/password/reset | 임시 비밀번호 재발급 |
| 영업 | GET | /api/sales-reps/options | Select 옵션(전 역할, repId·name) |
| 영업 | GET | /api/sales-reps/team | 팀원 Select 옵션(상급자, 직속·비활성 포함) |

