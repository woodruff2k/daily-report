import { describe, expect, it } from "vitest";
import {
  salesRepCreateSchema,
  salesRepStatusSchema,
  salesRepUpdateSchema,
} from "./sales-rep";

const VALID = {
  empNo: "S2026001",
  name: "홍길동",
  email: "hong@example.com",
  department: "영업1팀",
  position: "대리",
  managerId: 2,
  status: "ACTIVE",
};

describe("salesRepCreateSchema", () => {
  it("API 명세 6.2의 요청 예시를 통과시킨다", () => {
    expect(salesRepCreateSchema.safeParse(VALID).success).toBe(true);
  });

  it("선택 항목을 뺀 최소 요청도 통과시킨다", () => {
    const result = salesRepCreateSchema.safeParse({
      empNo: "S2026002",
      name: "김영업",
      email: "kim@example.com",
    });

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("ACTIVE");
  });

  it.each(["empNo", "name", "email"])("%s 가 없으면 거부한다", (field) => {
    const payload: Record<string, unknown> = { ...VALID };
    delete payload[field];

    expect(salesRepCreateSchema.safeParse(payload).success).toBe(false);
  });

  it("이메일 형식이 아니면 거부한다", () => {
    expect(
      salesRepCreateSchema.safeParse({ ...VALID, email: "abc" }).success,
    ).toBe(false);
  });

  it("이름이 100자를 넘으면 거부한다", () => {
    const payload = { ...VALID, name: "가".repeat(101) };

    expect(salesRepCreateSchema.safeParse(payload).success).toBe(false);
  });

  it("status 가 정의되지 않은 값이면 거부한다", () => {
    expect(
      salesRepCreateSchema.safeParse({ ...VALID, status: "DELETED" }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    "managerId 가 %s 이면 거부한다",
    (managerId) => {
      expect(
        salesRepCreateSchema.safeParse({ ...VALID, managerId }).success,
      ).toBe(false);
    },
  );

  it("앞뒤 공백을 제거한다", () => {
    const result = salesRepCreateSchema.safeParse({
      ...VALID,
      name: "  홍길동  ",
    });

    expect(result.data?.name).toBe("홍길동");
  });

  it("8자 미만 비밀번호는 거부한다", () => {
    expect(
      salesRepCreateSchema.safeParse({ ...VALID, password: "short" }).success,
    ).toBe(false);
  });
});

describe("salesRepUpdateSchema", () => {
  /** 수정은 role·status 를 필수로 받는다. 생성용 VALID 에는 role 이 없다. */
  const UPDATE_VALID = { ...VALID, role: "SALES_REP" };

  it("password 를 받지 않는다", () => {
    const result = salesRepUpdateSchema.safeParse({
      ...UPDATE_VALID,
      password: "longenough1",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("password");
  });

  it.each(["role", "status"])(
    "%s 는 필수다 — 기본값으로 메우지 않는다",
    (field) => {
      const payload: Record<string, unknown> = { ...UPDATE_VALID };
      delete payload[field];

      // 생성과 달리 기본값을 두지 않는다. PUT 은 전체 교체라 기본값이 적용되면
      // 보내지 않은 필드가 조용히 바뀐다.
      expect(salesRepUpdateSchema.safeParse(payload).success).toBe(false);
    },
  );
});

describe("salesRepStatusSchema", () => {
  it.each(["ACTIVE", "INACTIVE"])("%s 를 받는다", (status) => {
    expect(salesRepStatusSchema.safeParse({ status }).success).toBe(true);
  });

  it("그 외 값은 거부한다", () => {
    expect(salesRepStatusSchema.safeParse({ status: "DELETED" }).success).toBe(
      false,
    );
  });
});

describe("salesRepCreateSchema — role (#48)", () => {
  it("역할을 생략하면 SALES_REP 다", () => {
    expect(salesRepCreateSchema.safeParse(VALID).data?.role).toBe("SALES_REP");
  });

  it.each(["SALES_REP", "MANAGER", "ADMIN"])("%s 를 받는다", (role) => {
    expect(salesRepCreateSchema.safeParse({ ...VALID, role }).success).toBe(
      true,
    );
  });

  it.each(["SUPERUSER", "admin", ""])(
    "정의되지 않은 역할(%s)은 거부한다",
    (role) => {
      expect(salesRepCreateSchema.safeParse({ ...VALID, role }).success).toBe(
        false,
      );
    },
  );
});

describe("salesRepUpdateSchema — role (#48)", () => {
  it("수정에서도 역할을 받는다", () => {
    expect(
      salesRepUpdateSchema.safeParse({ ...VALID, role: "MANAGER" }).data?.role,
    ).toBe("MANAGER");
  });
});

// 이슈 #10·#75: 한 줄 필드의 제어문자
describe("salesRepCreateSchema 제어문자", () => {
  it.each([
    ["사번 NUL", { empNo: "S\u0000" }],
    ["이름 NUL", { name: "a\u0000b" }],
    ["이름 줄바꿈", { name: "a\nb" }],
    ["부서 탭", { department: "a\tb" }],
    ["직급 줄바꿈", { position: "a\nb" }],
  ])("%s 는 거부한다", (_name, patch) => {
    expect(salesRepCreateSchema.safeParse({ ...VALID, ...patch }).success).toBe(
      false,
    );
  });
});
