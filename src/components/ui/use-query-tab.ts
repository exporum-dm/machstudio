"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function tabUrl(pathname: string, query: string, key: string, value: string) {
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${pathname}?${params.toString()}`;
}

/** 주소가 선택 상태의 단일 소스다. 다른 필터·중첩 탭은 그대로 보존한다. */
export function useQueryTab<T extends string>(values: readonly T[], fallback: T, key = "tab") {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get(key);
  const value = values.includes(requested as T) ? requested as T : fallback;
  const select = (next: T) => {
    if (next === value) return;
    router.push(tabUrl(pathname, params.toString(), key, next), { scroll: false });
  };
  return [value, select] as const;
}

/** 검색 입력은 라우트 재조회 없이 주소에 반영한다(Next의 native history 연동). */
export function useQueryText(key = "q") {
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(key) ?? "";
  const setValue = (next: string) => window.history.replaceState(null, "", tabUrl(pathname, params.toString(), key, next));
  return [value, setValue] as const;
}
