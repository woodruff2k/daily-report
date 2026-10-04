import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  getAccessToken,
  getStoredRep,
  replaceAccessToken,
  saveSession,
} from "./auth-storage";

const REP = { repId: 1, name: "홍길동", role: "SALES_REP" as const };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth-storage — #11", () => {
  it("세션을 저장하고 읽는다", () => {
    saveSession("token.value", REP);

    expect(getAccessToken()).toBe("token.value");
    expect(getStoredRep()).toEqual(REP);
  });

  it("저장된 것이 없으면 null 이다", () => {
    expect(getAccessToken()).toBeNull();
    expect(getStoredRep()).toBeNull();
  });

  it("토큰만 교체한다", () => {
    saveSession("old.token", REP);

    replaceAccessToken("new.token");

    // 비밀번호 변경 후 새 토큰으로 갈아끼운다. (#52)
    expect(getAccessToken()).toBe("new.token");
    expect(getStoredRep()).toEqual(REP);
  });

  it("세션을 지운다", () => {
    saveSession("token.value", REP);

    clearSession();

    expect(getAccessToken()).toBeNull();
    expect(getStoredRep()).toBeNull();
  });

  it("저장소 접근이 막혀도 던지지 않는다", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    // 시크릿 모드나 저장소 차단 환경에서 화면이 멈추면 안 된다.
    expect(getAccessToken()).toBeNull();
  });

  it("저장 실패도 던지지 않는다", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => saveSession("token.value", REP)).not.toThrow();
  });

  it("저장된 사용자 정보가 깨져 있으면 null 이다", () => {
    window.localStorage.setItem("daily-report.rep", "{not json");

    expect(getStoredRep()).toBeNull();
  });
});
