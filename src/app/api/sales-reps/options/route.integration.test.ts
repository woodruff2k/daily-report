// 통합 테스트(실제 PostgreSQL). 영업 Select 옵션(API 명세 6.6).
// 덮는 항목: 역할 무관 200, 401, INACTIVE 제외, name asc, 최소 필드(NFR-04).
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { GET as GET_LIST } from "../route";
import { createRep } from "@/test/integration/factories";
import { call } from "@/test/integration/http";

const PATH = "/api/sales-reps/options";

describe("GET /api/sales-reps/options (실제 DB)", () => {
  it.each(["SALES_REP", "MANAGER", "ADMIN"] as const)(
    "%s 는 200 이고 본인을 포함한 활성 사원을 받는다",
    async (role) => {
      const caller = await createRep({ role });

      const result = await call(GET, "GET", PATH, { as: caller });

      expect(result.status).toBe(200);
      expect(result.body.data).toContainEqual({
        repId: Number(caller.repId),
        name: caller.name,
      });
    },
  );

  it("인증 헤더가 없으면 401 이다", async () => {
    expect((await call(GET, "GET", PATH)).status).toBe(401);
  });

  it("INACTIVE 사원은 빠진다", async () => {
    const caller = await createRep();
    const inactive = await createRep({ status: "INACTIVE" });

    const result = await call(GET, "GET", PATH, { as: caller });

    const ids = result.body.data.map((o: { repId: number }) => o.repId);
    expect(ids).toContain(Number(caller.repId));
    expect(ids).not.toContain(Number(inactive.repId));
  });

  it("이름 오름차순이다", async () => {
    const caller = await createRep({ name: "테스트정렬다" });
    await createRep({ name: "테스트정렬가" });
    await createRep({ name: "테스트정렬나" });

    const result = await call(GET, "GET", PATH, { as: caller });

    const names: string[] = result.body.data.map(
      (o: { name: string }) => o.name,
    );
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ko")));
    expect(names.indexOf("테스트정렬가")).toBeLessThan(
      names.indexOf("테스트정렬나"),
    );
    expect(names.indexOf("테스트정렬나")).toBeLessThan(
      names.indexOf("테스트정렬다"),
    );
  });

  it("응답에 이메일·사번·역할·해시가 없고 항목은 repId·name 뿐이다", async () => {
    const caller = await createRep({
      role: "MANAGER",
      email: "test-leak@example.com",
      empNo: "T9999",
    });

    const result = await call(GET, "GET", PATH, { as: caller });

    expect(result.raw).not.toContain("test-leak@example.com");
    expect(result.raw).not.toContain("T9999");
    expect(result.raw).not.toContain("$2");
    for (const option of result.body.data) {
      expect(Object.keys(option).sort()).toEqual(["name", "repId"]);
    }
  });

  it("6.1 목록은 여전히 SALES_REP 에게 403 이다 (권한을 넓히지 않았다)", async () => {
    const caller = await createRep();

    const result = await call(GET_LIST, "GET", "/api/sales-reps", {
      as: caller,
    });

    expect(result.status).toBe(403);
  });
});
