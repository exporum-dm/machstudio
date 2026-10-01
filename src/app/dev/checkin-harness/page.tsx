"use client";

/**
 * 현장 체크인 탭 검증용 하니스 — **개발 환경 전용**. /collect 는 로그인 뒤라 자동화로 못 연다.
 * CheckinTab 을 그대로 렌더하고 /api/collect-sources/x/checkin 만 메모리 가짜로 바꾼다. 프로덕션에서는 404.
 */
import { notFound } from "next/navigation";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import CheckinTab from "@/app/(app)/collect/[id]/CheckinTab";

if (process.env.NODE_ENV === "production") notFound();

const now = Date.now();
let state = {
  builder: true,
  enabled: false,
  timezone: "America/Los_Angeles",
  pinSet: false,
  url: "",
  slug: "",
  linkBase: "http://localhost:3000/checkin/",
  today: "2026-10-22",
  eventDates: ["2026-10-22", "2026-10-23", "2026-10-24"],
  byDay: [{ eventDate: "2026-10-22", scans: 1342, unique: 1187 }],
  recent: Array.from({ length: 6 }, (_, i) => ({
    id: `r${i}`,
    scannedAt: new Date(now - i * 47_000).toISOString(),
    method: ["camera", "scanner", "manual"][i % 3],
    staffLabel: i % 2 ? "입구 A" : "",
    registrationNo: `10097958396${80 + i}`,
    name: ["Jane Kim", "Minho Lee", "Alex Park", "Sara Choi", "Tom Han", "Mia Yoon"][i],
    visitorType: ["General", "Buyer", "Press"][i % 3],
  })),
};

if (typeof window !== "undefined" && !(window as unknown as { __ciStub?: boolean }).__ciStub) {
  (window as unknown as { __ciStub?: boolean }).__ciStub = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.includes("/api/collect-sources/x/checkin")) return real(input, init);
    await new Promise((r) => setTimeout(r, 120));
    if ((init?.method ?? "GET") === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.slug === "taken") {
        return new Response(JSON.stringify({ error: "이미 다른 사전등록이 쓰는 주소예요", field: "slug" }), { status: 409 });
      }
      if (body.slug) state = { ...state, slug: body.slug, url: `http://localhost:3000/checkin/${body.slug}` };
      if (body.enabled === true) {
        const slug = state.slug || "W0rG3-YdUSTQAkIhdDe8xREC";
        state = { ...state, enabled: true, slug, url: `http://localhost:3000/checkin/${slug}` };
      }
      if (body.enabled === false) state = { ...state, enabled: false };
      if (body.pin) state = { ...state, pinSet: true };
      if (body.timezone) state = { ...state, timezone: body.timezone };
    }
    return new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } });
  };
}

export default function CheckinHarness() {
  return (
    <ConfirmProvider>
      <div className="p-4 sm:p-6">
        <CheckinTab sourceId="x" canEdit />
      </div>
    </ConfirmProvider>
  );
}
