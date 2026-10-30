"use client";

/**
 * 등록자 명단 하니스 — **개발 환경 전용**(프로덕션 404).
 *
 * 명단은 로그인 + 워크스페이스 멤버십 뒤에 있고, 문의·설문 응답은 실제 라이브를 거쳐야
 * 쌓인다. 그래서 RegistrantsTab **본체를 그대로** 태우고 목록 API 만 가로챈다 —
 * 확인 대상(문의 열이 언제 나타나는가 · 상세 패널의 문의 섹션 · 미연결 안내)이
 * 전부 이 컴포넌트 안의 판단이라 이 경계로 충분하다.
 *
 * fetch 패치를 렌더 본문에서 하는 이유: RegistrantsTab 은 자기 effect 에서 목록을 부르고,
 * 부모 렌더는 자식 effect 보다 먼저 돈다. useEffect 로 패치하면 첫 요청을 놓친다.
 */

import { useRef } from "react";
import { notFound } from "next/navigation";
import RegistrantsTab from "@/app/(app)/webinar/[slug]/RegistrantsTab";
// 삭제 확인이 useConfirm 을 쓰므로 프로바이더가 필요하다 — 앱 셸이 평소에 감싸 주는 것.
import { ConfirmProvider } from "@/components/ui/confirm-dialog";

const SURVEYS = [
  {
    id: "s1",
    title: "만족도 조사",
    questions: [
      { id: "q1", type: "rating", title: "전반적인 만족도", required: true, options: [] },
      { id: "q2", type: "multiple", title: "유익했던 세션", required: false, options: ["기조연설", "사례 발표", "Q&A"] },
      { id: "q3", type: "text", title: "한 줄 평", required: false, options: [] },
    ],
  },
  {
    id: "s2",
    title: "사전 조사",
    questions: [{ id: "q4", type: "single", title: "관심 분야", required: false, options: ["마케팅", "개발"] }],
  },
];

/**
 * 참여점수는 서버가 조립해 행에 붙여 보낸다 — 하니스도 그 계약을 그대로 흉내낸다.
 * 숫자는 실제 규칙과 맞아떨어지게 계산해 뒀다(분모 60분 기준):
 *   참석 25 + 체류 round(체류/60×35) + 행동 min(30, 질문×6 + …) + 인텐트(동의 10)
 * 툴팁이 이 합을 그대로 보여주므로, 어긋나 있으면 화면을 믿을 수 없게 된다.
 */
const EVALUATED_MINUTES = 60;

const REGISTRATIONS = [
  {
    id: "r1", name: "설문·문의 다 한 사람", phone: "01011112222", email: "a@ex.com",
    company: "엑스포럼", department: "마케팅", jobTitle: "매니저", industry: "IT",
    agreeMarketing: true, agreePrivacy: true, agreeThirdParty: true, memo: "사전질문: 가격 정책 안내 부탁드립니다",
    connectedSeconds: 3120, focusSeconds: 2800, stayMinutes: 52,
    isActive: false, submittedAt: "2026-08-18T02:00:00.000Z", enteredAt: "2026-08-20T05:01:00.000Z",
    lastPingAt: "2026-08-20T05:53:00.000Z",
    // 52/60분 시청 + 질문 2건 + 마케팅 동의 → 25+30+12+10
    score: 77, segment: "hot",
    scoreBreakdown: { attend: 25, watch: 30, interact: 12, interactRaw: 12, intent: 10, evaluatedMinutes: EVALUATED_MINUTES },
  },
  {
    id: "r2", name: "설문만 한 사람", phone: "01033334444", email: "b@ex.com",
    company: "테스트컴퍼니", department: null, jobTitle: null, industry: null,
    agreeMarketing: false, agreePrivacy: true, agreeThirdParty: false, memo: null,
    connectedSeconds: 600, focusSeconds: 500, stayMinutes: 10,
    isActive: false, submittedAt: "2026-08-19T02:00:00.000Z", enteredAt: "2026-08-20T05:02:00.000Z",
    lastPingAt: "2026-08-20T05:12:00.000Z",
    // 10분만 보고 이탈, 반응·동의 없음 → 25+6
    score: 31, segment: "warm",
    scoreBreakdown: { attend: 25, watch: 6, interact: 0, interactRaw: 0, intent: 0, evaluatedMinutes: EVALUATED_MINUTES },
  },
  {
    id: "r3", name: "아무것도 안 한 사람", phone: "01055556666", email: "c@ex.com",
    company: null, department: null, jobTitle: null, industry: null,
    agreeMarketing: false, agreePrivacy: true, agreeThirdParty: false, memo: null,
    connectedSeconds: 0, focusSeconds: 0, stayMinutes: 0,
    isActive: false, submittedAt: "2026-08-19T03:00:00.000Z", enteredAt: null, lastPingAt: null,
    // 등록만 하고 입장 안 함
    score: 0, segment: "noShow",
    scoreBreakdown: { attend: 0, watch: 0, interact: 0, interactRaw: 0, intent: 0, evaluatedMinutes: EVALUATED_MINUTES },
  },
  {
    // 인터랙션 캡(30)에 걸린 사례 — 툴팁이 "(원점수 42, 30점에서 멈춤)" 을 밝히는지 확인용
    id: "r4", name: "질문 폭격기", phone: "01077778888", email: "d@ex.com",
    company: "아웃컴", department: null, jobTitle: "대표", industry: null,
    agreeMarketing: true, agreePrivacy: true, agreeThirdParty: false, memo: null,
    connectedSeconds: 3600, focusSeconds: 3600, stayMinutes: 60,
    isActive: false, submittedAt: "2026-08-19T04:00:00.000Z", enteredAt: "2026-08-20T05:00:00.000Z",
    lastPingAt: "2026-08-20T06:00:00.000Z",
    // 풀시청 + 질문 7건(42점 → 30 캡) + 동의 → 25+35+30+10 = 100
    score: 100, segment: "hot",
    scoreBreakdown: { attend: 25, watch: 35, interact: 30, interactRaw: 42, intent: 10, evaluatedMinutes: EVALUATED_MINUTES },
  },
];

const SURVEY_RESPONSES = [
  { surveyId: "s1", registrationId: "r1", answers: { q1: 5, q2: ["기조연설", "Q&A"], q3: "실무에 바로 쓸 내용이 많았습니다" }, source: "ended", submittedAt: "2026-08-20T06:00:00.000Z" },
  { surveyId: "s2", registrationId: "r1", answers: { q4: "마케팅" }, source: "live", submittedAt: "2026-08-20T05:30:00.000Z" },
  { surveyId: "s1", registrationId: "r2", answers: { q1: 3, q3: "" }, source: "ended", submittedAt: "2026-08-20T06:05:00.000Z" },
];

const QA_ITEMS = [
  { id: "qa1", registrationId: "r1", question: "가격 정책이 궁금합니다.\n연간 계약 할인도 있나요?", status: "answered", sessionNumber: 2, voteCount: 7, createdAt: "2026-08-20T05:20:00.000Z" },
  { id: "qa2", registrationId: "r1", question: "발표 자료 공유되나요?", status: "pending", sessionNumber: null, voteCount: 0, createdAt: "2026-08-20T05:40:00.000Z" },
];

export default function RegistrantsHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();

  /* ?noqa=1 — 문의가 하나도 없는 페이지. 문의 열이 그때는 아예 나타나지 않아야 한다
     (빈 열이 명단을 넓히지 않게). 두 상태를 다 볼 수 있어야 게이트를 확인할 수 있다. */
  const noQa = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("noqa");

  /* ?before=1 — 아직 방송 전(phase=before). 이때는 전원이 0점 노쇼라 참여점수 열과
     세그먼트 필터가 **사라져야** 한다(분석 탭의 '확보한 리드' 와 같은 규칙).
     이 토글이 없으면 "점수가 안 보인다" 가 결함인지 의도인지 화면에서 구분할 수 없다. */
  const beforeLive = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("before");

  // 렌더 본문에서 한 번만 — 자식 effect 보다 먼저 서야 첫 목록 요청을 잡는다.
  const patched = useRef(false);
  if (typeof window !== "undefined" && !patched.current) {
    patched.current = true;
    const real = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/registrations/export")) {
        // 미연결 안내가 뜨는지 보려면 헤더가 0 이 아니어야 한다.
        return Promise.resolve(
          new Response("﻿\"이름\"\n\"하니스\"", {
            status: 200,
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "X-Mach-Unlinked-Surveys": "3",
              "X-Mach-Unlinked-Qa": "1",
            },
          }),
        );
      }
      if (url.includes("/registrations")) {
        /* 세그먼트 필터·점수 정렬은 서버가 하는 일이라 목에서도 실제로 해야 한다 —
           칩을 눌렀는데 행이 그대로면 사장님이 고장으로 읽는다. */
        const qs = new URLSearchParams(url.split("?")[1] ?? "");
        const seg = qs.get("segment");
        const rows = seg ? REGISTRATIONS.filter((r) => r.segment === seg) : [...REGISTRATIONS];
        if (qs.get("sortBy") === "score") {
          const dir = qs.get("sortDir") === "asc" ? 1 : -1;
          rows.sort((a, b) => (a.score - b.score) * dir);
        }
        return Promise.resolve(
          Response.json({
            registrations: rows,
            total: rows.length,
            stats: {
              registered: REGISTRATIONS.length,
              entered: REGISTRATIONS.filter((r) => r.enteredAt).length,
              active: 0,
              surveyResponded: 2,
              // 세그먼트 필터 칩의 개수 — 서버가 전체 등록자에서 센 값
              segments: { hot: 2, warm: 1, cold: 0, noShow: 1 },
            },
            /* 점수 열·필터의 표시 여부를 결정하는 값. before 면 화면이 둘 다 숨긴다. */
            scoring: { phase: beforeLive ? "before" : "ended", liveMinutes: EVALUATED_MINUTES, scheduledMinutes: 120 },
            surveys: SURVEYS,
            surveyResponses: SURVEY_RESPONSES,
            qaItems: noQa ? [] : QA_ITEMS,
          }),
        );
      }
      return real(input, init);
    };
  }

  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="text-sm font-semibold">등록자 명단 하니스</h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          개발 전용. 실제 RegistrantsTab + 모의 목록 API. 저장·삭제는 서버에 닿지 않습니다.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          토글: <a className="underline" href="?">방송 후(점수 열 보임)</a> ·{" "}
          <a className="underline" href="?before=1">방송 전(점수 열 숨김)</a> ·{" "}
          <a className="underline" href="?noqa=1">문의 없음</a>
        </p>
      </header>
      <ConfirmProvider>
        <RegistrantsTab webinarId="harness" />
      </ConfirmProvider>
    </div>
  );
}
