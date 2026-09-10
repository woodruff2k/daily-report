# 영업 일일 보고 시스템

영업사원이 매일의 방문 활동을 기록하고, 과제·상담과 익일 계획을 작성하면 상급자가 댓글로 피드백을 남기는 일일 보고 관리 시스템이다. 고객과 영업사원은 마스터로 관리한다.

> 학습용으로 진행 중인 프로젝트다. 아직 배포되지 않았고 일부 기능은 구현 전이다. 현재 상태는 [진행 현황](#진행-현황)을 참고한다.

## 기술 스택

| 구분 | 사용 기술 |
| :--- | :--- |
| 언어 | TypeScript |
| 프레임워크 | Next.js 16 (App Router), React 19 |
| UI | shadcn/ui, Tailwind CSS 4 |
| 검증 | Zod |
| ORM | Prisma 6 |
| DB | PostgreSQL 15 |
| 인증 | JWT (jsonwebtoken), bcryptjs |
| 테스트 | Vitest |
| 배포 | Docker, Google Cloud Run (asia-northeast3) |

## 시작하기

### 요구 사항

- Node.js 20 이상
- Docker (로컬 PostgreSQL 실행용)

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 준비

```bash
cp .env.example .env.local
```

`JWT_SECRET`은 실제 값으로 바꾼다.

```bash
openssl rand -base64 32
```

### 3. 데이터베이스 기동

```bash
make db-up      # PostgreSQL 컨테이너 기동 (healthy 상태까지 대기)
make migrate    # Prisma 마이그레이션 적용
make db-seed    # 더미 데이터 투입
```

`make db-up`은 컨테이너가 정상 상태가 될 때까지 기다린 뒤 종료하므로 위 세 명령을 연달아 실행해도 된다.

> **호스트 5432 포트가 이미 사용 중이면 접속에 실패한다.** 다른 PostgreSQL이 떠 있으면 컨테이너가 정상 상태로 보여도 연결이 그쪽으로 간다. 기존 PostgreSQL을 중지하거나 [이슈 #31](https://github.com/woodruff2k/daily-report/issues/31)을 참고한다.

### 4. 개발 서버 실행

```bash
npm run dev
```

http://localhost:3000 에서 확인한다.

## 주요 명령

### 개발

```bash
npm run dev              # 개발 서버
npm run lint             # ESLint 검사 (lint:fix로 자동 수정)
npm test                 # Vitest 1회 실행
npm run test:watch       # Vitest 감시 모드
npm run test:coverage    # 커버리지 측정
npx vitest run <파일경로>  # 단일 테스트
```

자주 쓰는 명령은 make 타깃으로도 감싸 두었다.

```bash
make dev            # npm run dev
make lint           # npm run lint
make lint-fix       # npm run lint:fix
make test           # npm test
make test-coverage  # npm run test:coverage
```

커밋 시 husky와 lint-staged가 변경된 TypeScript 파일에 ESLint를 자동 실행한다.

### 데이터베이스

```bash
make db-up        # 컨테이너 기동
make db-down      # 컨테이너 중지
make db-seed      # 더미 데이터 투입
make db-studio    # Prisma Studio 실행
make migrate      # 마이그레이션 적용 (deploy)
make migrate-dev  # 마이그레이션 생성 및 적용 (dev)
```

### Docker · 배포

```bash
make build            # 이미지 빌드
make run              # 로컬 컨테이너 실행 (.env.local 필요)
make registry-create  # Artifact Registry 저장소 생성 (최초 1회)
make docker-auth      # Artifact Registry 인증 설정
make push             # 이미지 푸시 (docker-auth 선행)
make deploy           # 현재 이미지로 Cloud Run 배포
make deploy-prod      # 빌드 → 푸시 → 배포 일괄 실행
make logs             # Cloud Run 로그 조회
make status           # 서비스 상태 조회
make rollback         # 이전 리비전으로 트래픽 전환
```

이미지 태그는 `TAG` 변수로 바꿀 수 있다. 기본값은 `latest`다.

```bash
make build TAG=v1.0.0
```

배포용 GCP 리소스는 아직 만들지 않았다. 자동 배포 워크플로도 잠시 꺼둔 상태다. [이슈 #20](https://github.com/woodruff2k/daily-report/issues/20)에서 진행한다.

## 프로젝트 구조

```
src/
├── app/
│   ├── (auth)/login/      # 로그인 화면
│   ├── (main)/            # 보고·고객·영업·팀 화면
│   └── api/auth/          # 로그인·로그아웃 API
├── components/ui/         # shadcn/ui 컴포넌트
├── lib/
│   ├── auth.ts            # 권한 검증 헬퍼
│   ├── jwt.ts             # 토큰 서명·검증
│   ├── password.ts        # 비밀번호 해싱
│   ├── prisma.ts          # Prisma 클라이언트
│   └── api-response.ts    # 공통 응답 포맷
├── schemas/               # Zod 요청 스키마
├── types/                 # 공용 타입
└── proxy.ts               # 인증 프록시 (토큰 검증)

prisma/
├── schema.prisma          # 데이터 모델
├── migrations/            # 마이그레이션 이력
└── seed.ts                # 더미 데이터

docs/                      # 요건 문서
```

## 데이터 모델

7개 엔터티로 구성된다.

| 엔터티 | 설명 |
| :--- | :--- |
| `SalesRep` | 영업 마스터. 자기참조로 상급자 관계를 표현 |
| `Customer` | 고객 마스터. 담당 영업사원을 참조 |
| `DailyReport` | 일일보고. 사원 1명 × 1일 = 1건 |
| `VisitRecord` | 방문기록. 일일보고에 N건, 고객을 참조 |
| `ReportProblem` | 과제·상담. 일일보고에 N건 |
| `ReportPlan` | 익일 계획. 일일보고에 N건 |
| `ReportComment` | 댓글. 대댓글 가능 |

마스터는 물리 삭제하지 않고 상태값으로 비활성화하여 과거 보고와의 참조를 유지한다.

## 문서

요건 정의부터 테스트 명세까지 `docs/`에 있다.

- [요구사항 정의서](docs/영업일일보고시스템_요구사항정의서.md)
- [ER 다이어그램](docs/영업일일보고시스템_ER다이어그램.md)
- [화면 정의서](docs/영업일일보고시스템_화면정의서.md)
- [API 명세서](docs/영업일일보고시스템_API명세서.md)
- [테스트 명세서](docs/영업일일보고시스템_테스트명세서.md)

## 진행 현황

작업은 이슈 단위로 나누어 마일스톤 4단계로 진행한다.

| 마일스톤 | 상태 |
| :--- | :--- |
| Phase 1 기반 인프라 | 진행 중 |
| Phase 2 핵심 API | 예정 |
| Phase 3 화면 구현 | 예정 |
| Phase 4 테스트 및 배포 | 예정 |

구현이 끝난 부분은 다음과 같다.

- 프로젝트 초기 구조와 shadcn/ui 설정
- Prisma 스키마와 마이그레이션, 더미 데이터
- 로그인·로그아웃 API와 JWT 인증 프록시
- 서버사이드 권한 검증 헬퍼

일일보고·고객·영업 마스터 API와 화면은 아직 구현 전이다. `src/app` 아래 화면 파일은 라우팅 확인용 뼈대만 있는 상태다.

남은 작업은 [이슈 목록](https://github.com/woodruff2k/daily-report/issues)에서 확인한다.
