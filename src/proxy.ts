import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // OAuth 콜백과 공개/토큰 기반 엔드포인트는 세션 확인 전 통과.
  // 공개 경로에서 Supabase Auth 호출을 먼저 하면 헬스체크와 수집 스크립트도 인증 상태에 영향받을 수 있다.
  if (
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/oauth/register") ||
    pathname.startsWith("/oauth/token") ||
    pathname.startsWith("/oauth/revoke") ||
    pathname.startsWith("/api/collect") ||
    pathname.startsWith("/api/webinar/") ||
    pathname.startsWith("/api/webinar-embed/") || // 임베드 공개 설정/비콘 (webinar-embed-sites 어드민 CRUD는 제외)
    pathname.startsWith("/w/") || // 웨비나 로더 (외부 사이트 부착)
    pathname.startsWith("/f/") || // 등록 폼·등록 확인 로더 (외부 사이트 부착 — 설계 §17)
    pathname.startsWith("/t/") || // 티켓 페이지 (등록번호가 곧 티켓 — 설계 §9.2)
    pathname === "/webinar/sample" ||
    pathname === "/live-preview" || // 라이브 페이지 상태별 디자인 프리뷰(목업 데이터, 공개)
    pathname.match(/^\/webinar\/[^/]+\/live/) ||
    pathname.match(/^\/webinar\/[^/]+\/survey\//) || // 시청자 설문 응답 페이지(공개 — 종료화면·응답링크로 진입)
    pathname.match(/^\/webinar\/[^/]+\/landing/) || // 랜딩 상세페이지(공개 — 외부 사이트 iframe 임베드)
    pathname.startsWith("/c/") || // 대회 임베드 로더 (외부 사이트 부착)
    pathname.startsWith("/cp/") || // 대회 미리보기 (토큰 링크)
    // 대회 공개 API — 신청 제출·이미지 업로드. **POST 로 한정한다**: 같은 /entries 경로의
    // GET 은 어드민 목록이라, 여기로 새면 세션 갱신을 건너뛰어 만료 직전 토큰이 401 이 된다.
    ((request.method === "POST" || request.method === "OPTIONS") &&
      pathname.match(/^\/api\/competitions\/[^/]+\/(entries|entry-image)$/) !== null) ||
    // 투표는 GET(목록·내 표) / POST(투표) / DELETE(취소) 전부 공개다 — 어드민 전용 GET 이 없다.
    // 집계(/tally)는 여기 없다: 운영자만 봐야 하므로 로그인 흐름을 그대로 탄다.
    pathname.match(/^\/api\/competitions\/[^/]+\/votes$/) !== null ||
    // 결과 발표는 관람객이 보는 공개 조회다. 발표 전에는 라우트가 스스로 빈 결과를 준다.
    pathname.match(/^\/api\/competitions\/[^/]+\/result$/) !== null ||
    // 심사 화면·API — machstudio 계정이 없는 심사위원이 링크+비밀번호로 들어온다.
    pathname.startsWith("/j/") ||
    pathname.startsWith("/api/judge/") ||
    // 발표 화면 — 무대 노트북은 machstudio 계정으로 로그인돼 있지 않다. 링크(showToken)가 열쇠다.
    pathname.startsWith("/show/") ||
    pathname.startsWith("/api/show/") ||
    pathname.startsWith("/api/public") ||
    pathname.startsWith("/api/v1/") || // PAT Bearer 인증을 라우트 자체에서 검증하는 외부 API
    pathname === "/mcp" || // PAT Bearer 인증을 사용하는 원격 MCP 서버
    pathname.startsWith("/api/shorten-url") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/share") ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/r/") ||
    // 브리프 공개 화면 — 카톡으로 받은 참가사가 로그인 없이 연다. 채택된 링크만, 조회 외 부작용 없음.
    pathname.startsWith("/b/") ||
    // 현장 체크인 — 운영요원은 machstudio 계정이 없다. 링크(토큰) + 4자리 PIN 이 열쇠이고,
    // 라우트가 스스로 세션 쿠키를 확인한다(PIN 전에는 행사 이름 말고는 아무것도 주지 않는다).
    pathname.startsWith("/checkin/") ||
    pathname.startsWith("/api/checkin/") ||
    // 빌더형 등록 폼 미리보기(/p/{previewToken}) — 검토자는 워크스페이스 멤버가 아니다.
    // 권한은 추측 불가능한 토큰이 대신하고, 페이지 자체가 조회 외의 부작용을 갖지 않는다.
    pathname.startsWith("/p/") ||
    // 홈페이지 임베드 — 파트너 사이트에 부착되는 로더·미리보기·비콘.
    // **어드민 CRUD(/api/expo/*)는 여기 없다** — 그건 로그인 흐름을 그대로 탄다.
    pathname.startsWith("/h/") ||   // 페이지·구획 로더
    pathname.startsWith("/hp/") ||  // 토큰 미리보기(검토자는 워크스페이스 멤버가 아니다)
    pathname === "/api/expo-embed/seen" ||
    // 홈페이지 임베드 서체 — 파트너 사이트에서 익명으로 받아 간다.
    // matcher 가 제외하는 확장자에 woff2 는 없어서, 이게 없으면 로그인으로 307 된다(실측).
    // 버전이 박힌 정확한 접두사만 연다 — public/ 전체를 여는 것과는 다르다.
    pathname.startsWith("/fonts/pretendard/v1.3.9/") ||
    pathname.startsWith("/api/cron") ||
    // 개발 전용 하니스(/dev/*) — 로그인 뒤에 있는 컴포넌트를 격리해 검증할 때 쓴다.
    // 프로덕션에서는 이 조건이 false 이고, 각 페이지도 notFound() 로 한 번 더 막는다.
    (process.env.NODE_ENV !== "production" && pathname.startsWith("/dev/"))
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const publicPages = ["/", "/signup", "/reset-password", "/oauth/authorize"];
  const isPublicPage = publicPages.includes(pathname);

  // 비로그인 상태에서 보호된 페이지 접근 → 로그인으로
  if (!user && !isPublicPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 로그인 상태에서 로그인/회원가입 페이지 접근 → 대시보드로
  if (user && (pathname === "/" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  /**
   * monitoring: Sentry 터널 경로(next.config 의 tunnelRoute)를 반드시 제외해야 한다.
   * 여기 걸리면 비로그인 방문자의 POST 가 "/" 로 307 되고, 따라간 "/" 는 POST 를 안 받아 405 →
   * **브라우저 에러 리포트가 전부 유실된다**(실측: POST /monitoring → 307 → / → 405).
   * 시청자·랜딩 방문자는 전부 비로그인이라, 정작 봐야 할 공개 페이지 에러만 통째로 사라진다.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
