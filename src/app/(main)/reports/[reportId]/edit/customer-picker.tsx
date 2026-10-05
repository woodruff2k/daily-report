"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listCustomers,
  type CustomerListItem,
} from "@/lib/client/customer-api";
import type { CustomerRef } from "@/lib/client/report-form";

const DEBOUNCE_MS = 300;
const RESULT_SIZE = 20;

interface Props {
  /** 접근 가능한 이름의 일부. "방문 1행 고객" 처럼 행을 구분하게 넘긴다. */
  label: string;
  value: CustomerRef | null;
  onChange: (next: CustomerRef | null) => void;
  /** 검색 실패를 문장으로. 401 처리도 이 함수가 한다(`useApiErrors`). */
  toMessage: (caught: unknown, fallback: string) => string;
}

interface SearchResult {
  keyword: string;
  items: CustomerListItem[];
  error: string | null;
}

/**
 * 고객 검색 선택. (SCR-210 세 섹션 공용)
 *
 * `GET /api/customers?keyword=` 는 전사 조회라 담당이 아닌 고객도 찾는다.
 * 검색어를 디바운스한 뒤 활성 고객만 버튼 목록으로 보여주고, 고르면 이름을
 * 보여준다. 선택은 지울 수 있다(과제·계획은 고객이 선택이다).
 * 서버가 customerId 를 다시 검증하므로 이 선택은 사용성일 뿐이다.
 */
export function CustomerPicker({ label, value, onChange, toMessage }: Props) {
  const [keyword, setKeyword] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const trimmed = keyword.trim();

  // 효과 본문에서 동기 setState 를 하지 않는다. 타이머 콜백 안에서만 바꾼다.
  useEffect(() => {
    if (trimmed === "") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await listCustomers({
            keyword: trimmed,
            status: "ACTIVE",
            size: RESULT_SIZE,
          });
          if (!cancelled)
            setResult({ keyword: trimmed, items: page.content, error: null });
        } catch (caught) {
          if (!cancelled)
            setResult({
              keyword: trimmed,
              items: [],
              error: toMessage(caught, "고객을 검색할 수 없습니다."),
            });
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, toMessage]);

  if (value !== null) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{value.customerName ?? `고객 #${value.customerId}`}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${label} 선택 해제`}
          onClick={() => onChange(null)}
        >
          해제
        </Button>
      </div>
    );
  }

  // 검색어가 바뀐 뒤 아직 응답이 없으면 묵은 결과를 보여주지 않는다.
  const current = result !== null && result.keyword === trimmed ? result : null;

  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={`${label} 검색`}
        placeholder="고객 검색"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      {trimmed === "" ? null : current === null ? (
        <p className="text-xs text-muted-foreground">검색 중…</p>
      ) : current.error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {current.error}
        </p>
      ) : current.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">검색 결과가 없습니다.</p>
      ) : (
        <ul aria-label={`${label} 검색 결과`} className="flex flex-col gap-1">
          {current.items.map((item) => (
            <li key={item.customerId}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  onChange({
                    customerId: item.customerId,
                    customerName: item.customerName,
                  });
                  setKeyword("");
                  setResult(null);
                }}
              >
                {item.companyName
                  ? `${item.customerName} (${item.companyName})`
                  : item.customerName}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
