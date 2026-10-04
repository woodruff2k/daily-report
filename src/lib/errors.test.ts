import { describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, HttpError } from "./errors";

describe("HttpError", () => {
  it("code·message·status를 담는다", () => {
    const error = new HttpError("TEAPOT", "찻주전자입니다.", 418);

    expect(error.code).toBe("TEAPOT");
    expect(error.message).toBe("찻주전자입니다.");
    expect(error.status).toBe(418);
  });

  it("Error를 상속하므로 스택트레이스를 가진다", () => {
    const error = new HttpError("TEAPOT", "찻주전자입니다.", 418);

    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeDefined();
  });
});

describe("AuthorizationError", () => {
  it("HttpError로도 잡힌다", () => {
    const error = new AuthorizationError("FORBIDDEN", "권한이 없습니다.", 403);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toBeInstanceOf(AuthorizationError);
  });

  it("name이 클래스 이름으로 설정된다", () => {
    expect(
      new AuthorizationError("FORBIDDEN", "권한이 없습니다.", 403).name,
    ).toBe("AuthorizationError");
  });

  it("상태 충돌과 구분된다", () => {
    const error = new AuthorizationError("FORBIDDEN", "권한이 없습니다.", 403);

    expect(error).not.toBeInstanceOf(ConflictError);
  });
});

describe("ConflictError", () => {
  it("상태는 항상 409다", () => {
    expect(
      new ConflictError("REPORT_LOCKED", "제출된 보고는 수정할 수 없습니다.")
        .status,
    ).toBe(409);
  });

  it("HttpError로도 잡히지만 인가 실패와는 구분된다", () => {
    const error = new ConflictError(
      "REPORT_LOCKED",
      "제출된 보고는 수정할 수 없습니다.",
    );

    expect(error).toBeInstanceOf(HttpError);
    expect(error).not.toBeInstanceOf(AuthorizationError);
  });

  it("name이 클래스 이름으로 설정된다", () => {
    expect(new ConflictError("REPORT_LOCKED", "잠김").name).toBe(
      "ConflictError",
    );
  });
});
