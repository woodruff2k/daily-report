import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/logout — TC-AUTH-05", () => {
  it("204 를 반환한다", () => {
    expect(POST().status).toBe(204);
  });

  it("본문이 없다", async () => {
    const response = POST();

    expect(response.body).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });
});
