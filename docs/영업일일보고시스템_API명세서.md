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
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 충돌(중복 보고 등) |

### 1.5 권한 정책

- 모든 권한은 **서버 측에서 검증**한다. 영업사원은 본인 보고만, 상급자는 소속 팀원 보고 조회·댓글, 관리자는 영업 마스터 관리.

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
    "rep": { "repId": 1, "name": "홍길동", "role": "SALES_REP" }
  }
}
```

### 2.2 로그아웃

`POST /api/auth/logout` — 응답 204

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
      { "problemId": 200, "customerId": 5, "content": "납기 단축 요청", "status": "OPEN" }
    ],
    "plans": [
      { "planId": 300, "customerId": 5, "plannedDate": "2026-06-21", "content": "견적서 발송" }
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
    { "customerId": 5, "content": "납기 단축 요청", "status": "OPEN" }
  ],
  "plans": [
    { "customerId": 5, "plannedDate": "2026-06-21", "content": "견적서 발송" }
  ]
}
```

응답 200 — 갱신된 상세 반환

| 유효성 | 규칙 |
| :---- | :---- |
| visits | 최소 1건, 각 항목 customerId·visitType·content 필수 |
| visitType | VISIT / CALL / ONLINE |
| customerId | 활성 또는 참조 가능한 고객 |

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
    { "commentId": 400, "commenter": { "repId": 2, "name": "김부장" },
      "content": "견적 일정 확인 바람", "parentCommentId": null,
      "createdAt": "2026-06-20T19:00:00+09:00",
      "replies": [
        { "commentId": 401, "commenter": { "repId": 1, "name": "홍길동" },
          "content": "확인했습니다", "parentCommentId": 400,
          "createdAt": "2026-06-20T19:10:00+09:00" }
      ] }
  ]
}
```

### 4.2 댓글 작성

`POST /api/reports/{reportId}/comments`

- 상급자(또는 대댓글의 경우 본인) 권한 검증.

요청

```json
{ "content": "견적 일정 확인 바람", "parentCommentId": null }
```

응답 201 — 생성된 댓글 반환

### 4.3 댓글 수정 / 삭제

- `PUT /api/reports/{reportId}/comments/{commentId}` (본인 작성 한정) → 200  
- `DELETE /api/reports/{reportId}/comments/{commentId}` (본인 작성 한정) → 204

---

## 5\. 고객 마스터 API

### 5.1 고객 목록

`GET /api/customers`

| 파라미터 | 타입 | 필수 | 설명 |
| :---- | :---- | :---: | :---- |
| keyword | string | N | 고객명/회사명 검색 |
| assignedRepId | bigint | N | 담당 영업 |
| grade | string | N | 고객등급 |
| status | enum | N | ACTIVE / INACTIVE |

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
- `PUT /api/customers/{customerId}` → 200

### 5.4 고객 비활성화

`PATCH /api/customers/{customerId}/status`

- 물리 삭제 대신 상태 전환.

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

### 6.2 영업 등록

`POST /api/sales-reps`

요청

```json
{
  "empNo": "S2026001", "name": "홍길동", "email": "hong@company.com",
  "department": "영업1팀", "position": "대리", "managerId": 2, "status": "ACTIVE"
}
```

- `empNo`, `email`은 유일값(중복 시 409).

응답 201 — 생성된 영업 반환

### 6.3 영업 상세 / 수정

- `GET /api/sales-reps/{repId}` → 200  
- `PUT /api/sales-reps/{repId}` → 200

### 6.4 영업 비활성화

`PATCH /api/sales-reps/{repId}/status` → 200

---

## 7\. 엔드포인트 요약

| 분류 | 메서드 | 경로 | 설명 |
| :---- | :---- | :---- | :---- |
| 인증 | POST | /api/auth/login | 로그인 |
| 인증 | POST | /api/auth/logout | 로그아웃 |
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

