/**
 * 임베드 로더 하니스 — **개발 환경 전용**(프로덕션 404).
 *
 * 로더는 외부 사이트(아임웹 등)에 붙는 스크립트라서 우리 앱 화면 어디에서도 열 수 없다.
 * 실제로 태우려면 (1) 활성 임베드 사이트 ID 와 (2) 등록 가능한 웨비나가 DB 에 있어야 하고,
 * 등록을 눌러 보려면 진짜 등록자가 쌓인다. 그래서 로더 **본문은 그대로** 쓰고 fetch 만
 * 가로채 config·중복확인·등록 응답을 흉내낸다 — 검증 대상(폼 렌더·제출 흐름·완료 팝업)은
 * 전부 클라이언트 코드라 이 경계로 충분하다.
 *
 * page.tsx 가 아니라 route.ts 인 이유: React 는 컴포넌트가 렌더한 script 태그를 실행하지
 * 않는다("Scripts inside React components are never executed"). 로더는 script 태그로 붙는
 * 물건이라, 우리 프레임워크를 거치지 않는 생 HTML 이 오히려 실제 부착 환경에 더 가깝다.
 */
import { NextResponse } from "next/server";
import { buildWebinarLoaderScript } from "@/lib/webinar-loader-script";

const MOCK_CONFIG = {
  slug: "harness",
  name: "하니스 웨비나",
  status: "REGISTRATION",
  statusOverride: null,
  entryOpenAt: "2099-01-01T04:30:00.000Z",
  liveStartAt: "2099-01-01T05:00:00.000Z",
  liveEndAt: "2099-01-01T06:00:00.000Z",
  signupDeadline: "2099-01-01T04:00:00.000Z",
  canRegister: true,
  updatedKey: "1",
  allowLiveRegistration: null,
  theme: { accentColor: "#6d28d9", borderRadius: "12px" },
  components: { formWidget: { title: "사전등록", description: "자리를 미리 잡아두세요." } },
  registrationForm: {
    fields: [
      { key: "name", label: "이름", type: "text", enabled: true, required: true },
      { key: "phone", label: "연락처", type: "tel", enabled: true, required: true },
      { key: "email", label: "이메일", type: "email", enabled: true, required: true },
      { key: "company", label: "회사", type: "text", enabled: true, required: false },
      { key: "job", label: "직무", type: "text", enabled: true, required: false },
    ],
    privacyText: "개인정보 수집·이용에 동의합니다.",
    marketingText: "마케팅 정보 수신에 동의합니다.",
    privacyBody: null,
    marketingBody: null,
    privacyDefaultChecked: false,
    marketingDefaultChecked: false,
    thirdPartyEnabled: true,
    thirdPartyText: "개인정보 제3자 제공에 동의합니다.",
    thirdPartyBody: null,
    thirdPartyDefaultChecked: false,
    submitLabel: "등록 완료",
  },
  links: { livePageUrl: null, surveyUrl: null, calendarUrl: null },
  ics: null,
  bannerPagePatterns: [],
};

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("not found", { status: 404 });
  }

  const loader = buildWebinarLoaderScript({ siteId: "harness", baseUrl: "" });

  /* fetch 가로채기는 로더보다 **먼저** 실행되어야 한다 — 로더가 즉시 config 를 부른다. */
  const stub = `
(function () {
  var CFG = ${JSON.stringify(MOCK_CONFIG)};
  CFG.serverNow = new Date().toISOString();   /* 고정하면 상태 판정이 과거로 굳는다 */
  var real = window.fetch.bind(window);
  function ok(body) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
  }
  window.__harnessCalls = [];
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    window.__harnessCalls.push(url);
    if (url.indexOf("/api/webinar-embed/") >= 0) return ok(CFG);
    if (url.indexOf("/register/check") >= 0) return ok({ exists: false });
    if (url.indexOf("/register") >= 0) return ok({ ok: true, registrationId: "harness-reg" });
    if (url.indexOf("/seen") >= 0) return ok({ ok: true });
    return real(input, init);
  };
  try { sessionStorage.clear(); } catch (e) {}
})();
`;

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>임베드 로더 하니스</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
  main { max-width: 520px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 14px; font-weight: 600; margin: 0; }
  p.note { margin: 4px 0 0; font-size: 11px; color: #666; }
  /* 제출 버튼이 화면 하단에 오도록 위에 여백을 둔다 — 인라인 문구가 접힌 곳에 생기던
     원래 상황을 재현해야 팝업이 필요한 이유가 눈에 보인다. */
  .pad { height: 40vh; }
  .pad-tail { height: 80vh; }
</style>
</head><body>
<main>
  <h1>임베드 로더 하니스</h1>
  <p class="note">개발 전용. 실제 로더 스크립트 + 모의 API. 등록을 눌러도 저장되지 않습니다.</p>
  <div class="pad" aria-hidden="true"></div>
  <div data-mach-webinar-mount="register-form"></div>
  <div class="pad-tail" aria-hidden="true"></div>
</main>
<script>${stub}</script>
<script>${loader}</script>
</body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
