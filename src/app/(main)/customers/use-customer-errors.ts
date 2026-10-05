"use client";

import { customerErrorMessage } from "@/lib/client/customer-api";
import { useApiErrors } from "@/lib/client/use-api-errors";

/**
 * 고객 화면의 가드·오류 처리. 동작은 공용 `useApiErrors` 에 있고 여기서는
 * 고객 도메인 문장만 연결한다. (이슈 #16, 공용화 #12)
 */
export function useCustomerErrors() {
  return useApiErrors(customerErrorMessage);
}
