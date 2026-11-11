"use client";

/**
 * 지인 초대(추천) 하니스 — 개발 전용. 실제 등록 폼 런타임(mountCollectForm)을 모의 제출로 태워
 * 완료 화면의 초대 카드(공유하기·링크 복사·추천 순위 보기)를 본다. DB 에 아무것도 쓰지 않는다.
 * 주소에 ?ref=K7mQ2xPa3d 를 붙여 열면 제출 본문에 _ref 가 실리는지도 확인할 수 있다(window.__lastSubmit).
 */
import { useEffect, useRef } from "react";
import { notFound } from "next/navigation";
import { mountCollectForm } from "@/lib/collect-form/mount";
import { normalizeCollectForm } from "@/lib/collect-form-config";

const CONFIG = normalizeCollectForm({
  defaultLocale: "ko",
  legal: { eventName: "Korea Expo Tokyo 2027" },
  fields: [
    { id: "n", key: "name", label: { ko: "이름" }, type: "text", required: true, enabled: true },
    { id: "e", key: "email", label: { ko: "이메일" }, type: "email", required: true, enabled: true },
    { id: "p", key: "phone", label: { ko: "연락처" }, type: "tel", required: false, enabled: true },
  ],
  consent: { privacy: { enabled: false } },
  referral: { enabled: true, rewardMode: "topN", rewardValue: 10 },
});

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/collect/") && url.endsWith("/submit")) {
      (window as unknown as { __lastSubmit: unknown }).__lastSubmit = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(Response.json({ ok: true, registrationNo: "1234567890128", rid: "rec_harness", shareCode: "Hq7mN2xPa3" }, { status: 201 }));
    }
    return real(input, init);
  };
}

export default function ReferralHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const handle = mountCollectForm({ mount: host.current, config: CONFIG, origin: window.location.origin, sourceId: "harness" });
    return () => handle.destroy?.();
  }, []);
  return (
    <div style={{ maxWidth: 520, margin: "32px auto", padding: "0 16px" }}>
      <div ref={host} />
    </div>
  );
}
