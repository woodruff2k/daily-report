import { describe, expect, it } from "vitest";
import {
  customerCreateSchema,
  customerStatusSchemaBody,
  customerUpdateSchema,
} from "./customer";
import { CUSTOMER_BODY } from "@/test/customer-fixtures";

describe("customerCreateSchema", () => {
  it("필수 항목만으로 통과하고 status 는 ACTIVE 가 기본이다", () => {
    const result = customerCreateSchema.parse({
      customerName: "테스트고객",
      assignedRepId: 1,
    });

    expect(result.status).toBe("ACTIVE");
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
  });

  it("assignedRepId 가 없으면 거부한다", () => {
    const rest = { ...CUSTOMER_BODY, assignedRepId: undefined };
    expect(customerCreateSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ["이메일 형식 오류", { email: "abc" }],
    ["전화 형식 오류", { phone: "전화번호" }],
    ["고객명 공백", { customerName: "   " }],
    ["고객명 과대 길이", { customerName: "a".repeat(101) }],
    ["안전 정수 초과 식별자", { assignedRepId: 2 ** 53 }],
    ["0 식별자", { assignedRepId: 0 }],
    ["문자열 식별자", { assignedRepId: "1" }],
    ["잘못된 status", { status: "DELETED" }],
  ])("%s 는 거부한다", (_name, override) => {
    expect(
      customerCreateSchema.safeParse({ ...CUSTOMER_BODY, ...override }).success,
    ).toBe(false);
  });

  it("빈 문자열·공백 선택 항목은 null 로 정규화한다", () => {
    const result = customerCreateSchema.parse({
      ...CUSTOMER_BODY,
      email: "",
      companyName: "  ",
      grade: null,
    });

    expect(result.email).toBeNull();
    expect(result.companyName).toBeNull();
    expect(result.grade).toBeNull();
  });
});

describe("customerUpdateSchema", () => {
  it("status 를 생략하면 거부한다 (전체 교체)", () => {
    const rest = { ...CUSTOMER_BODY, status: undefined };
    expect(customerUpdateSchema.safeParse(rest).success).toBe(false);
  });
});

describe("customerStatusSchemaBody", () => {
  it("ACTIVE·INACTIVE 만 받는다", () => {
    expect(
      customerStatusSchemaBody.safeParse({ status: "INACTIVE" }).success,
    ).toBe(true);
    expect(customerStatusSchemaBody.safeParse({ status: "X" }).success).toBe(
      false,
    );
    expect(customerStatusSchemaBody.safeParse({}).success).toBe(false);
  });
});

// 이슈 #10·#75: 제어문자와 주소 상한
describe("customerCreateSchema 제어문자·주소 상한", () => {
  const base = { customerName: "테스트고객", assignedRepId: 1 };

  it("주소는 500자까지 허용하고 501자는 거부한다", () => {
    expect(
      customerCreateSchema.safeParse({ ...base, address: "a".repeat(500) })
        .success,
    ).toBe(true);
    expect(
      customerCreateSchema.safeParse({ ...base, address: "a".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("주소는 여러 줄을 허용한다 (회귀)", () => {
    expect(
      customerCreateSchema.parse({ ...base, address: "서울\n3층\t301호" })
        .address,
    ).toBe("서울\n3층\t301호");
  });

  it.each([
    ["고객명 NUL", { customerName: "a\u0000b" }],
    ["고객명 줄바꿈", { customerName: "a\nb" }],
    ["회사명 탭", { companyName: "a\tb" }],
    ["등급 줄바꿈", { grade: "A\nB" }],
    ["주소 NUL", { address: "a\u0000b" }],
  ])("%s 는 거부한다", (_name, patch) => {
    expect(customerCreateSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
  });
});
