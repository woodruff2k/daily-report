/**
 * 브라우저의 토큰 보관. (이슈 #11)
 *
 * `localStorage` 에 둔다. API 명세 1.1 이 `Authorization: Bearer` 를 못박고
 * 프록시도 그 헤더만 읽으므로(`src/proxy.ts`), 브라우저가 매 요청에 헤더를
 * 붙일 수 있어야 한다. httpOnly 쿠키로 바꾸려면 프록시가 쿠키를 읽도록
 * 서버를 함께 고쳐야 한다.
 *
 * **대가: XSS 가 생기면 토큰이 읽힌다.** 지금은 사용자 입력을 HTML 로
 * 렌더링하는 지점이 없어 노출면이 좁다. 쿠키 전환은 후속 과제로 남긴다.
 */

const TOKEN_KEY = "daily-report.accessToken";

/** 서버가 내려준 로그인 사용자 정보. 화면 표시용이며 권한 판정에 쓰지 않는다. */
export interface StoredRep {
  repId: number;
  name: string;
  role: "SALES_REP" | "MANAGER" | "ADMIN";
}

const REP_KEY = "daily-report.rep";

/**
 * `localStorage` 접근을 감싼다.
 *
 * 서버 렌더링 중에는 `window` 가 없고, 브라우저에서도 저장소가 막혀 있으면
 * 접근 자체가 던진다. 토큰이 없는 것과 읽을 수 없는 것을 같게 다룬다.
 */
function readItem(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 저장에 실패하면 이 세션에서만 로그인이 유지되지 않는다. 화면을 멈추지 않는다.
  }
}

function removeItem(key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 지우지 못해도 서버가 토큰을 무효화하므로(#52) 재사용되지 않는다.
  }
}

export function getAccessToken(): string | null {
  return readItem(TOKEN_KEY);
}

export function getStoredRep(): StoredRep | null {
  const raw = readItem(REP_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredRep;
  } catch {
    return null;
  }
}

export function saveSession(accessToken: string, rep: StoredRep): void {
  writeItem(TOKEN_KEY, accessToken);
  writeItem(REP_KEY, JSON.stringify(rep));
}

/** 비밀번호 변경 등으로 토큰만 갈릴 때 쓴다. (#52) */
export function replaceAccessToken(accessToken: string): void {
  writeItem(TOKEN_KEY, accessToken);
}

export function clearSession(): void {
  removeItem(TOKEN_KEY);
  removeItem(REP_KEY);
}
