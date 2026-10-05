/** 보고 목록의 날짜 계산·표시. 라이브러리 없이 로컬 시간 기준. (이슈 #12) */

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** 로컬 날짜를 `YYYY-MM-DD` 로. `toISOString` 은 UTC 라 한국 새벽에 하루 어긋난다. */
export function formatDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` 의 다음 날. 로컬 날짜 기준이며 월말·연말을 넘긴다. */
export function nextDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return formatDate(new Date(year, month - 1, day + 1));
}

/** 기본 기간: 오늘로부터 한 달 전 ~ 오늘. */
export function defaultRange(now: Date = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  // 3/31 의 한 달 전은 2/31 → 3/3 로 넘어간다. 말일로 맞춘다.
  if (from.getDate() !== now.getDate()) {
    from.setDate(0);
  }
  return { from: formatDate(from), to: formatDate(now) };
}

/**
 * 최종수정 표시. 오늘이면 `HH:mm`, 아니면 `MM-DD HH:mm`.
 *
 * 명세(SCR-200)는 `HH:mm` 만 적었지만, 지난주에 고친 보고가 `17:40` 으로만 보이면
 * 오늘 고친 것으로 오해한다. 그래서 오늘이 아니면 날짜를 붙인다. (이슈 #12)
 */
export function formatUpdatedAt(iso: string, now: Date = new Date()) {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (formatDate(date) === formatDate(now)) {
    return time;
  }
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  // 해가 다르면 연도까지 붙인다. 기간 필터에 상한이 없어 작년 보고도 조회되는데,
  // MM-DD 만 보이면 작년 9-28 과 올해 9-28 이 똑같이 읽힌다 — 이 형식이 막으려던
  // 오해와 같은 종류다.
  if (date.getFullYear() !== now.getFullYear()) {
    return `${date.getFullYear()}-${monthDay} ${time}`;
  }
  return `${monthDay} ${time}`;
}
