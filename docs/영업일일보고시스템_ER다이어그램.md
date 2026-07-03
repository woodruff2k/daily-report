# 영업 일일 보고 시스템 — ER 다이어그램

| 항목 | 내용 |
| :---- | :---- |
| 문서명 | 영업 일일 보고 시스템 ER 다이어그램 |
| 버전 | v1.0 |
| 작성일 | 2026-06-20 |
| 관련 문서 | 요구사항 정의서, 화면 정의서 |

---

## 1\. 핵심 엔터티

| 엔터티 | 설명 |
| :---- | :---- |
| SALES\_REP | 영업 마스터. 자기참조로 상급자(manager) 관계를 표현 |
| CUSTOMER | 고객 마스터. 담당 영업사원을 참조 |
| DAILY\_REPORT | 일일보고. 영업사원 1명 × 1일 \= 1건 |
| VISIT\_RECORD | 방문기록. 일일보고에 N건, 고객을 참조 |
| REPORT\_PROBLEM | 과제/상담(Problem). 일일보고에 N건 |
| REPORT\_PLAN | 내일 할 일(Plan). 일일보고에 N건 |
| REPORT\_COMMENT | 댓글. 일일보고에 N건, 작성자(상급자) 참조, 대댓글 가능 |

---

## 2\. ER 다이어그램 (Mermaid)

```
erDiagram
    SALES_REP ||--o{ DAILY_REPORT : "작성"
    SALES_REP ||--o{ CUSTOMER : "담당"
    SALES_REP ||--o{ SALES_REP : "상급자(manager)"
    SALES_REP ||--o{ REPORT_COMMENT : "댓글작성"
    DAILY_REPORT ||--o{ VISIT_RECORD : "포함"
    DAILY_REPORT ||--o{ REPORT_PROBLEM : "포함"
    DAILY_REPORT ||--o{ REPORT_PLAN : "포함"
    DAILY_REPORT ||--o{ REPORT_COMMENT : "대상"
    CUSTOMER ||--o{ VISIT_RECORD : "방문대상"
    REPORT_COMMENT ||--o{ REPORT_COMMENT : "대댓글"

    SALES_REP {
        bigint rep_id PK
        string emp_no "사번"
        string name
        string email
        string department "부서"
        string position "직급"
        bigint manager_id FK "상급자 rep_id"
        string status "ACTIVE/INACTIVE"
        datetime created_at
        datetime updated_at
    }

    CUSTOMER {
        bigint customer_id PK
        string customer_name "고객/담당자명"
        string company_name "회사명"
        string phone
        string email
        string address
        string grade "고객등급"
        bigint assigned_rep_id FK "담당 영업"
        string status "ACTIVE/INACTIVE"
        datetime created_at
        datetime updated_at
    }

    DAILY_REPORT {
        bigint report_id PK
        bigint rep_id FK "작성 영업사원"
        date report_date "보고일자"
        string status "DRAFT/SUBMITTED"
        datetime submitted_at
        datetime created_at
        datetime updated_at
    }

    VISIT_RECORD {
        bigint visit_id PK
        bigint report_id FK
        bigint customer_id FK
        time visit_time "방문시각"
        string visit_type "방문/전화/온라인"
        string content "방문 내용"
        string result "상담 결과"
        int sort_order "정렬순서"
        datetime created_at
    }

    REPORT_PROBLEM {
        bigint problem_id PK
        bigint report_id FK
        bigint customer_id FK "관련 고객(선택)"
        string content "과제/상담 내용"
        string status "OPEN/CLOSED"
        datetime created_at
    }

    REPORT_PLAN {
        bigint plan_id PK
        bigint report_id FK
        bigint customer_id FK "관련 고객(선택)"
        string content "내일 할 일"
        date planned_date "예정일"
        datetime created_at
    }

    REPORT_COMMENT {
        bigint comment_id PK
        bigint report_id FK "대상 일일보고"
        bigint commenter_id FK "작성자(상급자)"
        bigint parent_comment_id FK "대댓글(선택)"
        string content "댓글 내용"
        datetime created_at
    }
```

---

## 3\. 관계 요약

| 관계 | 카디널리티 | 설명 |
| :---- | :---- | :---- |
| SALES\_REP — DAILY\_REPORT | 1 : N | 영업사원이 일일보고 작성 (사원+일자 단위 유일) |
| SALES\_REP — CUSTOMER | 1 : N | 영업사원이 고객 담당 |
| SALES\_REP — SALES\_REP | 1 : N | 자기참조 상급자 관계 |
| SALES\_REP — REPORT\_COMMENT | 1 : N | 댓글 작성자 |
| DAILY\_REPORT — VISIT\_RECORD | 1 : N | 하루에 여러 방문 입력 |
| DAILY\_REPORT — REPORT\_PROBLEM | 1 : N | 과제/상담 여러 건 |
| DAILY\_REPORT — REPORT\_PLAN | 1 : N | 내일 할 일 여러 건 |
| DAILY\_REPORT — REPORT\_COMMENT | 1 : N | 보고서 단위 댓글 |
| CUSTOMER — VISIT\_RECORD | 1 : N | 방문 대상 고객 |
| REPORT\_COMMENT — REPORT\_COMMENT | 1 : N | 대댓글(스레드) |

---

## 4\. 설계 메모

- **하루 여러 방문**: `DAILY_REPORT 1 : N VISIT_RECORD`로 처리하며, 각 방문이 고객을 참조하므로 "고객 \+ 방문내용" 행이 자유롭게 늘어난다.  
- **댓글 대상**: 일일보고 단위로 설계. 과제(Problem)/계획(Plan) 단위로 댓글이 필요하면 `REPORT_COMMENT`에 `target_type`(REPORT/PROBLEM/PLAN) \+ `target_id` 다형성 컬럼으로 확장 가능.  
- **상급자**: 별도 테이블 없이 `SALES_REP.manager_id` 자기참조로 표현.  
- **마스터 무결성**: 고객/영업 마스터는 물리 삭제 대신 `status` 비활성화로 과거 보고와의 참조를 유지.

