"use client";

/**
 * 결과 분석 탭 하니스 — 개발 환경 전용(프로덕션 404).
 * 로그인 없이 AnalysisTab 을 띄운다. 분석 API 를 가로채, LA 2026 모양의 가짜 등록·입장 데이터를
 * 진짜 계산 함수(buildRegistrationAnalysis)에 넣어 돌려준다 — 개인정보 없이 화면·차트를 검증한다.
 */
import { notFound } from "next/navigation";
import AnalysisTab from "@/app/(app)/collect/[id]/AnalysisTab";
import { audienceInsights, buildRegistrationAnalysis, summarizeAudiences, type AnalysisCheckIn, type AnalysisInput, type AnalysisRecord } from "@/lib/registration-analysis";

function fixture() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(xs: T[], w?: number[]) => {
    if (!w) return xs[Math.floor(rnd() * xs.length)];
    let t = rnd() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < xs.length; i++) if ((t -= w[i]) <= 0) return xs[i];
    return xs[xs.length - 1];
  };
  const records: AnalysisRecord[] = [];
  const checkIns: AnalysisCheckIn[] = [];
  const days = ["2026-10-22", "2026-10-23", "2026-10-24"];
  for (let i = 0; i < 3000; i++) {
    const onsite = rnd() < 0.07;
    // 사전: 9/1~10/21, 뒤로 갈수록 많이. 현장: 행사일 08~17시(PT = UTC-7)
    const createdAt = onsite
      ? new Date(`${pick(days)}T${String(15 + Math.floor(rnd() * 9)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`)
      : new Date(Date.parse("2026-10-21T21:00:00Z") - Math.pow(rnd(), 1.6) * 50 * 86_400_000);
    const lead = (Date.parse("2026-10-22T07:00:00Z") - createdAt.getTime()) / 86_400_000;
    const type = pick(["General", "Buyer", "Press"], [94, 4, 2]);
    const plan = [pick(days, [3, 2, 4])];
    records.push({
      id: `r${i}`,
      registrationNo: String(1e12 + i),
      createdAt,
      utmSource: pick(["meta", "", "ambassador", "instagram", "google", "facebook"], [40, 20, 17, 10, 7, 2]) || null,
      data: {
        gender: pick(["Female", "Male", "Other"], [78, 21, 1]),
        age: pick(["16~24", "25~34", "35~44", "45~54", "55~64", "Aged 65 and older"], [13, 32, 26, 17, 8, 4]),
        visitor_type: type,
        general_company_name: pick(["None", "Student", "Amazon", "student", "Self-employed", "UCLA", "", "Kaiser Permanente"], [30, 10, 3, 4, 6, 3, 30, 2]),
        ...(type === "Buyer" ? { buyer_company_type: pick(["Importer", "Distributor", "Retail", "E-commerce"]), buyer_job_title: pick(["Owner", "CEO", "owner", "Manager", "Buyer"]) } : {}),
        interest: ["K-Beauty", "K-Food", "K-Lifestyle", "K-Content"].filter(() => rnd() < 0.5),
        hearing: pick(["Social Media", "Recommendation from friends / colleagues", "Online Ads", "Others"], [76, 13, 5, 6]),
        companions: pick(["0", "", "1", "2", "3", "None", "14"], [50, 33, 9, 5, 1.5, 1, 0.05]),
        visit_date: plan,
        address: pick(["Los Angeles", "USA, Los Angeles", "Irvine, CA", "Long Beach", "Anaheim"], [60, 20, 7, 8, 5]),
      },
    });
    const p = onsite ? 0.76 : lead < 2 ? 0.41 : lead < 8 ? 0.34 : lead < 15 ? 0.24 : 0.19;
    if (rnd() < p) {
      const day = onsite ? createdAt.toISOString().slice(0, 10) : rnd() < 0.9 ? plan[0] : pick(days);
      const h = 16 + Math.floor(Math.pow(rnd(), 1.5) * 7);
      const at = new Date(`${day}T${h}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`);
      checkIns.push({ recordId: `r${i}`, eventDate: day, scannedAt: at });
      if (rnd() < 0.08) checkIns.push({ recordId: `r${i}`, eventDate: day, scannedAt: new Date(at.getTime() + 3_600_000) });
      if (rnd() < 0.03) { const d2 = days[(days.indexOf(day) + 1) % 3]; checkIns.push({ recordId: `r${i}`, eventDate: d2, scannedAt: new Date(`${d2}T18:00:00Z`) }); }
    }
  }
  const common: AnalysisInput["fields"] = [
      { key: "gender", label: "Gender", kind: "single", options: ["Male", "Female", "Other"] },
      { key: "age", label: "Age group", kind: "single", options: ["16~24", "25~34", "35~44", "45~54", "55~64", "Aged 65 and older"] },
      { key: "hearing", label: "How did you hear about this event", kind: "single", options: [] },
      { key: "interest", label: "Fields of interest", kind: "multi", options: ["K-Beauty", "K-Content", "K-Food", "K-Lifestyle"] },
      { key: "visitor_type", label: "Visitor type", kind: "single", options: ["General", "Buyer", "Press"] },
  ];
  const base = { timezone: "America/Los_Angeles", eventDates: days, companionKey: "companions", visitDateKey: "visit_date", regionKey: "address", textFields: [{ key: "general_company_name", label: "Company name" }] };
  const analysis = buildRegistrationAnalysis({ ...base, fields: common, records, checkIns });
  const audiences = ["General", "Buyer", "Press"].map((value) => {
    const recs = records.filter((r) => r.data.visitor_type === value);
    const ids = new Set(recs.map((r) => r.id));
    const extra: AnalysisInput["fields"] = value === "Buyer" ? [{ key: "buyer_company_type", label: "Company type", kind: "single", options: ["Importer", "Distributor", "Retail", "E-commerce"] }] : [];
    return { value, analysis: buildRegistrationAnalysis({ ...base, fields: [...common.filter((x) => x.key !== "visitor_type"), ...extra], textFields: value === "Buyer" ? [{ key: "buyer_job_title", label: "Job title" }] : base.textFields, records: recs, checkIns: checkIns.filter((c) => ids.has(c.recordId)) }) };
  });
  const audienceRows = summarizeAudiences(audiences);
  analysis.insights.splice(2, 0, ...audienceInsights(audienceRows, "Visitor type"));
  return { analysis, audiences, audienceRows };
}

if (typeof window !== "undefined" && !(window as { __an?: boolean }).__an) {
  (window as { __an?: boolean }).__an = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/api/collect-sources/src/analysis") {
      const empty = new URLSearchParams(location.search).has("empty");
      const { analysis, audiences, audienceRows } = fixture();
      if (empty) analysis.kpi.visitors.unique = 0;
      return new Response(
        JSON.stringify({ sourceName: "2026 Korea Expo LA (하니스)", generatedAt: new Date().toISOString(), fields: { companionKey: "companions", visitDateKey: "visit_date", regionKey: "address", audienceKey: "visitor_type" }, hours: { open: 10, close: 17 }, analysis, audiences, audienceRows }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return orig(input, init);
  };
}

export default function AnalysisHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <AnalysisTab sourceId="src" />
    </div>
  );
}
