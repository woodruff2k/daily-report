// 통합 테스트(실제 PostgreSQL, 실제 bcrypt 해시 비교).
// 덮는 TC: TC-AUTH-01, TC-AUTH-02, TC-AUTH-03, TC-SEC-06(응답에 해시·이메일 미포함)
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { POST } from "./route";
import { TEST_PASSWORD, createRep } from "@/test/integration/factories";
import { call } from "@/test/integration/http";

const login = (loginId: string, password: string) =>
  call(POST, "POST", "/api/auth/login", { body: { loginId, password } });

describe("POST /api/auth/login (실제 DB)", () => {
  it("TC-AUTH-01: 사번과 올바른 비밀번호로 로그인하면 200 과 토큰을 발급한다", async () => {
    const rep = await createRep({ role: "MANAGER" });

    const result = await login(rep.empNo, TEST_PASSWORD);

    expect(result.status).toBe(200);
    expect(result.body.data.rep).toEqual({
      repId: Number(rep.repId),
      name: rep.name,
      role: "MANAGER",
    });
    const claims = jwt.decode(result.body.data.accessToken) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      repId: rep.repId.toString(),
      role: "MANAGER",
      tokenVersion: 0,
    });
  });

  it("TC-AUTH-01: 이메일로도 로그인할 수 있다", async () => {
    const rep = await createRep();

    const result = await login(rep.email, TEST_PASSWORD);

    expect(result.status).toBe(200);
  });

  it("TC-AUTH-02: 비밀번호가 틀리면 401 이고 토큰이 없다", async () => {
    const rep = await createRep();

    const result = await login(rep.empNo, "wrong-password-0000");

    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe("UNAUTHORIZED");
    expect(result.body.data).toBeNull();
  });

  it("TC-AUTH-02: 없는 계정은 비밀번호 오류와 같은 응답이다(계정 존재 여부 비노출)", async () => {
    const rep = await createRep();

    const wrongPassword = await login(rep.empNo, "wrong-password-0000");
    const unknownAccount = await login("T9999", TEST_PASSWORD);

    expect(unknownAccount.status).toBe(401);
    expect(unknownAccount.body).toEqual(wrongPassword.body);
  });

  it("TC-AUTH-03: 비활성 계정은 올바른 비밀번호여도 401 이고 토큰이 없다", async () => {
    const rep = await createRep({ status: "INACTIVE" });

    const result = await login(rep.empNo, TEST_PASSWORD);

    expect(result.status).toBe(401);
    expect(result.body.data).toBeNull();
    expect(result.raw).not.toContain("accessToken");
  });

  it("TC-SEC-06: 성공 응답에 해시·이메일·사번이 실리지 않는다", async () => {
    const rep = await createRep();

    const result = await login(rep.empNo, TEST_PASSWORD);

    expect(result.raw).not.toContain(rep.passwordHash);
    expect(result.raw).not.toContain(rep.email);
    expect(result.raw).not.toContain(rep.empNo);
  });
});
