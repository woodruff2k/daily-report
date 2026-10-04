export default {
  // prettier 를 먼저 돌린다. eslint --fix 가 먼저 오면 포맷이 다시 어긋날 수
  // 있고, 두 도구가 같은 줄을 서로 고치면 결과가 실행 순서에 달린다.
  "**/*.{ts,tsx}": ["prettier --write", "eslint --fix", "eslint"],
  // 코드가 아닌 파일도 커밋 시점에 맞춘다. 마크다운은 .prettierignore 에서
  // 제외했으므로 여기 패턴에 걸려도 건너뛰어진다.
  "**/*.{css,json,mjs,yml,yaml}": ["prettier --write"],
};
