#!/bin/bash
# PostToolUse 에서 편집된 파일을 포맷한다. (Edit/Write/MultiEdit)
#
# 경로는 stdin 으로 들어오는 JSON 의 .tool_input.file_path 에 있다.
# 이전 버전은 $CLAUDE_FILE_PATHS 를 읽었는데 현재 Claude Code 는 그 변수를
# 설정하지 않는다. 변수가 비면 조건이 거짓이 되어 아무 일도 하지 않았고,
# 끝의 `|| true` 가 실패를 삼켜 그 사실조차 드러나지 않았다.
#
# 등록: .claude/settings.local.json 의 PostToolUse(matcher: Edit|Write|MultiEdit)
#
#   "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-edit.sh\""

set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "format-on-edit: jq 가 필요합니다" >&2
  exit 1
fi

# stdin 은 한 번만 읽힌다. 변수에 담아 쓴다.
file=$(jq -r '.tool_input.file_path // empty')

# 경로가 없는 도구 호출(그 외 matcher 가 섞인 경우)은 조용히 넘긴다.
[ -n "$file" ] || exit 0

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

# 프로젝트 밖 파일은 건드리지 않는다. eslint 가 "File ignored because outside
# of base path" 경고를 내고, 다른 저장소 파일에 이 저장소 설정을 적용하게 된다.
root=${CLAUDE_PROJECT_DIR:-$PWD}
case "$file" in
  "$root"/*) ;;
  *) exit 0 ;;
esac

status=0

# 경로를 인용한다. src/app/(auth)/login/page.tsx 처럼 괄호가 든 경로가 있고,
# 공백이 든 경로도 깨지지 않아야 한다.
if ! npx prettier --write "$file" >/dev/null; then
  echo "format-on-edit: prettier 실패 — $file" >&2
  status=1
fi

# eslint 종료코드: 0 문제 없음 / 1 린트 문제 남음 / 2 치명적 오류.
#
# 1 은 훅의 실패가 아니다. --fix 로 고칠 수 없는 린트 문제가 남은 것이고,
# 그 내용은 eslint 가 이미 출력했다. 2 만 훅 실패로 올린다.
npx eslint --fix "$file"
eslint_status=$?

if [ "$eslint_status" -ge 2 ]; then
  echo "format-on-edit: eslint 실행 실패 — $file" >&2
  status=1
fi

exit "$status"
