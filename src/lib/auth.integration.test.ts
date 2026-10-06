// 통합 테스트(실제 PostgreSQL). 프록시를 거치지 않고 라우트 핸들러를 직접 부른다.
// 프록시가 우회돼 공격자가 헤더를 직접 넣을 수 있는 상황의 재현이다. (이슈 #102)
// 덮는 TC: TC-AUTH-04(토큰 없음 401), TC-SEC-03(관리자 전용 403)의 전제.
// 위조 헤더에 해당하는 TC 는 테스트 명세서에 **없다** — #102 수용 기준으로 추가했다.
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { GET as listSalesReps } from "@/app/api/sales-reps/route";
import { createRep } from "@/test/integration/factories";
import { call } from "@/test/integration/http";
import { TEST_JWT_SECRET } from "@/test/integration/test-database";

// ADMIN 전용 라우트다. 신원이 속으면 200, 제대로 가려내면 401·403 이다.
const PATH = "/api/sales-reps";
const FORGED = { "x-user-rep-id": "1", "x-user-role": "ADMIN" };

function claimsOf(rep: { repId: bigint; name: string; role: string }) {
  return {
    repId: rep.repId.toString(),
    name: rep.name,
    role: rep.role,
    mustChangePassword: false,
    tokenVersion: 0,
  };
}

describe("라우트의 인증 (실제 DB, 프록시 없음)", () => {
  it("위조 헤더만 있고 Authorization 이 없으면 401 이다", async () => {
    const result = await call(listSalesReps, "GET", PATH, { headers: FORGED });

    expect(result.status).toBe(401);
  });

  it("다른 비밀로 서명한 토큰은 401 이다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const token = jwt.sign(claimsOf(admin), "some-other-secret");

    const result = await call(listSalesReps, "GET", PATH, {
      authorization: `Bearer ${token}`,
    });

    expect(result.status).toBe(401);
  });

  it("만료된 토큰은 401 이다", async () => {
    const admin = await createRep({ role: "ADMIN" });
    const token = jwt.sign(claimsOf(admin), TEST_JWT_SECRET, {
      expiresIn: -10,
    });

    const result = await call(listSalesReps, "GET", PATH, {
      authorization: `Bearer ${token}`,
    });

    expect(result.status).toBe(401);
  });

  it("SALES_REP 토큰에 x-user-role: ADMIN 을 붙여도 토큰의 역할이 쓰여 403 이다", async () => {
    const rep = await createRep({ role: "SALES_REP" });

    const result = await call(listSalesReps, "GET", PATH, {
      as: rep,
      headers: FORGED,
    });

    expect(result.status).toBe(403);
  });

  it("ADMIN 토큰은 200 이다 (대조군)", async () => {
    const admin = await createRep({ role: "ADMIN" });

    const result = await call(listSalesReps, "GET", PATH, { as: admin });

    expect(result.status).toBe(200);
  });
});
