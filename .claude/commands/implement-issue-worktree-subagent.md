Issue #$ARGUMENTS를 Git Worktree를 사용해 구현하세요.

## 서브에이전트 선택

Issue의 **라벨**로 고릅니다. 라벨이 `high-priority`처럼 분류가 아니면 제목 접두사(`[백엔드]` 등)를 봅니다.

| 라벨·접두사 | 서브에이전트 | 담당 |
| :---- | :---- | :---- |
| 백엔드 | `backend-engineer` | 라우트 핸들러, Prisma, Zod 스키마, 인가 |
| 프론트엔드 | `frontend-engineer` | SCR-\* 화면, 컴포넌트, API 연동 |
| 테스트 | `test-engineer` | 테스트 명세서 TC 구현, 커버리지 공백 |
| 인프라·배포 | `infra-engineer` | CI, Dockerfile, Cloud Run, 마이그레이션 운영 |

- 정의는 `.claude/agents/*.md`에 있습니다. **Issue를 읽은 뒤 해당 정의를 먼저 읽고** 그 에이전트에 맡길 범위를 정하세요.
- 한 Issue가 여러 영역에 걸치면(API + 화면) **영역별로 나눠 순차로 맡기세요.** 백엔드를 먼저 끝내고 그 결과를 프론트엔드에 넘깁니다.
- 어느 것도 맞지 않으면 억지로 고르지 말고 직접 구현하고, 그 이유를 보고하세요.

## 구현 절차

### 1. 전처리(Worktree 생성 전)

- 현재 브랜치가 main 이외면 main으로 체크아웃하세요.
- `git checkout main && git pull --ff-only`로 최신 main을 받으세요.
- 같은 이름의 브랜치가 이미 있으면 **지우기 전에 `git log main..<브랜치>`로 머지되지 않은 커밋이 있는지 확인하세요.** 있으면 삭제하지 말고 사용자에게 알리세요.

### 2. Worktree 생성

- `git worktree add issue-$ARGUMENTS -b feat/issue-$ARGUMENTS` 명령으로 생성하세요.
- 하위 폴더는 `issue-***` 명명 규칙을 따릅니다.
- 브랜치 접두사는 작업 성격에 맞춥니다 — 기능은 `feat/`, 설정·정리는 `chore/`, 문서는 `docs/`.

### 3. Worktree 환경 설정

- 생성한 하위 디렉터리 `issue-$ARGUMENTS`로 이동하세요.
- **`npm install`을 실행하세요.** Worktree에는 `.husky/_`가 없어서 pre-commit 훅이 조용히 죽습니다. `npx husky install`은 husky 9에서 폐기된 명령이라(실행하면 DEPRECATED 경고만 냅니다) 쓰지 마세요 — 이 저장소는 `package.json`의 `prepare: husky`로 설치하므로 `npm install` 하나로 끝납니다.
- `.env`는 Worktree에 복사되지 않습니다. DB가 필요한 작업이면 `DATABASE_URL`·`JWT_SECRET`을 명령줄에서 직접 넘기세요.

### 4. 구현

- Issue 내용과 수용 기준을 확인하고, 위 표에서 고른 서브에이전트에 맡기세요.
- 설계 문서(CLAUDE.md에 붙어 있는 API 명세서·화면정의서·테스트 명세서)가 계약입니다. 명세와 다르게 구현해야 한다고 판단되면 **먼저 보고하세요.**
- 구현이 끝나면 다음을 **모두** 실행해 통과를 확인하세요.

```bash
npx tsc --noEmit
npm run lint
npm test
npm run format:check
```

- 서브에이전트가 "통과했다"고 보고해도 **직접 다시 돌려 확인하세요.** 실패를 숨기지 말고 출력과 함께 보고하세요.

### 5. 풀 리퀘스트 생성

- 변경 사항을 커밋하고 리모트에 푸시하세요.
- `gh pr create` 명령으로 풀 리퀘스트를 만드세요.
- PR 제목은 커밋 규약을 따릅니다 — `feat: [Issue 내용의 요약]`. 본문에 `Closes #$ARGUMENTS`를 넣어 Issue와 연결하세요.
- CI(Lint & Test)가 통과하는지 확인하세요.
- **머지는 하지 마세요.** 사용자가 직접 합니다.

### 6. 후처리 (정리)

- **PR이 실제로 올라갔는지 먼저 확인하세요.** 푸시되지 않은 커밋이 있는 Worktree를 지우면 작업이 사라집니다.
- 메인 디렉터리로 돌아가 `git worktree remove issue-$ARGUMENTS`로 작업 트리를 삭제하세요.
- 로컬 브랜치는 머지 전까지 남겨둡니다.
- 작업 결과를 보고하세요 — PR 번호, 선택한 서브에이전트와 그 이유, 검증 결과, 남은 위험.
