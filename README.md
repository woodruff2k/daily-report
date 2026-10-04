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

Prisma는 `6.19.3`으로 정확히 고정되어 있고, 이 프로젝트는 6에서 유지한다. 7.x는 설정 이관에 더해 제너레이터 교체와 ESM 전환까지 따라오므로 올리지 않기로 했다. 자세한 배경은 `prisma/schema.prisma` 상단 주석에 있다.

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
cp .env.example .env
```

파일 이름은 `.env`여야 한다. Prisma CLI가 `.env`만 읽기 때문에, `.env.local`로 만들면 `make migrate`를 비롯한 DB 관련 명령이 `DATABASE_URL`을 찾지 못한다. Next.js는 두 파일을 모두 읽으므로 `.env` 하나로 CLI와 애플리케이션이 함께 해결된다. `.env`는 `.gitignore`에 등록되어 있다.

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

> **컨테이너는 호스트 5433 포트에 붙는다.** 호스트에 이미 떠 있는 PostgreSQL과 충돌하지 않도록 5432 대신 5433으로 매핑했다(컨테이너 내부 포트는 5432 그대로다). `DATABASE_URL`의 포트도 5433이어야 하며, 기존에 환경 파일을 만들어 둔 경우 직접 고쳐야 한다. 배경은 [이슈 #31](https://github.com/woodruff2k/daily-report/issues/31)을 참고한다.

### 4. 관리자 계정

`make db-seed`는 관리자(`S2026000`)·상급자(`S2026001`)·영업사원 2명을 만든다. 영업 마스터 API(`/api/sales-reps`)는 관리자 전용이므로 관리자 계정이 없으면 호출할 수 없다.

운영 환경에서는 seed를 쓰지 않는다(더미 고객·보고까지 들어간다). 최초 관리자는 별도 스크립트로 만든다.

```bash
BOOTSTRAP_ADMIN_EMP_NO=S0000001 \
BOOTSTRAP_ADMIN_NAME=관리자 \
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD='...' \
npm run bootstrap:admin
```

`make db-seed`로 만든 계정은 바로 로그인할 수 있다(`seed-dev-only-Passw0rd!`). 반면 **API로 등록한 영업사원은 임시 비밀번호 상태**로 만들어진다 — 등록 응답의 `temporaryPassword`를 전달받아 최초 로그인 후 비밀번호를 바꿔야 다른 기능을 쓸 수 있다. 서버가 `PUT /api/me/password` 외의 요청을 403으로 막는다.

비밀번호는 환경 변수로만 받는다. 명령 인자로 넘기면 셸 히스토리와 프로세스 목록에 남는다. 스크립트는 비밀번호를 출력하지 않으며, **활성 관리자가 이미 있으면 중단한다.** 두 번째 관리자부터는 API로 등록해 기록을 남긴다.

### 5. 개발 서버 실행

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

커밋 시 husky와 lint-staged가 변경된 파일에 prettier와 ESLint를 자동 실행한다. 포맷 기준은 `.prettierrc`에 있고 prettier 버전은 고정되어 있다. 전체를 직접 맞추려면 `npm run format`, 확인만 하려면 `npm run format:check`를 쓴다.

마크다운은 포맷 대상에서 제외했다(`.prettierignore`). prettier가 표 칸을 글자 수로 세어 padding을 넣는데, 한글은 한 글자가 두 칸 폭이라 모노스페이스 편집기에서 오히려 어긋나 보인다.

포맷만 바꾼 커밋이 `git blame`을 덮지 않도록 한 번 설정해 둔다.

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

### Git worktree

이슈별로 `git worktree`를 쓸 때는 **워크트리 안에서 의존성 설치까지 해야 한다.**

```bash
git worktree add issue-005 -b feat/issue-5-sales-reps-api
cd issue-005
npm install
```

본 저장소의 `node_modules`를 심볼릭 링크로 연결해 설치를 건너뛰었다면, 대신 `npm run prepare`를 한 번 실행한다.

```bash
ln -s ../node_modules node_modules
npm run prepare
```

`npm install`이나 `npm run prepare` 없이 커밋하면 **husky 훅이 조용히 건너뛰어진다.** 이 저장소는 `core.hooksPath`가 `.husky/_`(상대 경로)이고 git은 이를 현재 작업 트리 최상위 기준으로 해석한다. `.husky/pre-commit`은 저장소에 추적되지만 `.husky/_`는 `prepare` 스크립트가 만드는 미추적 디렉터리라서, 새 워크트리에는 존재하지 않는다. git은 훅을 찾지 못해도 경고를 내지 않는다.

커밋 출력에 lint-staged 로그가 보이지 않으면 훅이 동작하지 않은 것이다. 그 상태로 커밋해야 한다면 검사를 직접 돌린다.

```bash
npm run lint && npx tsc --noEmit && npm test
```

작업이 끝나면 워크트리를 정리한다. 본 저장소 쪽에서 실행한다.

```bash
git worktree remove issue-005
```

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
make run              # 로컬 컨테이너 실행 (.env 필요)
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

prisma.config.ts           # Prisma CLI 설정 (스키마 경로, seed, .env 로드)
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

### 역할

`SalesRep.role`이 인가의 근거다. **역할 간 상하 관계는 없다.**

| 역할 | 권한 |
| :--- | :--- |
| `SALES_REP` | 본인 보고 작성·조회, 본인 보고에 대댓글, 본인 댓글 수정·삭제, 고객 마스터 조회·등록 |
| `MANAGER` | 직속 팀원의 제출된 보고 조회·댓글, 고객 마스터 조회·등록 |
| `ADMIN` | 영업 마스터 관리 |

### 관리자 계정이 0명이 된 경우

영업 마스터 API는 관리자 전용이므로 활성 관리자가 없으면 관리 경로가 막힌다. `npm run bootstrap:admin`은 **활성 관리자가 없을 때만** 동작하므로 이 상황의 복구 수단이 된다.

```bash
BOOTSTRAP_ADMIN_EMP_NO=S0000002 \
BOOTSTRAP_ADMIN_NAME=복구관리자 \
BOOTSTRAP_ADMIN_EMAIL=recovery@example.com \
BOOTSTRAP_ADMIN_PASSWORD='...' \
npm run bootstrap:admin
```

평상시에는 마지막 활성 관리자의 강등·비활성화가 409로 막히고(API 명세 6.3), 동시 요청으로 그 검사를 우회하는 경로도 권고 잠금으로 닫혀 있다. 그래도 DB를 직접 수정하면 이 상태가 만들어질 수 있다.

### 토큰 무효화

JWT는 8시간 유효하지만 서버가 거둬들일 수 있다. `SalesRep.tokenVersion`을 토큰에 담고, 프록시가 요청마다 DB 값과 비교한다. 비밀번호 변경·재발급, 계정 비활성화, 역할 변경, 로그아웃이 그 값을 올려 기존 토큰을 즉시 끊는다.

대가는 **요청마다 DB 조회 1회**다. 로컬 측정에서 중앙값 3.3ms → 3.9ms(약 +0.6ms)였다. 운영 환경(Cloud SQL)에서는 더 커질 수 있다.

관리자가 영업사원의 보고를 조회할 수 없고, 상급자가 영업 마스터를 관리할 수 없다. 조직 구조(`managerId`)와 역할(`role`)은 별개 값이므로, 누군가의 상급자로 지정하려면 그 사원의 역할이 `MANAGER`여야 한다. 서버가 이를 검증한다.

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
