"use client";

/**
 * 만족도 조사 탭 하니스 — 개발 환경 전용(프로덕션 404).
 * 로그인 없이 SurveyTab(설계·배포·결과)을 띄운다. 어드민 API 는 가로채고, 설정은 공개 API(/api/q/kela2026)에서 빌려 온다.
 */
import { notFound } from "next/navigation";
import SurveyTab from "@/app/(app)/collect/[id]/SurveyTab";
import { normalizeSurveyConfig, summarizeSurvey } from "@/lib/survey-config";

if (typeof window !== "undefined" && !(window as { __sv?: boolean }).__sv) {
  (window as { __sv?: boolean }).__sv = true;
  const orig = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  let saved: unknown = null;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/api/collect-sources/src/surveys") return json({ surveys: [{ id: "s1", name: "Korea Expo LA 2026 참관객 만족도 조사", token: "kela2026", status: "open", responses: 3 }] });
    if (url.pathname === "/api/surveys/s1") {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (body.config) saved = body.config;
        return json({ survey: { id: "s1", name: "Korea Expo LA 2026 참관객 만족도 조사", token: "kela2026", status: body.status ?? "open", config: saved } });
      }
      const pub = await (await orig("/api/q/kela2026")).json();
      saved = saved ?? normalizeSurveyConfig(pub.config);
      return json({ survey: { id: "s1", name: "Korea Expo LA 2026 참관객 만족도 조사", token: "kela2026", status: "open", config: saved } });
    }
    if (url.pathname === "/api/surveys/s1/results") {
      const config = normalizeSurveyConfig(saved);
      const responses = [
        { audience: "General", answers: { overall_satisfaction: 5, nps: 10, watched_stage: "Yes", stage_satisfaction: 5, visit_days: ["Sat, Oct 24 (K-Pop Day)"], nps_reason: "Loved the K-Pop finals!" } },
        { audience: "General", answers: { overall_satisfaction: 4, nps: 8, watched_stage: "No", visit_days: ["Thu, Oct 22 (K-Beauty Day)"] } },
        { audience: "Buyer", answers: { overall_satisfaction: 3, nps: 6, order_likelihood: 4, watched_stage: "No" } },
      ];
      return json({
        total: 3, registered: 3,
        byAudience: [{ value: "General", count: 2 }, { value: "Buyer", count: 1 }],
        byChannel: [{ value: "qr", count: 2 }, { value: "newsletter", count: 1 }],
        summaries: summarizeSurvey(config, responses),
        segmentable: [{ key: "visitor_type", label: "Visitor type" }, { key: "age", label: "Age group" }],
        by: url.searchParams.get("by") || "visitor_type",
        scoreQuestions: [{ key: "overall_satisfaction", type: "scale", title: "Overall" }, { key: "nps", type: "nps", title: "NPS" }],
        segments: [
          { value: "General", count: 2, scores: [{ key: "overall_satisfaction", average: 4.5, nps: null }, { key: "nps", average: 9, nps: 50 }] },
          { value: "Buyer", count: 1, scores: [{ key: "overall_satisfaction", average: 3, nps: null }, { key: "nps", average: 6, nps: -100 }] },
        ],
        lastAt: new Date().toISOString(),
      });
    }
    return orig(input, init);
  };
}

export default function SurveyHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  return <div className="p-4 sm:p-6"><SurveyTab sourceId="src" /></div>;
}
