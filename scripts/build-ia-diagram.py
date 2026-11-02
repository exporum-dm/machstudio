# -*- coding: utf-8 -*-
"""mach studio 정보구조 지도 SVG 생성.
손으로 rect 200개를 쓰면 반드시 어긋나므로 좌표를 계산한다."""
import io
import os

W = 2280
M = 48
GUT = 58                      # 좌측 존 라벨 기둥
CX = M + GUT                  # 패널 시작 x
CW = W - M - CX               # 패널 영역 폭

INK   = "#1B1725"
MUT   = "#6E6780"
FAINT = "#9A93A8"
HAIR  = "#E4DFEA"
GROUND= "#FBFAFD"
PANEL = "#FFFFFF"

APP   = "#6D4AFF"   # 앱 면 — 사이드바 활성 바이올렛
PUB   = "#0E8F7E"   # 공개 면
ADM   = "#B4530A"   # 관리자
DATA  = "#46568C"   # 데이터
SEAM  = "#A8324A"   # 이음새

FONT = "'Pretendard','Apple SD Gothic Neo','Noto Sans KR','Helvetica Neue',Arial,sans-serif"
MONO = "'SF Mono','JetBrains Mono',ui-monospace,Menlo,monospace"

out = []
def e(s): out.append(s)
def esc(t):
    return (t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))

def tw(text, fs):
    """텍스트 폭 추정 — CJK 는 거의 정사각, 라틴은 절반."""
    w = 0.0
    for ch in text:
        o = ord(ch)
        if o < 0x2500: w += fs * (0.30 if ch == " " else 0.545)
        else: w += fs * 0.98
    return w

def wrap(text, maxw, fs):
    """공백 기준 우선, 한 낱말이 넘치면 글자 단위로."""
    words, lines, cur = text.split(" "), [], ""
    for wd in words:
        trial = wd if not cur else cur + " " + wd
        if tw(trial, fs) <= maxw:
            cur = trial; continue
        if cur: lines.append(cur); cur = ""
        if tw(wd, fs) <= maxw:
            cur = wd
        else:
            buf = ""
            for ch in wd:
                if tw(buf + ch, fs) > maxw:
                    lines.append(buf); buf = ch
                else: buf += ch
            cur = buf
    if cur: lines.append(cur)
    return lines or [""]

def txt(x, y, s, fs=14, fill=INK, weight="400", anchor="start", font=FONT, ls=None, op=None):
    a = f' text-anchor="{anchor}"' if anchor != "start" else ""
    l = f' letter-spacing="{ls}"' if ls else ""
    o = f' opacity="{op}"' if op else ""
    e(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{font}" font-size="{fs}" '
      f'font-weight="{weight}" fill="{fill}"{a}{l}{o}>{esc(s)}</text>')

def rrect(x, y, w, h, r=10, fill=PANEL, stroke=HAIR, sw=1, shadow=True, op=None):
    f = f' filter="url(#sh)"' if shadow else ""
    o = f' opacity="{op}"' if op else ""
    e(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" '
      f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{f}{o}/>')

# ── 패널 ──────────────────────────────────────────────────────────
HDR = 40
LH  = {"h": 25, "i": 21, "s": 19, "g": 12}
FS  = {"h": 13.5, "i": 13, "s": 12}

def panel_h(items, w, sub=None):
    """헤더 + 항목 높이 합."""
    h = HDR + (18 if sub else 0) + 10
    for kind, t in items:
        if kind == "g": h += LH["g"]; continue
        pad = {"h": 16, "i": 16, "s": 30}[kind]
        h += LH[kind] * len(wrap(t, w - pad - 16, FS[kind]))
    return h + 12

def panel(x, y, w, title, items, accent, sub=None, count=None):
    h = panel_h(items, w, sub)
    rrect(x, y, w, h)
    # 헤더 스트립 — 악센트 8%, 아래 2px 악센트 선
    e(f'<path d="M{x} {y+10} a10 10 0 0 1 10 -10 h{w-20} a10 10 0 0 1 10 10 '
      f'v{HDR-10} h-{w} z" fill="{accent}" opacity="0.075"/>')
    e(f'<rect x="{x}" y="{y+HDR-2}" width="{w}" height="2" fill="{accent}" opacity="0.55"/>')
    txt(x + 14, y + 26, title, 15, accent, "700")
    if count:
        txt(x + w - 14, y + 26, count, 11.5, accent, "600", anchor="end", ls="0.4")
    cy = y + HDR + 4
    if sub:
        cy += 15
        txt(x + 14, cy, sub, 11.8, FAINT, "400")
        cy += 8
    for kind, t in items:
        if kind == "g":
            cy += LH["g"]
            e(f'<rect x="{x+14}" y="{cy-7:.1f}" width="{w-28}" height="1" fill="{HAIR}"/>')
            continue
        if kind == "h":
            cy += 6
            for i, ln in enumerate(wrap(t, w - 32, FS["h"])):
                cy += LH["h"] - (6 if i else 0)
                txt(x + 14, cy, ln, FS["h"], INK, "700")
        elif kind == "i":
            for i, ln in enumerate(wrap(t, w - 32, FS["i"])):
                cy += LH["i"]
                if i == 0:
                    e(f'<circle cx="{x+18.5}" cy="{cy-4.5:.1f}" r="2" fill="{accent}" opacity="0.85"/>')
                txt(x + (26 if True else 14), cy, ln, FS["i"], INK if i == 0 else MUT, "400")
        else:
            for i, ln in enumerate(wrap(t, w - 46, FS["s"])):
                cy += LH["s"]
                txt(x + 38, cy, ln, FS["s"], MUT, "400")
    return h

def zone(y, h, label, accent):
    """좌측 존 기둥."""
    e(f'<rect x="{M}" y="{y}" width="4" height="{h}" rx="2" fill="{accent}" opacity="0.5"/>')
    cy = y + h / 2
    e(f'<g transform="translate({M+26},{cy}) rotate(-90)">'
      f'<text x="0" y="0" font-family="{FONT}" font-size="12.5" font-weight="700" '
      f'fill="{accent}" text-anchor="middle" letter-spacing="3.4">{esc(label)}</text></g>')

def band(y, title, note=None):
    txt(CX, y, title, 19, INK, "700")
    if note: txt(CX + tw(title, 19) + 14, y, note, 12.5, FAINT, "400")
    return y

def arrow(x1, y1, x2, y2, color=FAINT):
    e(f'<path d="M{x1:.1f} {y1:.1f} L{x2:.1f} {y2:.1f}" stroke="{color}" '
      f'stroke-width="1.4" marker-end="url(#ar)" fill="none"/>')

# ═══════════════════════════════════════════════════════════════
y = 0
e("")  # 헤더는 나중에 채운다(높이 확정 후 defs 와 함께)
HEAD = 150
y = HEAD

# ── 0. 스코프 사슬 ────────────────────────────────────────────────
band(y, "스코프 사슬", "거의 모든 화면은 워크스페이스 하나 + 프로젝트 하나가 걸린 상태에서만 의미가 있다")
y += 22
CH_H = 216
rrect(CX, y, CW, CH_H)
bx, by, bw, bh = CX + 26, y + 32, 168, 46

def chip(x, yy, w, h, label, note, accent, r=8, fs=14):
    rrect(x, yy, w, h, r, "#FFFFFF", accent, 1.4, shadow=False)
    e(f'<rect x="{x}" y="{yy}" width="{w}" height="{h}" rx="{r}" fill="{accent}" opacity="0.07"/>')
    txt(x + w/2, yy + (h/2 + 1 if not note else h/2 - 3), label, fs, INK, "700", anchor="middle")
    if note: txt(x + w/2, yy + h/2 + 13, note, 10.8, MUT, "400", anchor="middle")

chip(bx, by, bw, bh, "User", "로그인 계정 · isSuperAdmin", APP)
arrow(bx + bw + 6, by + bh/2, bx + bw + 54, by + bh/2)
x2 = bx + bw + 60
chip(x2, by, bw + 24, bh, "Workspace", "최상위 테넌트 · slug", APP)
txt(x2 + (bw+24)/2, by - 10, "WorkspaceMember : OWNER · ADMIN · MEMBER", 11, APP, "600", anchor="middle")
arrow(x2 + bw + 30, by + bh/2, x2 + bw + 78, by + bh/2)
x3 = x2 + bw + 84
chip(x3, by, bw, bh, "Project", "소프트 삭제 · 공유 토큰 2쌍", APP)

# 워크스페이스 자산 (아래로)
e(f'<path d="M{x2+(bw+24)/2} {by+bh} v34" stroke="{FAINT}" stroke-width="1.4" fill="none" marker-end="url(#ar)"/>')
ax, ay = x2 - 30, by + bh + 40
rrect(ax, ay, bw + 84, 52, 8, "#FFFFFF", HAIR, 1, shadow=False)
txt(ax + 12, ay + 20, "워크스페이스 자산", 12.5, INK, "700")
txt(ax + 12, ay + 38, "UTM 규칙 · 약관 템플릿 · API 토큰 · 활동 로그", 11, MUT)

# 프로젝트 자식 5개 — 한 줄 8칸으로 읽히지 않게 2단으로 내린다
kids = [("CollectSource", "→ CollectRecord"), ("Dashboard", "→ Widget · 예약리포트"),
        ("Webinar", "→ 세션·등록자·인터랙션 21모델"), ("UTMLink", "→ ShortLink"),
        ("AdPerfBatch", "→ AdPerfRecord")]
kx = CX + 748
kw = (CX + CW - 26 - kx - 4 * 12) / 5
ky = by + 78
rail = ky - 20
pc = x3 + bw / 2
e(f'<path d="M{pc} {by+bh} V{rail} H{kx + kw/2 + 4*(kw+12):.1f}" stroke="{FAINT}" '
  f'stroke-width="1.4" fill="none"/>')
for i, (n, s) in enumerate(kids):
    cx0 = kx + i * (kw + 12)
    e(f'<path d="M{cx0+kw/2:.1f} {rail} V{ky}" stroke="{FAINT}" stroke-width="1.4" '
      f'fill="none" marker-end="url(#ar)"/>')
    chip(cx0, ky, kw, bh, n, s, APP if i != 2 else "#5A34F0", fs=12.5)
txt(kx, rail - 12, "프로젝트 하위 5개 계열 — 사이드바 5개 메뉴가 각각 이 중 하나를 다룬다", 11.5, FAINT)
y += CH_H + 34

# ── 1. 앱 면 : 셸 ────────────────────────────────────────────────
app_top = y
band(y, "앱 면", "Supabase 세션 필요 · (app) 그룹 레이아웃 안")
y += 22

shell_items = [
    ("h", "사이드바 — 위에서 아래 순서 그대로"),
    ("i", "워크스페이스 스위처 · 프로젝트 선택기"),
    ("i", "주 내비게이션 5개 (navItems 배열 순서)"),
    ("i", "관리자 — isSuperAdmin 에게만"),
    ("i", "알림 벨 (30초 폴링, 9+ 배지)"),
    ("i", "테마 토글 · 프로필 메뉴"),
    ("g", ""),
    ("h", "설정은 페이지가 아니라 모달이다"),
    ("s", "/settings → /dashboard, /settings/workspace → /settings → /dashboard. 면 0개"),
    ("i", "워크스페이스 설정 — 일반 / UTM 규칙 / 약관"),
    ("s", "역할로 탭 수가 달라지는 유일한 화면"),
    ("i", "프로필 · 알림 · API 토큰 · 알림 패널"),
    ("s", "초대 수락/거절의 유일한 UI = 알림 패널"),
    ("i", "프로젝트 권한 (VIEWER/EDITOR/ADMIN)"),
]
auth_items = [
    ("i", "/  로그인 (이메일·비밀번호 / Google)"),
    ("i", "/signup  가입 — Auth 계정만 생성"),
    ("i", "/reset-password  ·  /update"),
    ("i", "/auth/callback  세션 교환 → 302"),
    ("s", "워크스페이스 유무를 확인하지 않는다"),
    ("g", ""),
    ("h", "강제 온보딩 없음 — 0개는 정상 상태"),
    ("i", "ensureAppUser() — 로그인 시 DB User 행 보장"),
    ("s", "없으면 관리자 목록에 안 보이고 초대도 실패한다"),
    ("i", "WorkspaceGate — 0개면 안내 화면"),
    ("s", "주 메시지는 “초대를 기다린다”, 생성은 보조"),
]
adm_items = [
    ("i", "개요 — 4개 카드에 현재 수치"),
    ("i", "?view=system  DB·환경변수 (읽기 전용)"),
    ("i", "?view=users  가입 7명 · 삭제 · 권한"),
    ("i", "?view=workspaces  이름·보관·영구삭제"),
    ("i", "?view=projects  프로젝트 7 / 소스 7"),
    ("i", "?view=activity  ActivityLog 12건"),
]
w3 = (CW - 48) / 3
h1 = panel(CX,               y, w3, "진입 · 인증", auth_items, APP, count="라우트 5")
h2 = panel(CX + w3 + 24,     y, w3, "앱 셸 · 설정", shell_items, APP, count="모달 6")
h3 = panel(CX + 2*(w3 + 24), y, w3, "/admin  관리자", adm_items, ADM,
           sub="슈퍼어드민 전용 · 단일 페이지, ?view= 로 6뷰", count="뷰 6")
y += max(h1, h2, h3) + 26

# ── 2. 5개 도메인 ────────────────────────────────────────────────
dash = [
    ("s", "화면 안 제목은 “실시간 보고서” — 고정 순서 한 장"),
    ("i", "보고서 필터 (수집 폼 · UTM 3종 · 기여 기준)"),
    ("i", "① 오늘의 사전등록 흐름 — 3지표·추이·히트맵"),
    ("i", "② 주요 관람객 구성 — 차원 코드 고정, 최대 4"),
    ("i", "③ 유입 경로 — 소스/매체/소스·매체 탭"),
    ("i", "④ 이메일 도메인 TOP 10"),
    ("i", "공유 모달 → /share/dashboard/[token]"),
    ("g", ""),
    ("s", "원천 = CollectRecord"),
    ("s", "뒤에 위젯 보드·예약 리포트 계층 — 편집 UI 없음"),
]
collect = [
    ("i", "/collect  소스 목록 · 활성 토글 · 백업 복구"),
    ("h", "/collect/[id]  탭 7개"),
    ("s", "수집 데이터 · 필드 · 스크립트 · 설치 · 설정 · 데이터 관리 · 활동"),
    ("h", "모달 7개"),
    ("s", "레코드 상세 · 가져오기(2단계) · 중복 정리 · 정규화 · GDPR · 전체 삭제(3중 확인) · 설치 테스트"),
    ("g", ""),
    ("i", "공개 면 /s/[id] — 1줄 설치 JS"),
    ("s", "원천 = CollectRecord · FieldMapping · 보존정책"),
]
ads = [
    ("s", "탭이 아니라 위→아래 섹션 + 세그먼트"),
    ("i", "성과 범위 — 매체 → 캠페인 → 광고세트 3단"),
    ("s", "선택이 KPI·차트·테이블 전체에 반영"),
    ("i", "소스 관리 (드로어) · 소스 추가 (드로어)"),
    ("s", "파일/Sheets → 헤더 인식 → 매핑 → 미리보기"),
    ("i", "공유 모달 → /share/analytics/[token]"),
    ("g", ""),
    ("s", "정규화 정본 ad-parse.ts · 원본 행은 raw 보존"),
]
utm = [
    ("i", "목록 — 날짜별 / 캠페인별 그룹 2종"),
    ("i", "행 펼침 — 전체 URL · 단축 URL · QR"),
    ("i", "생성 드로어 2모드"),
    ("s", "기본(질문형) / 고급(URL×source×medium 곱)"),
    ("i", "수정 · 복제 드로어"),
    ("g", ""),
    ("s", "규칙값의 집은 여기가 아니다 — 워크스페이스 설정 모달"),
    ("i", "공개 면 /r/[code] — 302 리다이렉트"),
]
w4 = (CW - 72) / 4
band(y, "5개 도메인", "사이드바 순서 그대로")
y += 22
hs = []
hs.append(panel(CX,               y, w4, "대시보드", dash, APP, count="/dashboard"))
hs.append(panel(CX + w4 + 24,     y, w4, "사전등록", collect, APP, count="/collect"))
hs.append(panel(CX + 2*(w4+24),   y, w4, "광고 성과", ads, APP, count="/analytics"))
hs.append(panel(CX + 3*(w4+24),   y, w4, "UTM 빌더", utm, APP, count="/utm-builder"))
y += max(hs) + 26

# ── 3. 웨비나 ────────────────────────────────────────────────────
band(y, "웨비나", "앱에서 가장 큰 도메인 — API 57 · 모델 21 · 위치는 URL 쿼리가 단일 소스")
y += 22
hub = [
    ("i", "/webinar  목록 — 스코프 목록 + 등록자 수"),
    ("s", "만들기 · 다른 웨비나에서 복제 모달"),
    ("s", "링크는 webinar.id, 라우트 파라미터명은 [slug]"),
    ("g", ""),
    ("h", "/webinar/[slug]  허브 헤더"),
    ("i", "상태 배지 · URL 복사 · 열기 · 미리보기"),
    ("i", "··· 더보기 — 웨비나 삭제 (파괴 액션의 집)"),
    ("g", ""),
    ("s", "?tab= create | deploy | operate | analytics"),
]
create = [
    ("s", "좌 레일 3그룹 6칸 + 본문 + 인접 미리보기"),
    ("h", "사실"),
    ("i", "원본 정보 — 이름·일정 / 진행 순서 / 브랜드"),
    ("s", "진행 순서: 유형 5종 · 연사(이름·소속·약력·홈·SNS 6·사진) · 로고 · 내용"),
    ("h", "산출물"),
    ("i", "랜딩 페이지 · 등록 폼 · 설문"),
    ("i", "시청 화면 — ?st= waiting|entry|live|ended"),
    ("h", "확인"),
    ("i", "노출 점검 — 6면 × 요소, 읽기 전용 거울"),
    ("s", "레일의 준비 상태 미터가 여기서 파생"),
    ("g", ""),
    ("s", "미리보기는 목업이 아니라 실물 iframe"),
]
deploy = [
    ("s", "아임웹 부착의 단일 창구 — 카드 5장"),
    ("i", "① 랜딩 임베드 — 직접 링크 + 위젯 코드"),
    ("i", "② 하단 배너 문구 4칸 (상태별)"),
    ("i", "③ 아임웹 사이트 연결"),
    ("s", "연결 배지 · 노출 웨비나 전환 · 스니펫 · 라이브 URL"),
    ("i", "④ 마운트 마커 3종 (접힘)"),
    ("i", "⑤ 부착 순서 5단계 (펼침)"),
    ("g", ""),
    ("s", "WebinarEmbedSite 는 프로젝트 자원인데 진입점이 여기 하나뿐"),
]
operate = [
    ("h", "라이브 콘솔 — 레이아웃이 상태에 따라 두 벌"),
    ("i", "상태 바 · 실시간 지표 6칸 · 동시 접속 추이"),
    ("i", "러닝오더 · 문의·폼 응답 · 시청자(상위 8) · 운영 로그"),
    ("i", "라이브: 인터랙션 카드+드로어 / Q&A / 채팅"),
    ("i", "비라이브: 아코디언 3그룹 — 인터랙션·참여·발송"),
    ("i", "종료: 방송 요약 4칸 recap"),
    ("g", ""),
    ("h", "등록자"),
    ("i", "요약 5칸 · 표 14열 · 상세 드로어"),
    ("i", "CSV 일괄등록 · CSV 내보내기"),
    ("s", "설문 응답 열 + 문의(Q&A) 열 포함"),
]
analy = [
    ("s", "단일 스크롤 · 수동 새로고침만"),
    ("i", "① 요약 KPI 8칸"),
    ("i", "② 시청·참여 타임라인 (동시·입장·채팅·이벤트)"),
    ("i", "③ 참여 성적표 — 투표 / Q&A"),
    ("i", "④ 설문 결과 — rating·nps·선택·text"),
    ("i", "⑤ 리드 스코어링 0~100 (핫·웜·콜드·노쇼)"),
    ("i", "⑥ 참가 퍼널 — 방문→등록→입장→30분→60분"),
    ("i", "⑦ 일자별 등록 추이"),
    ("i", "⑧ 유입 채널별 · ⑨ 캠페인별 + 광고비"),
]
w5 = (CW - 96) / 5
sets = [("허브 · 목록", hub, "진입"), ("만들기", create, "?tab=create"),
        ("배포", deploy, "?tab=deploy"), ("운영", operate, "?tab=operate"),
        ("분석", analy, "?tab=analytics")]
hs = []
for i, (t, it, c) in enumerate(sets):
    hs.append(panel(CX + i * (w5 + 24), y, w5, t, it, "#5A34F0", count=c))
y += max(hs) + 30
zone(app_top - 4, y - app_top - 8, "앱 면", APP)

# ── 4. 공개 면 ───────────────────────────────────────────────────
pub_top = y
band(y, "공개 면", "인증이 아니라 토큰·slug 가 접근을 결정한다")
y += 22
shareP = [
    ("i", "/share/analytics/[token]  광고 성과 30일 요약"),
    ("s", "Project.analyticsShareToken · 필터·드릴다운 없음"),
    ("i", "/share/dashboard/[token]  실시간 보고서"),
    ("s", "앱과 같은 RealtimeReport 재사용 · 30일 고정"),
    ("i", "/share/[token]  위젯 보드 12열"),
    ("s", "Dashboard.shareToken · 편집 UI 없음 → 실질 도달 불가"),
    ("g", ""),
    ("s", "셋 다 deletedAt 을 확인한다 → 프로젝트 보관 시 즉시 닫힘"),
]
scriptP = [
    ("s", "전부 인증 없음 · CORS * · noindex. 응답이 산출물이다"),
    ("i", "/w/[id]  웨비나 임베드 로더"),
    ("s", "설정은 런타임 config (sessionStorage 60초 SWR)"),
    ("i", "/w/l/[slug]  랜딩 런타임 + boot(payload)"),
    ("s", "데이터를 스크립트에 실어 요청 1회"),
    ("i", "/s/[id]  수집 스크립트   ·   /r/[code]  302"),
    ("g", ""),
    ("h", "호스트 사이트 마운트"),
    ("s", "landing-mount / hero-button / register-form / live(iframe+postMessage)"),
    ("s", "마커 없이 자동: 하단 배너 · 등록 폼 모달"),
]
viewerP = [
    ("h", "/webinar/[slug]/landing"),
    ("s", "히어로 → About → Sessions → Time Table → [dark: Programs → Highlights → Audience → Join → FAQ]"),
    ("s", "좌측 목차 + 스크롤 스파이 · 연사 상세 팝업(홈·SNS)"),
    ("g", ""),
    ("h", "/webinar/[slug]/live — 한 URL, 네 면"),
    ("i", "대기 — 카운트다운 · “N명이 함께 기다려요”"),
    ("i", "입장 확인 — 전화/이메일 인증 카드"),
    ("i", "시청 — 플레이어 + 탭 Q&A/채팅/세션 + 푸시 레이어"),
    ("i", "종료 — 다시보기·설문 N장·자료·다음 웨비나"),
    ("g", ""),
    ("h", "/webinar/[slug]/survey/[surveyId]"),
    ("s", "SurveyForm 공유 — 인라인 검증 + localStorage 임시저장"),
]
w3b = (CW - 48) / 3
hs = [panel(CX, y, w3b, "계통 A — 토큰 공유 링크", shareP, PUB, count="면 3"),
      panel(CX + w3b + 24, y, w3b, "계통 B — 스크립트 배포", scriptP, PUB, count="핸들러 4"),
      panel(CX + 2*(w3b+24), y, w3b, "계통 C — 웨비나 시청자", viewerP, PUB, count="면 약 40")]
y += max(hs) + 30
zone(pub_top - 4, y - pub_top - 8, "공개 면", PUB)

# ── 5. 데이터 모델 ───────────────────────────────────────────────
dat_top = y
band(y, "데이터 모델", "42개 · enum 은 Role 하나뿐, 나머지 상태는 String + 코드 화이트리스트")
y += 22
groups = [
    ("인증·조직", ["User","Workspace","WorkspaceMember","WorkspaceInvitation","Notification",
                 "NotificationPref","ApiToken","ActivityLog","Role(enum)"]),
    ("프로젝트", ["Project","ProjectMember"]),
    ("광고 성과", ["AdPerformanceImportBatch","AdPerformanceRecord"]),
    ("UTM·링크", ["UTMPreset","UTMTemplate","UTMLink","ShortLink"]),
    ("수집", ["CollectSource","FieldMapping","CollectRecord","CollectRetentionPolicy"]),
    ("대시보드", ["Dashboard","DashboardWidget","ScheduledReport"]),
    ("웨비나 코어", ["Webinar","WebinarSession","WebinarRegistration"]),
    ("웨비나 인터랙션", ["WebinarQA","WebinarQAVote","WebinarAnnouncement","WebinarPopup",
                    "WebinarPopupClick","WebinarPoll","WebinarPollOption","WebinarPollVote",
                    "WebinarChatMessage","WebinarReminder","WebinarTallyPush"]),
    ("설문·배포·계측", ["WebinarSurvey","WebinarSurveyResponse","WebinarEmbedSite",
                   "WebinarAttendanceSegment","WebinarVisitStat"]),
]
SOFT = {"Workspace","Project","CollectSource","WebinarEmbedSite"}
PART = {"WebinarPopup","WebinarPoll","WebinarSurvey","WebinarTallyPush","WebinarAnnouncement","WebinarQA"}
# 배치: 칩을 흘려 담는다
gx, gy = CX, y
box_y = gy
rows = []
cur_y = gy + 14
for gname, models in groups:
    rows.append((gname, models))
# 폭 계산 후 렌더
gcol_w = CW
cy = gy + 12
rrect(CX, gy, CW, 10, 10, PANEL, HAIR)  # placeholder, 아래에서 실제 높이로 다시
del out[-1]
chip_h, chip_gap = 26, 7
ty = gy + 20
for gname, models in rows:
    txt(CX + 16, ty + 6, gname, 12.5, DATA, "700")
    lx = CX + 16 + 128
    ly = ty - 12
    for m in models:
        cwid = tw(m, 11.8) + 20
        extra = 0
        if m in SOFT: extra = 16
        if m in PART: extra += 16
        cwid += extra
        if lx + cwid > CX + CW - 16:
            ly += chip_h + chip_gap; lx = CX + 16 + 128
        col = DATA
        rrect(lx, ly, cwid, chip_h, 6, "#FFFFFF", HAIR, 1, shadow=False)
        e(f'<rect x="{lx}" y="{ly}" width="{cwid:.1f}" height="{chip_h}" rx="6" fill="{col}" opacity="0.05"/>')
        txt(lx + 10, ly + 17.5, m, 11.8, INK, "500", font=MONO)
        ox = lx + cwid - 10
        if m in PART:
            txt(ox, ly + 17.5, "◈", 11, "#B4530A", "700", anchor="end"); ox -= 16
        if m in SOFT:
            txt(ox, ly + 17.5, "◐", 11, PUB, "700", anchor="end")
        lx += cwid + chip_gap
    ty = ly + chip_h + 14
DAT_H = ty - gy - 4
# 실제 패널 배경을 뒤가 아니라 앞에 그릴 수 없으니 테두리만 사후에
e(f'<rect x="{CX}" y="{gy}" width="{CW}" height="{DAT_H}" rx="10" fill="none" stroke="{HAIR}" stroke-width="1"/>')
y = gy + DAT_H + 14
lg = [("◐", PUB, "소프트 삭제 (4개만) — deletedAt 후 30일에 cron/daily 가 Cascade 영구 삭제"),
      ("◈", "#B4530A", "부분 유니크 인덱스 — 스키마에 없고 SQL 에만 있다. db push 가 지운다(에러 없음)")]
lx = CX + 4
for sym, col, label in lg:
    txt(lx, y + 12, sym, 12, col, "700"); lx += 20
    txt(lx, y + 12, label, 12, MUT); lx += tw(label, 12) + 34
y += 26

rules = [
    ("i", "Cascade 3계층 — Workspace → (멤버·프로젝트·수집·대시보드·웨비나·임베드·광고 17계열) → 각자의 자식"),
    ("i", "SetNull 은 5곳뿐 — 사람·팝업·전시 웨비나가 사라져도 기록은 남긴다"),
    ("i", "registrationId 를 가진 모델 8개 중 FK+cascade 는 AttendanceSegment 하나 → 등록자 삭제는 반드시 webinar-registrant-delete.ts 를 지난다"),
    ("s", "파기 원칙: 행사 기록은 남기고 사람은 지운다 — 리마인더 삭제 / Q&A·채팅은 본문 남기고 PII 제거 / 투표·클릭·응답은 registrationId = null"),
]
blobs = [
    ("s", "설정은 대부분 컬럼이 아니라 JSON 블롭에 있고, 블롭마다 정규화 모듈이 하나씩 = 그것이 계약이다"),
    ("i", "Webinar.config → webinar-config.ts  (registrationForm · livePage · landingPage)"),
    ("i", "Webinar.components → 라이브 중에도 바꾸는 스위치만 여기"),
    ("s", "채팅 모더레이션 값은 일부러 블롭이 아니라 전용 컬럼 — 설정탭 저장이 블롭을 덮어쓰는 것을 막기 위해"),
    ("i", "Registration.memo 는 의사 JSON — String 인데 { memo, customFields }"),
    ("s", "parseMemo/buildMemo 를 짝으로 써야 한다(과거 직접 저장으로 customFields 유실)"),
]
cross = [
    ("i", "KST 표시 — formatKst 가 hourCycle h23 고정"),
    ("i", "공개 라우트 레이트리밋 — Upstash Redis, 없으면 인메모리 폴백"),
    ("i", "뷰어 폴링은 /live-state 하나로 통합 (라이브 전 /status 30초)"),
    ("s", "새 폴러를 추가하지 않는다"),
    ("i", "크론 라우트 5개 중 vercel.json 이 예약하는 건 2개 — daily 가 3개를 흡수"),
    ("i", "window.confirm 전면 제거 → 공용 확인 모달 (requireText 게이트)"),
    ("i", "저장 버튼 대신 자동저장 표시 — AutosaveScope 로 화면당 하나"),
    ("i", "삭제는 토스트 + 5초 유예 + 실행취소 · 로드 실패는 빈 상태로 위장하지 않는다"),
    ("i", "개발 하니스 9개 — 프로덕션에서 notFound() + 미들웨어 차단"),
]
w3c = (CW - 48) / 3
hs = [panel(CX, y, w3c, "관계 · 파기 규칙", rules, DATA),
      panel(CX + w3c + 24, y, w3c, "JSON 블롭과 정본 모듈", blobs, DATA),
      panel(CX + 2*(w3c+24), y, w3c, "크로스컷 규칙", cross, DATA)]
y += max(hs) + 30
zone(dat_top - 4, y - dat_top - 8, "데이터 · 규칙", DATA)

# ── 6. 이음새 ────────────────────────────────────────────────────
seam_top = y
band(y, "IA 상의 이음새 15건", "지금의 정보구조가 답을 주지 못하는 질문들 — 대부분 버그가 아니라 “이 값의 집이 어디인가”가 정해지지 않은 자리")
y += 22
s1 = [
    ("i", "화면 × 역할 권한 매트릭스가 없다"),
    ("s", "역할로 UI 를 가리는 곳은 워크스페이스 설정 모달 한 곳뿐 — MEMBER 도 전체 삭제·공유 관리 버튼을 다 보고 서버 403 으로만 막힌다"),
    ("i", "데이터 수명이 세 갈래인데 한 표에 없다"),
    ("s", "① 소프트 4개 → 30일 → 영구  ② 나머지 38개 즉시 하드  ③ CollectRecord 는 보존정책 자동"),
    ("i", "프로젝트를 보관해도 공개 웨비나 면은 살아 있다"),
    ("s", "공개 웨비나 경로 전체에서 deletedAt 검사 0건 — 최대 30일간 신규 등록까지 받는다. 반면 공유 링크는 즉시 닫힌다"),
    ("i", "오류·빈 면이 불균일 · 전역 not-found 가 없다"),
    ("s", "error.tsx 는 6곳에만 — /utm-builder·/admin 은 상위 경계로 떨어진다"),
]
s2 = [
    ("i", "[slug] 가 두 개의 식별자 공간이다"),
    ("s", "앱 면 /webinar/{id} vs 공개 면 /webinar/{slug} — 같은 접두어, 다른 의미"),
    ("i", "“등록자”가 두 테이블을 가리킨다"),
    ("s", "/dashboard 는 CollectRecord 만, 웨비나 탭은 WebinarRegistration 만 — 정본 선언이 없다"),
    ("i", "UTM 규칙은 읽는 곳과 고치는 곳이 끊겨 있다"),
    ("s", "빌더는 소비만 하고 설정 모달로 가는 링크가 0건. 규칙은 워크스페이스, 링크는 프로젝트 스코프"),
    ("i", "숏링크는 생성만 있고 회수 경로가 없다"),
    ("s", "/r/[code] 는 조건 없이 리다이렉트 — UTM 링크를 지워도 영구히 산다"),
]
s3 = [
    ("i", "WebinarEmbedSite 는 프로젝트 자원인데 진입점이 웨비나 하나 안에 있다"),
    ("s", "A 의 배포 탭에서 노출 전환을 누르면 B 의 공개 노출이 조용히 끝난다"),
    ("i", "시청 화면의 정본이 필드 하나로 뒤집힌다"),
    ("s", "livePageUrl 이 있으면 고객 사이트, 없으면 자체 /live — 알려 주는 표시가 없다"),
    ("i", "위젯 보드는 실질적으로 도달 불가"),
    ("s", "모델·API·공개 면은 있는데 편집 UI 가 없다. 예약 리포트도 같다"),
    ("i", "공유 링크가 두 계통으로 병존한다"),
    ("s", "프로젝트 단위 2개 + 보드 단위 1개 — 세 번째는 위 때문에 도달 불가"),
]
hs = [panel(CX, y, w3c, "권한 · 수명 · 경계", s1, SEAM, count="4"),
      panel(CX + w3c + 24, y, w3c, "정본이 갈린 자리", s2, SEAM, count="4"),
      panel(CX + 2*(w3c+24), y, w3c, "소유가 어긋난 자리", s3, SEAM, count="4")]
y += max(hs) + 8
txt(CX, y + 14, "나머지 3건 = 인벤토리 감사가 잡은 누락(/webinar 목록 페이지 · GET/POST /api/webinars · 만들기·복제 모달) — 문서 §6.1 에 반영 완료",
    12, MUT)
y += 34
zone(seam_top - 4, y - seam_top - 12, "이음새", SEAM)

H = y + 42

# ── 헤더 + defs ──────────────────────────────────────────────────
head = []
head.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H:.0f}" '
            f'viewBox="0 0 {W} {H:.0f}" font-family="{FONT}">')
head.append(f'<defs><filter id="sh" x="-4%" y="-4%" width="108%" height="112%">'
            f'<feDropShadow dx="0" dy="1.5" stdDeviation="3" flood-color="#2A1F45" flood-opacity="0.07"/>'
            f'</filter>'
            f'<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
            f'<path d="M0 1 L9 5 L0 9 z" fill="{FAINT}"/></marker></defs>')
head.append(f'<rect width="{W}" height="{H:.0f}" fill="{GROUND}"/>')
# 헤더 조판
head.append(f'<text x="{M}" y="62" font-family="{FONT}" font-size="38" font-weight="800" fill="{INK}">'
            f'mach studio <tspan font-weight="400" fill="{MUT}">— 전체 정보구조</tspan></text>')
head.append(f'<text x="{M}" y="92" font-family="{MONO}" font-size="13" fill="{FAINT}">'
            f'커밋 c6d1dcd · feat/landing-links-timetable · 2026-07-27 · 코드에서 읽은 값만 적었다</text>')
stat = [("28","페이지"),("136","API 라우트"),("6","공개 핸들러"),("42","Prisma 모델"),
        ("46","lib 정본 모듈"),("약 190","면(surface)")]
sx = W - M
for n, l in reversed(stat):
    lw = max(tw(n, 24), tw(l, 11.5))
    sx -= lw + 34
    head.append(f'<text x="{sx+lw/2:.0f}" y="60" font-family="{FONT}" font-size="24" font-weight="700" '
                f'fill="{APP}" text-anchor="middle">{n}</text>')
    head.append(f'<text x="{sx+lw/2:.0f}" y="80" font-family="{FONT}" font-size="11.5" '
                f'fill="{FAINT}" text-anchor="middle" letter-spacing="0.6">{esc(l)}</text>')
head.append(f'<rect x="{M}" y="112" width="{W-2*M}" height="1.5" fill="{INK}" opacity="0.14"/>')

out[0] = "\n".join(head)
e(f'<text x="{M}" y="{H-16:.0f}" font-family="{FONT}" font-size="11.5" fill="{FAINT}">'
  f'문서 전문: docs/INFORMATION-ARCHITECTURE.md — 면 목록·라우트 인덱스·정본 모듈 지도 포함</text>')
e("</svg>")

io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "information-architecture.svg"), "w", encoding="utf-8").write("\n".join(out))
print("높이", int(H), "· 노드", len(out))
