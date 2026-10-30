"use client";

// 만들기 → 랜딩 페이지 — 외부 사이트(아임웹 등)에 임베드하는 상세페이지 편집.
// 모든 값은 config.landingPage 한 곳에 저장되고 공개 페이지(/webinar/[slug]/landing)가 그대로 렌더한다.
// 섹션은 "토글 ON + 실제 내용 있음"일 때만 공개 페이지에 노출된다(빈 껍데기 방지 — 읽기에서 걸러짐).

import { useId, useRef, useState } from "react";
import { ExternalLink, Clapperboard, Ban, Loader2, UploadCloud, Link2, Image as ImageIcon, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { useAutosave } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { Switch } from "@/components/ui/switch";
import {
  normalizeLandingPageConfig,
  isHttpUrl,
  DEFAULT_LANDING_COLORS,
  LANDING_BG_SECTIONS,
  type LandingColors,
  type LandingSectionBg,
  type LandingSectionBgMap,
  type LandingFaqItem,
  type LandingHighlightItem,
  type LandingJoinStep,
  type LandingAudienceItem,
  type LandingProgramItem,
  type LandingSponsorItem,
} from "@/lib/webinar-config";
import { LANDING_IMAGE_ACCEPT, LANDING_VIDEO_ACCEPT, validateLandingMedia } from "@/lib/webinar-landing-media";
import { SESSION_LOGO_ACCEPT, SESSION_LOGO_MAX_LABEL, validateSessionLogo } from "@/lib/webinar-speaker-photo";
import { FINISH, FIELD_CLS, JumpLink, Segmented, UrlField } from "@/components/ui/primitives";
import { EditableList, ROW_KEY, withRowKeys, stripRowKeys, type WithRowKey } from "@/components/ui/editable-list";
import { IMAGE_PRESETS, transformedImageUrl } from "@/lib/webinar-image";

// 입력 값은 프리미티브 한 곳에서 온다 — 예전엔 탭마다 로컬 선언이라 값이 3종으로 갈렸다.
const inputCls = FIELD_CLS;
const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

interface Webinar {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
}

type HeroMediaType = "none" | "image" | "video";

interface EditorState {
  enabled: boolean;
  heroMediaType: HeroMediaType;
  heroMediaUrl: string;
  brand: string;
  titleText: string; // 줄바꿈 = 히어로 타이틀 줄 나눔
  subtitle: string;
  venue: string;
  ctaLabel: string;
  /** 히어로 배경 미디어 위 어두운 스크림 세기(0~100) — 미디어가 있을 때만 의미가 있다. */
  heroOverlayOpacity: number;
  /** 히어로 대형 타이틀 자간(%) — 음수면 좁게. */
  heroTitleTracking: number;
  intro: { enabled: boolean; title: string; body: string; titleMobile: string; bodyMobile: string };
  /** 라이트·다크 두 모드의 배경 키컬러 */
  colors: LandingColors;
  /** 섹션별 배경 모드 */
  sectionBg: LandingSectionBgMap;
  sessionsEnabled: boolean;
  sessionsDetailPopup: boolean;
  timetableEnabled: boolean;
  /** 이런 분들께 추천합니다 — 머리글 문구까지 편집한다(이 섹션의 머리글이 곧 카피다). */
  audience: { enabled: boolean; title: string; items: WithRowKey<LandingAudienceItem>[] };
  programs: { enabled: boolean; items: WithRowKey<LandingProgramItem>[] };
  highlights: { enabled: boolean; title: string; items: WithRowKey<LandingHighlightItem>[] };
  join: { enabled: boolean; steps: WithRowKey<LandingJoinStep>[]; note: string };
  faq: { enabled: boolean; items: WithRowKey<LandingFaqItem>[] };
  /** 스폰서 — 최하단 로고 벽. 머리글은 행사마다 부르는 말이 달라 편집 가능하다. */
  sponsors: { enabled: boolean; title: string; items: WithRowKey<LandingSponsorItem>[] };
}

function toEditorState(config: Record<string, unknown>): EditorState {
  // keepEmptyRows: 편집 중에는 제목 없는 행도 살려둔다. 공개 렌더용 필터를 그대로 쓰면
  // 아직 제목을 안 쓴 행이 리마운트 때 사라지고, 다음 자동저장이 그 배열을 덮어써 DB 에서도 없어진다.
  const lp = normalizeLandingPageConfig(config, { keepEmptyRows: true });
  return {
    enabled: lp.enabled,
    heroMediaType: lp.heroMedia ? lp.heroMedia.type : "none",
    heroMediaUrl: lp.heroMedia?.url ?? "",
    brand: lp.brand,
    titleText: lp.titleLines.join("\n"),
    subtitle: lp.subtitle,
    venue: lp.venue,
    ctaLabel: lp.ctaLabel,
    heroOverlayOpacity: lp.heroOverlayOpacity,
    heroTitleTracking: lp.heroTitleTracking,
    intro: lp.intro,
    colors: lp.colors,
    sectionBg: lp.sectionBg,
    sessionsEnabled: lp.sessions.enabled,
    sessionsDetailPopup: lp.sessions.detailPopup,
    timetableEnabled: lp.timetable.enabled,
    // 이 네 목록은 스키마에 id 가 없다 → 편집 중에만 클라이언트 키를 붙인다(저장 시 제거).
    audience: { ...lp.audience, items: withRowKeys(lp.audience.items) },
    programs: { ...lp.programs, items: withRowKeys(lp.programs.items) },
    highlights: { ...lp.highlights, items: withRowKeys(lp.highlights.items) },
    join: { ...lp.join, steps: withRowKeys(lp.join.steps) },
    faq: { ...lp.faq, items: withRowKeys(lp.faq.items) },
    sponsors: { ...lp.sponsors, items: withRowKeys(lp.sponsors.items) },
  };
}

function toConfigPayload(s: EditorState) {
  return {
    enabled: s.enabled,
    heroMedia:
      s.heroMediaType !== "none" && s.heroMediaUrl.trim()
        ? { type: s.heroMediaType, url: s.heroMediaUrl.trim() }
        : null,
    brand: s.brand,
    titleLines: s.titleText.split("\n").map((line) => line.trim()).filter(Boolean),
    subtitle: s.subtitle,
    venue: s.venue,
    ctaLabel: s.ctaLabel,
    heroOverlayOpacity: s.heroOverlayOpacity,
    heroTitleTracking: s.heroTitleTracking,
    intro: s.intro,
    colors: s.colors,
    sectionBg: s.sectionBg,
    sessions: { enabled: s.sessionsEnabled, detailPopup: s.sessionsDetailPopup },
    timetable: { enabled: s.timetableEnabled },
    audience: { ...s.audience, items: stripRowKeys(s.audience.items) },
    programs: { ...s.programs, items: stripRowKeys(s.programs.items) },
    highlights: { ...s.highlights, items: stripRowKeys(s.highlights.items) },
    join: { ...s.join, steps: stripRowKeys(s.join.steps) },
    faq: { ...s.faq, items: stripRowKeys(s.faq.items) },
    sponsors: { ...s.sponsors, items: stripRowKeys(s.sponsors.items) },
  };
}

/**
 * 배경 키컬러 하나. 견본·hex·되돌리기를 한 줄에 둔다.
 *
 * 색 견본만은 포커스 링을 **감싼 쪽**에 그린다 — 실제 <input type=color> 는 opacity-0 으로
 * 견본 위에 덮여 있어서, 전역 focus-visible 링이 투명 요소와 함께 사라진다.
 * (BrandSection 이 같은 이유로 같은 구조를 쓴다 — 두 색 편집기의 조작감을 맞춘다.)
 */
function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  fallback: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3">
      <div className="relative rounded-lg focus-within:[outline:2px_solid_var(--ring)] focus-within:[outline-offset:2px]">
        <div className="h-9 w-9 rounded-lg shadow-sm" style={{ backgroundColor: value }} />
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-xs font-medium">{label}</label>
        <p className="font-mono text-xs text-muted-foreground">{value}</p>
      </div>
      {value.toLowerCase() !== fallback.toLowerCase() ? (
        <button
          type="button"
          onClick={() => onChange(fallback)}
          className="ml-auto text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          기본값
        </button>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  hint,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl bg-card p-4 sm:p-5 ${FINISH.s1}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
        {onToggle && (
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            표시
            <Switch checked={enabled ?? false} onChange={onToggle} label={`${title} 표시`} />
          </label>
        )}
      </div>
      {children && <div className="mt-4 space-y-3">{children}</div>}
    </section>
  );
}


const MEDIA_TYPES: { id: HeroMediaType; label: string; icon: typeof Ban }[] = [
  { id: "none", label: "없음", icon: Ban },
  { id: "image", label: "이미지", icon: ImageIcon },
  { id: "video", label: "동영상", icon: Clapperboard },
];

export default function LandingPageTab({
  webinar,
  onSilentUpdate,
  onGoToSource,
  onGoToDeploy,
  confirmLiveOff,
}: {
  webinar: Webinar;
  onSilentUpdate: () => void;
  /** 안내 문구가 가리키는 곳으로 실제로 데려간다 — 문장만 남기면 사용자가 경로를 손으로 찾는다. */
  onGoToSource?: () => void;
  onGoToDeploy?: () => void;
  /**
   * 라이브 중 "끄는" 변경에 확인을 붙인다 — 켜는 쪽은 시청자에게 더 주는 변경이라 통과.
   * 껍데기가 시청자 수를 알고 있어서 문구에 실제 인원이 들어간다.
   */
  confirmLiveOff?: (what: string, effect: string) => Promise<boolean>;
}) {
  const uid = useId();
  const [state, setState] = useState<EditorState>(() => toEditorState(webinar.config));
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * 스폰서 로고 업로드 — 파일 입력은 **행마다 두지 않고 섹션에 하나만** 둔다.
   * 어느 행이 눌렀는지는 ref 로 기억한다: 행이 드래그로 순서가 바뀌거나 지워져도 ROW_KEY 는
   * 그대로라 응답이 늦게 와도 엉뚱한 행에 URL 이 꽂히지 않는다(인덱스로 기억하면 그 사고가 난다).
   */
  const sponsorFileRef = useRef<HTMLInputElement>(null);
  const sponsorTargetKey = useRef<string | null>(null);
  const [sponsorUploadingKey, setSponsorUploadingKey] = useState<string | null>(null);

  const patch = (updates: Partial<EditorState>) => setState((prev) => ({ ...prev, ...updates }));

  /**
   * 로고 업로드는 세션 로고 라우트를 그대로 쓴다 — 형식·한도·저장 경로(logos/)가 완전히 같고,
   * 그 규칙은 webinar-speaker-photo.ts 한 곳이 소유한다. 네 번째 복제 라우트를 만들면
   * 한쪽만 고쳐져 갈라진다(랜딩 미디어가 실제로 그렇게 5MB 로 갈라져 있다).
   */
  const uploadSponsorLogo = async (file: File, rowKey: string) => {
    const validationError = validateSessionLogo(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSponsorUploadingKey(rowKey);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/webinars/${webinar.id}/session-logo`, { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.url !== "string") {
        toast.error(data?.error ?? "로고 업로드에 실패했어요.");
        return;
      }
      setState((prev) => ({
        ...prev,
        sponsors: {
          ...prev.sponsors,
          items: prev.sponsors.items.map((it) => (it[ROW_KEY] === rowKey ? { ...it, logoUrl: data.url } : it)),
        },
      }));
      toast.success("로고를 올렸어요");
    } catch {
      // catch 가 반드시 있어야 한다 — try/finally 뿐이면 네트워크 실패가 unhandled rejection 으로
      // 사라지고 운영자는 "눌렀는데 아무 일도 없다" 만 본다(히어로 업로드와 같은 이유).
      toast.error("업로드 중 문제가 생겼어요. 연결을 확인하고 다시 시도해주세요.");
    } finally {
      setSponsorUploadingKey(null);
      sponsorTargetKey.current = null;
      if (sponsorFileRef.current) sponsorFileRef.current.value = "";
    }
  };

  // 히어로 배경 파일 업로드 — 성공하면 URL 필드를 채우고 자동저장이 이어서 영속화한다
  const uploadHeroMedia = async (file: File) => {
    const validationError = validateLandingMedia(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setIsUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(`/api/webinars/${webinar.id}/landing-media`, { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        toast.error(data?.error ?? "업로드에 실패했어요.");
        return;
      }
      patch({ heroMediaType: data.type === "video" ? "video" : "image", heroMediaUrl: data.url });
      toast.success("업로드했어요");
    } catch {
      // try/finally 만 있으면 네트워크 실패가 unhandled rejection 으로 사라져
      // 어드민은 "눌렸는데 아무 일도 없다" 만 본다.
      toast.error("업로드 중 문제가 생겼어요. 연결을 확인하고 다시 시도해주세요.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const { state: saveState, retry } = useAutosave(state, async (value) => {
    const res = await fetch(`/api/webinars/${webinar.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { landingPage: toConfigPayload(value) } }),
      keepalive: true, // 페이지 이탈 중 flush 도 서버에 도달하도록 (탭 닫기 시 마지막 편집 유실 방지)
    });
    if (res.ok) onSilentUpdate();
    else toast.error("랜딩 페이지 저장에 실패했어요. 잠시 후 다시 시도돼요.");
    return res.ok;
  });
  // 표시는 껍데기 한 곳에서 그린다(만들기 화면당 1개) — 저장 경로는 그대로 각자.
  useReportAutosave(saveState, retry);

  /**
   * 미리보기는 **껍데기(PageSetupTab)의 인접 패널이 소유한다.**
   *
   * 이 탭이 자기 미리보기 열(440px)을 따로 들고 있었는데, 껍데기에 인접 미리보기가 생기면서
   * 한 화면에 미리보기가 두 개 겹쳤다 — 실측에서 편집 열이 130px 로 눌려 "연/사/카/드" 처럼
   * 한 글자씩 줄바꿈됐다. 껍데기 패널이 같은 /landing URL 을 (기기 전환 + 축소율 표시까지)
   * 보여주므로 이쪽을 지운다. 저장 후 갱신도 그쪽이 saving→saved 전이로 한다.
   * 남은 previewUrl 은 "새 탭에서 미리보기" 링크 전용 — 패널을 접었을 때의 유일한 출구다.
   */
  const previewUrl = `/webinar/${webinar.slug}/landing?preview=1`;

  const setRows = <K extends "audience" | "programs" | "highlights" | "faq" | "sponsors">(key: K, items: EditorState[K]["items"]) =>
    setState((prev) => ({ ...prev, [key]: { ...prev[key], items } }));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl">
        <div className="min-w-0 space-y-4">
          {/* 상단: 공개 스위치 + 저장 상태 + 미리보기 */}
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4 sm:p-5 ${FINISH.s1}`}>
            <div className="flex items-center gap-3">
              <Switch
                checked={state.enabled}
                onChange={(v) => {
                  // 끌 때만 확인 — 라이브 중이면 임베드된 등록 폼이 그 순간 비공개 안내로 바뀐다.
                  if (v || !confirmLiveOff) { patch({ enabled: v }); return; }
                  void confirmLiveOff("랜딩 페이지 공개", "링크와 임베드가 비공개 안내로 바뀌어요.").then((ok) => {
                    if (ok) patch({ enabled: false });
                  });
                }}
                label="랜딩 페이지 공개"
              />
              <div>
                <p className="text-sm font-semibold">{state.enabled ? "공개 중" : "비공개"}</p>
                <p className="text-xs text-muted-foreground">
                  {state.enabled ? (
                    <>
                      링크와 임베드로 접근할 수 있어요. 임베드 코드는{" "}
                      {onGoToDeploy ? <JumpLink onClick={onGoToDeploy}>배포</JumpLink> : "배포 탭"}에서 복사하세요.
                    </>
                  ) : (
                    "끄면 링크·임베드 모두 비공개 안내만 보여요."
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener"
                className={`inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium transition-colors hover:text-violet-500 ${FINISH.control}`}
              >
                <ExternalLink className="h-3.5 w-3.5" /> 새 탭에서 미리보기
              </a>
            </div>
          </div>

          {/* 배경 — 섹션 단위 모드 + 두 모드의 배경 키컬러.
              전체에 영향하는 값이라 히어로보다 위에 둔다(원인이 결과보다 먼저 온다). */}
          <SectionCard
            title="배경"
            hint="섹션마다 화이트·다크를 고르고, 두 모드의 배경색을 정해요. 글자·카드·선 색은 배경에서 자동으로 따라옵니다."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField
                id={`${uid}-bg-light`}
                label="화이트 모드 배경"
                value={state.colors.lightBg}
                fallback={DEFAULT_LANDING_COLORS.lightBg}
                onChange={(lightBg) => patch({ colors: { ...state.colors, lightBg } })}
              />
              <ColorField
                id={`${uid}-bg-dark`}
                label="다크 모드 배경"
                value={state.colors.darkBg}
                fallback={DEFAULT_LANDING_COLORS.darkBg}
                onChange={(darkBg) => patch({ colors: { ...state.colors, darkBg } })}
              />
            </div>

            <div className="mt-4 space-y-1.5">
              <p className={labelCls}>섹션별 모드</p>
              {LANDING_BG_SECTIONS.map((sec) => (
                <div
                  key={sec.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{sec.label}</p>
                    {sec.note ? <p className="text-xs text-muted-foreground">{sec.note}</p> : null}
                  </div>
                  <Segmented
                    label={`${sec.label} 배경 모드`}
                    value={state.sectionBg[sec.key]}
                    onChange={(next) =>
                      patch({ sectionBg: { ...state.sectionBg, [sec.key]: next as LandingSectionBg } })
                    }
                    options={[
                      { value: "light" as LandingSectionBg, label: "화이트" },
                      { value: "dark" as LandingSectionBg, label: "다크" },
                    ]}
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 히어로 */}
          <SectionCard title="히어로" hint="첫 화면 — 비워두면 웨비나 이름·설명·일시가 자동으로 들어가요.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-brand`} className={labelCls}>브랜드 라벨</label>
                <input id={`${uid}-brand`} className={inputCls} value={state.brand} onChange={(e) => patch({ brand: e.target.value })} placeholder={webinar.name} />
              </div>
              <div>
                <label htmlFor={`${uid}-venue`} className={labelCls}>일시 옆 라벨</label>
                <input id={`${uid}-venue`} className={inputCls} value={state.venue} onChange={(e) => patch({ venue: e.target.value })} placeholder="ONLINE LIVE" />
              </div>
            </div>
            <div>
              <div className="flex items-end justify-between gap-3">
                <label htmlFor={`${uid}-title`} className={labelCls}>대형 타이틀 (줄바꿈 = 줄 나눔)</label>
                <label htmlFor={`${uid}-title-tracking`} className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                  자간
                  <input
                    id={`${uid}-title-tracking`}
                    type="number"
                    step={0.5}
                    min={-20}
                    max={20}
                    value={state.heroTitleTracking}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      patch({ heroTitleTracking: Number.isFinite(n) ? Math.min(20, Math.max(-20, n)) : state.heroTitleTracking });
                    }}
                    className={`${inputCls} w-16 min-h-8 px-2 py-1 text-[11px] tabular-nums`}
                  />
                  %
                </label>
              </div>
              <textarea
                id={`${uid}-title`}
                className={`${inputCls} resize-none`}
                rows={2}
                value={state.titleText}
                onChange={(e) => patch({ titleText: e.target.value })}
                placeholder={webinar.name}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">자간은 음수면 좁게, 양수면 넓게 — 기본값은 -5.5예요.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-sub`} className={labelCls}>부제</label>
                <input
                  id={`${uid}-sub`}
                  className={inputCls}
                  value={state.subtitle}
                  onChange={(e) => patch({ subtitle: e.target.value })}
                  placeholder={(webinar.description ?? "").split("\n")[0] || "부제를 입력하세요"}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-cta`} className={labelCls}>등록 버튼 문구</label>
                <input id={`${uid}-cta`} className={inputCls} value={state.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} placeholder="사전 등록하기" />
              </div>
            </div>
            <div>
              <label className={labelCls}>배경 미디어</label>
              <div className="flex flex-wrap items-center gap-2">
                {/* 선택 칸이 bg-violet-500 + 흰 글자였다 — 그건 Btn tone="key", 즉 **주요 버튼**의
                    모양이다. 세그먼트 칸은 액션이 아니라 상태라서 잘못된 신호였고, 선택 관용구도
                    한 개 더 늘리고 있었다. SELECTED 를 쓰는 Segmented 로 흡수. */}
                <Segmented
                  label="배경 미디어"
                  value={state.heroMediaType}
                  onChange={(next) => patch({ heroMediaType: next })}
                  options={MEDIA_TYPES.map((m) => {
                    const Icon = m.icon;
                    return {
                      value: m.id,
                      label: (<><Icon className="h-3.5 w-3.5" /> {m.label}</>),
                    };
                  })}
                />
                {state.heroMediaType !== "none" && (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className={`inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium transition-colors hover:text-violet-500 disabled:opacity-50 ${FINISH.control}`}
                    >
                      {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                      {isUploading ? "올리는 중…" : "파일 올리기"}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={state.heroMediaType === "video" ? LANDING_VIDEO_ACCEPT : LANDING_IMAGE_ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) void uploadHeroMedia(file);
                      }}
                    />
                    {/* 스킴 없는 URL 은 정규화가 통째로 버린다(임베드 XSS 방어) — 그대로 두면
                        배경이 조용히 안 나오고, 다음 리마운트 때 칸이 비면서 자동저장이 그 빈 값을
                        영구 저장한다(실측). UrlField 가 blur 에 https:// 를 붙이고 안 되면 알린다. */}
                    <UrlField
                      label="히어로 배경 미디어 URL"
                      value={state.heroMediaUrl}
                      onChange={(heroMediaUrl) => patch({ heroMediaUrl })}
                      placeholder={state.heroMediaType === "video" ? "또는 URL 붙여넣기 — https://… (mp4)" : "또는 URL 붙여넣기 — https://… (jpg·png)"}
                      leadingIcon={<Link2 className="h-3.5 w-3.5" />}
                      isValidHttpUrl={isHttpUrl}
                      className="flex-1 min-w-[220px]"
                    />
                  </>
                )}
              </div>
              {state.heroMediaType !== "none" && state.heroMediaUrl.trim() && (
                <>
                  <div className={`mt-2 overflow-hidden rounded-xl bg-black/40 ${FINISH.s2}`}>
                    {state.heroMediaType === "video" ? (
                      <video src={state.heroMediaUrl} className="h-28 w-full object-cover" muted loop autoPlay playsInline />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- 어드민 미리보기(임의 호스트 URL)
                      <img src={transformedImageUrl(state.heroMediaUrl, IMAGE_PRESETS.adminHeroPreview)} alt="배경 미리보기" className="h-28 w-full object-cover" />
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2.5">
                    <label htmlFor={`${uid}-hero-overlay`} className="shrink-0 text-xs text-muted-foreground">배경 어둡기</label>
                    <input
                      id={`${uid}-hero-overlay`}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={state.heroOverlayOpacity}
                      onChange={(e) => patch({ heroOverlayOpacity: Number(e.target.value) })}
                      className="flex-1 accent-violet-500"
                    />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{state.heroOverlayOpacity}%</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    글자가 배경 위에서 읽히도록 까는 어두운 막이에요 — 낮출수록 사진·영상이 밝게 보여요.
                  </p>
                </>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                이미지 5MB·동영상 50MB까지. 없으면 키컬러 그라디언트가 배경이 돼요. 동영상은 자동재생·음소거·반복으로 깔려요.
              </p>
            </div>
          </SectionCard>

          {/* 소개 */}
          <SectionCard
            title="소개"
            hint="히어로 다음의 한 문단 — 비우면 웨비나 설명이 그대로 들어가요. PC·모바일은 줄바꿈이 필요한 위치가 다를 수 있어 따로 적어요(모바일 칸을 비우면 PC와 같은 문구가 나가요)."
            enabled={state.intro.enabled}
            onToggle={(v) => patch({ intro: { ...state.intro, enabled: v } })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-intro-title`} className={labelCls}>제목 · PC (줄바꿈 = 줄 나눔)</label>
                <textarea
                  id={`${uid}-intro-title`}
                  className={`${inputCls} resize-none`}
                  rows={2}
                  value={state.intro.title}
                  onChange={(e) => patch({ intro: { ...state.intro, title: e.target.value } })}
                  placeholder={(webinar.description ?? "").split("\n")[0] || "소개 제목"}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-intro-title-mobile`} className={labelCls}>제목 · 모바일</label>
                <textarea
                  id={`${uid}-intro-title-mobile`}
                  className={`${inputCls} resize-none`}
                  rows={2}
                  value={state.intro.titleMobile}
                  onChange={(e) => patch({ intro: { ...state.intro, titleMobile: e.target.value } })}
                  placeholder={state.intro.title || (webinar.description ?? "").split("\n")[0] || "소개 제목"}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-intro-body`} className={labelCls}>본문 · PC (줄바꿈 유지)</label>
                <textarea
                  id={`${uid}-intro-body`}
                  className={`${inputCls} resize-y`}
                  rows={3}
                  value={state.intro.body}
                  onChange={(e) => patch({ intro: { ...state.intro, body: e.target.value } })}
                  placeholder={webinar.description ?? ""}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-intro-body-mobile`} className={labelCls}>본문 · 모바일 (줄바꿈 유지)</label>
                <textarea
                  id={`${uid}-intro-body-mobile`}
                  className={`${inputCls} resize-y`}
                  rows={3}
                  value={state.intro.bodyMobile}
                  onChange={(e) => patch({ intro: { ...state.intro, bodyMobile: e.target.value } })}
                  placeholder={state.intro.body || webinar.description || ""}
                />
              </div>
            </div>
          </SectionCard>

          {/* 세션 · 타임테이블 */}
          {/* hint 와 아래 문단이 "세션에서 관리해요" 를 똑같이 두 번 말하고 있었다 — 한 번만, 대신 누를 수 있게. */}
          <SectionCard title="세션 · 타임테이블" hint="여기서는 랜딩 노출만 켜고 끕니다.">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm ${FINISH.s2}`}>
                연사 카드 (세션 소개)
                <Switch checked={state.sessionsEnabled} onChange={(v) => patch({ sessionsEnabled: v })} label="연사 카드 표시" />
              </label>
              <label className={`flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm ${FINISH.s2}`}>
                타임테이블
                <Switch checked={state.timetableEnabled} onChange={(v) => patch({ timetableEnabled: v })} label="타임테이블 표시" />
              </label>
            </div>
            <label className={`flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm ${FINISH.s2} transition-opacity ${state.sessionsEnabled ? "" : "opacity-50"}`}>
              <span>
                카드 클릭 시 상세 팝업
                <span className="mt-0.5 block text-[11px] text-muted-foreground">주제·세션 내용·연사 사진·소속·약력을 팝업으로 보여줘요.</span>
              </span>
              <Switch checked={state.sessionsDetailPopup} onChange={(v) => patch({ sessionsDetailPopup: v })} disabled={!state.sessionsEnabled} label="상세 팝업 열기" />
            </label>
            <p className="text-[11px] text-muted-foreground">
              내용(소속·직책·약력 포함)은{" "}
              {onGoToSource ? <JumpLink onClick={onGoToSource}>원본 정보 › 세션</JumpLink> : "원본 정보 › 세션"}에서
              관리해요. 이 구간에서 배경이 키컬러로 전환돼요.
            </p>
          </SectionCard>

          {/* 프로그램 */}
          <SectionCard
            title="프로그램"
            hint="무엇을 다루는지 2열 카드로 — 제목이 있는 항목만 노출돼요."
            enabled={state.programs.enabled}
            onToggle={(v) => patch({ programs: { ...state.programs, enabled: v } })}
          >
            <EditableList
              listId="lp-programs" itemNoun="프로그램" reorderable
              items={state.programs.items} onChange={(next) => setRows("programs", next)}
              rowKey={(r) => r[ROW_KEY]}
              makeItem={() => ({ icon: "", title: "", description: "", [ROW_KEY]: crypto.randomUUID() })}
              addLabel="프로그램 추가" emptyState={<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">아직 프로그램이 없어요. 아래에서 추가하면 랜딩 페이지에 표시돼요.</p>}
              renderRow={({ item, patch: p }) => (
                <>
                  <div className="flex gap-2">
                    {/* 제목이 먼저다 — 이 값이 공개 노출을 가른다(제목이 비면 카드가 아예 안 나간다).
                        배지는 선택값이라 뒤로. 폭은 **래퍼가 갖는다**: inputCls(FIELD_CLS)에 이미
                        w-full 이 있어서 입력에 w-24 를 덧붙여도 무효다(컴파일된 CSS 에서 .w-full 이
                        뒤에 와서 이긴다). 그래서 배지가 행을 다 먹고 제목이 24px 조각으로 밀려
                        **입력할 수 없는 칸**이 돼 있었다(실측: 624px vs 24px). */}
                    <input aria-label="프로그램 제목" className={inputCls} value={item.title} onChange={(e) => p({ title: e.target.value })} placeholder="제목 (필수 — 비우면 공개 페이지에 안 나와요)" />
                    <div className="w-24 shrink-0">
                      <input aria-label="프로그램 배지" className={inputCls} value={item.icon} onChange={(e) => p({ icon: e.target.value })} placeholder="배지" />
                    </div>
                  </div>
                  <textarea aria-label="프로그램 설명" className={`${inputCls} resize-none`} rows={2} value={item.description} onChange={(e) => p({ description: e.target.value })} placeholder="설명 (줄바꿈 유지)" />
                </>
              )}
            />
          </SectionCard>

          {/* 이런 분들께 추천합니다 */}
          <SectionCard
            title="이런 분들께 추천합니다"
            hint="방문자가 '내 얘기인가' 를 3초 안에 판별하는 자리 — 대상·상황을 한 줄씩. 머리글도 바꿀 수 있어요."
            enabled={state.audience.enabled}
            onToggle={(v) => patch({ audience: { ...state.audience, enabled: v } })}
          >
            {/* 머리글 — 다른 섹션은 영문 고정(Programs·FAQ)인데 이 섹션만 편집 가능하다.
                머리글 자체가 카피라서다("이런 분들께 추천합니다" / "이런 고민이 있다면"). */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="lp-audience-title">머리글</label>
              <input
                id="lp-audience-title"
                className={inputCls}
                value={state.audience.title}
                onChange={(e) => patch({ audience: { ...state.audience, title: e.target.value } })}
                placeholder="이런 분들께 추천합니다 (비우면 이 문구가 나가요)"
              />
            </div>
            <EditableList
              listId="lp-audience" itemNoun="대상" reorderable
              items={state.audience.items} onChange={(next) => setRows("audience", next)}
              rowKey={(r) => r[ROW_KEY]}
              makeItem={() => ({ icon: "", title: "", description: "", [ROW_KEY]: crypto.randomUUID() })}
              addLabel="대상 추가"
              emptyState={<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">아직 추천 대상이 없어요. 아래에서 추가하면 랜딩 페이지에 표시돼요.</p>}
              renderRow={({ item, patch: p }) => (
                <>
                  <div className="flex gap-2">
                    {/* 폭은 래퍼가 갖는다 — inputCls(FIELD_CLS)에 이미 w-full 이 있어서 입력에
                        w-16 을 덧붙이면 무효다(컴파일된 CSS 에서 .w-full 이 뒤에 와 이긴다). */}
                    <input aria-label="추천 대상" className={inputCls} value={item.title} onChange={(e) => p({ title: e.target.value })} placeholder="대상·상황 (필수 — 비우면 공개 페이지에 안 나와요)" />
                    <div className="w-16 shrink-0">
                      <input aria-label="아이콘" className={inputCls} value={item.icon} onChange={(e) => p({ icon: e.target.value })} placeholder="✓" />
                    </div>
                  </div>
                  <textarea aria-label="추천 대상 설명" className={`${inputCls} resize-none`} rows={2} value={item.description} onChange={(e) => p({ description: e.target.value })} placeholder="부연 설명 (선택 · 줄바꿈 유지)" />
                </>
              )}
            />
          </SectionCard>

          {/* 혜택 */}
          <SectionCard
            title="혜택"
            hint="참여하면 얻어가는 것 3~4가지 — 번호(01·02·…)는 자동으로 붙어요. 참여 방법 바로 위, 키컬러 구간에 표시돼요."
            enabled={state.highlights.enabled}
            onToggle={(v) => patch({ highlights: { ...state.highlights, enabled: v } })}
          >
            {/* 머리글 — audience 와 같은 이유로 편집 가능하다: 머리글 자체가 카피다
                ("참여하면 얻어가는 것" / "이 30분으로 가져갈 것"). */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="lp-highlights-title">머리글</label>
              <input
                id="lp-highlights-title"
                className={inputCls}
                value={state.highlights.title}
                onChange={(e) => patch({ highlights: { ...state.highlights, title: e.target.value } })}
                placeholder="참여하면 얻어가는 것 (비우면 이 문구가 나가요)"
              />
            </div>
            <EditableList
              listId="lp-highlights" itemNoun="혜택" reorderable
              items={state.highlights.items} onChange={(next) => setRows("highlights", next)}
              rowKey={(r) => r[ROW_KEY]}
              makeItem={() => ({ title: "", description: "", [ROW_KEY]: crypto.randomUUID() })}
              addLabel="혜택 추가" emptyState={<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">아직 혜택이 없어요. 아래에서 추가하면 랜딩 페이지에 표시돼요.</p>}
              renderRow={({ item, index, patch: p }) => (
                <>
                  {/* 번호(01·02)는 입력값이 아니라 렌더 순서에서 파생 — 드래그로 순서를 바꾸면 즉시 재계산된다 */}
                  <input aria-label="하이라이트 제목" className={inputCls} value={item.title} onChange={(e) => p({ title: e.target.value })} placeholder={`제목 (${String(index + 1).padStart(2, "0")})`} />
                  <textarea aria-label="하이라이트 설명" className={`${inputCls} resize-none`} rows={2} value={item.description} onChange={(e) => p({ description: e.target.value })} placeholder="설명" />
                </>
              )}
            />
          </SectionCard>

          {/* 참여 방법 */}
          <SectionCard
            title="참여 방법"
            hint="Step 1·2·3 — 온라인 웨비나 공통 절차가 기본으로 채워져 있어요."
            enabled={state.join.enabled}
            onToggle={(v) => patch({ join: { ...state.join, enabled: v } })}
          >
            <EditableList
              listId="lp-join" itemNoun="단계" reorderable
              items={state.join.steps} onChange={(steps) => patch({ join: { ...state.join, steps } })}
              rowKey={(r) => r[ROW_KEY]}
              makeItem={() => ({ title: "", description: "", [ROW_KEY]: crypto.randomUUID() })}
              addLabel="단계 추가" emptyState={<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">아직 단계이 없어요. 아래에서 추가하면 랜딩 페이지에 표시돼요.</p>}
              renderRow={({ item, index, patch: p }) => (
                <>
                  {/* 다른 목록과 같은 안내를 준다 — 제목이 비면 그 단계가 빠지고, 남은 단계가
                      없으면 **참여 방법 섹션이 통째로 사라진다.** 이 칸만 안내가 없어서
                      "다 지웠는데 왜 섹션이 없어졌는지" 알 길이 없었다. */}
                  <input aria-label="참여 단계 제목" className={inputCls} value={item.title} onChange={(e) => p({ title: e.target.value })} placeholder={`Step ${index + 1} 제목 (필수 — 비우면 공개 페이지에 안 나와요)`} />
                  <textarea aria-label="참여 단계 설명" className={`${inputCls} resize-none`} rows={2} value={item.description} onChange={(e) => p({ description: e.target.value })} placeholder="설명" />
                </>
              )}
            />
            <div>
              <label htmlFor={`${uid}-join-note`} className={labelCls}>단계 아래 마감 안내 문구</label>
              <input
                id={`${uid}-join-note`}
                className={inputCls}
                value={state.join.note}
                onChange={(e) => patch({ join: { ...state.join, note: e.target.value } })}
                placeholder="라이브 시작 · 사전 등록 후 입장 안내를 보내드려요"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                날짜·시각({state.join.enabled ? "예: 2026. 08. 11. (화) 14:00 KST" : "일정"})은 항상 자동으로 앞에 굵게 붙어요 — 여기는 그 뒤에 붙는 문구만 바꿔요.
              </p>
            </div>
          </SectionCard>

          {/* FAQ */}
          <SectionCard
            title="FAQ"
            hint="같은 카테고리끼리 탭으로 묶여요. 질문이 있는 항목만 노출돼요."
            enabled={state.faq.enabled}
            onToggle={(v) => patch({ faq: { ...state.faq, enabled: v } })}
          >
            <EditableList
              listId="lp-faq" itemNoun="질문" reorderable
              items={state.faq.items} onChange={(next) => setRows("faq", next)}
              rowKey={(r) => r[ROW_KEY]}
              makeItem={() => ({ category: "참가신청", question: "", answer: "", [ROW_KEY]: crypto.randomUUID() })}
              addLabel="질문 추가" emptyState={<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">아직 질문이 없어요. 아래에서 추가하면 랜딩 페이지에 표시돼요.</p>}
              renderRow={({ item, patch: p }) => (
                <>
                  <div className="flex gap-2">
                    {/* 질문이 먼저다 — 이 값이 공개 노출을 가른다. 폭은 래퍼가 갖는다(위 프로그램 주석 참고). */}
                    <input aria-label="FAQ 질문" className={inputCls} value={item.question} onChange={(e) => p({ question: e.target.value })} placeholder="질문 (필수 — 비우면 공개 페이지에 안 나와요)" />
                    <div className="w-28 shrink-0">
                      <input aria-label="FAQ 카테고리" className={inputCls} value={item.category} onChange={(e) => p({ category: e.target.value })} placeholder="분류" />
                    </div>
                  </div>
                  <textarea aria-label="FAQ 답변" className={`${inputCls} resize-none`} rows={2} value={item.answer} onChange={(e) => p({ answer: e.target.value })} placeholder="답변 (줄바꿈 유지)" />
                </>
              )}
            />
          </SectionCard>

          {/* 스폰서 — 페이지 최하단 */}
          <SectionCard
            title="스폰서"
            hint="페이지 맨 아래 로고 벽이에요. 구분(주최·주관·후원)을 적으면 같은 구분끼리 묶여서 나가요. 이름이 있는 항목만 노출돼요."
            enabled={state.sponsors.enabled}
            onToggle={(v) => patch({ sponsors: { ...state.sponsors, enabled: v } })}
          >
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="lp-sponsors-title">머리글</label>
              <input
                id="lp-sponsors-title"
                className={inputCls}
                value={state.sponsors.title}
                onChange={(e) => patch({ sponsors: { ...state.sponsors, title: e.target.value } })}
                placeholder="Sponsors (비우면 이 문구가 나가요)"
              />
            </div>
            {/* 파일 입력은 섹션에 하나 — 어느 행이 눌렀는지는 sponsorTargetKey 가 기억한다. */}
            <input
              ref={sponsorFileRef}
              type="file"
              accept={SESSION_LOGO_ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                const key = sponsorTargetKey.current;
                if (file && key) void uploadSponsorLogo(file, key);
              }}
            />
            <EditableList
              listId="lp-sponsors" itemNoun="스폰서" reorderable
              items={state.sponsors.items}
              onChange={(next) =>
                setState((prev) => ({
                  ...prev,
                  // 첫 행이 생기면 토글도 같이 켠다. 이 섹션만 기본 OFF 라(기존 웨비나에 거짓
                  // 경고를 안 만들려고 — webinar-config.ts 주석), 안 켜 주면 "추가했는데 안 나온다"
                  // 가 된다. 0 → 1 일 때만 — 일부러 끈 뒤 행을 고치는 것까지 되살리지 않는다.
                  sponsors: {
                    ...prev.sponsors,
                    enabled: prev.sponsors.enabled || (prev.sponsors.items.length === 0 && next.length > 0),
                    items: next,
                  },
                }))
              }
              rowKey={(r) => r[ROW_KEY]}
              makeItem={() => ({ tier: "", name: "", logoUrl: "", url: "", [ROW_KEY]: crypto.randomUUID() })}
              addLabel="스폰서 추가"
              emptyState={<p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">아직 스폰서가 없어요. 아래에서 추가하면 페이지 맨 아래에 로고가 표시돼요.</p>}
              renderRow={({ item, patch: p }) => {
                const rowKey = item[ROW_KEY];
                const busy = sponsorUploadingKey === rowKey;
                return (
                  <div className="flex items-stretch gap-2">
                    {/* 로고 칸이 곧 업로드 버튼이다 — 별도 '파일 올리기' 버튼을 두면 행이 한 줄 더 길어지고,
                        지금 무엇이 올라가 있는지와 바꾸는 자리가 떨어진다. 판은 흰색: 투명 PNG 로고가
                        대부분이라 어두운 어드민 배경에서는 판 없이 보이지 않는다. */}
                    <button
                      type="button"
                      onClick={() => {
                        sponsorTargetKey.current = rowKey;
                        sponsorFileRef.current?.click();
                      }}
                      disabled={busy}
                      title={`${item.name.trim() || "이 스폰서"} 로고 ${item.logoUrl ? "바꾸기" : "올리기"}`}
                      className={`grid w-24 shrink-0 place-items-center rounded-lg bg-white p-1.5 transition-opacity hover:opacity-80 disabled:opacity-50 ${FINISH.hairlineOut}`}
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin text-neutral-500" />
                      ) : item.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 어드민 미리보기(임의 호스트 URL)
                        <img
                          src={transformedImageUrl(item.logoUrl, IMAGE_PRESETS.adminThumb)}
                          alt={`${item.name.trim() || "스폰서"} 로고 미리보기`}
                          className="h-9 w-full object-contain"
                        />
                      ) : (
                        <span className="flex flex-col items-center gap-0.5 text-neutral-500">
                          <ImagePlus className="h-4 w-4" />
                          <span className="text-[10px] font-medium">로고</span>
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex gap-2">
                        {/* 이름이 먼저다 — 이 값이 공개 노출을 가르고, 로고 이미지의 대체 텍스트도 된다.
                            폭은 래퍼가 갖는다(inputCls 의 w-full 이 이긴다 — 위 프로그램 주석 참고). */}
                        <input aria-label="스폰서 이름" className={inputCls} value={item.name} onChange={(e) => p({ name: e.target.value })} placeholder="이름 (필수 — 비우면 공개 페이지에 안 나와요)" />
                        <div className="w-24 shrink-0">
                          <input aria-label="스폰서 구분" className={inputCls} value={item.tier} onChange={(e) => p({ tier: e.target.value })} placeholder="구분" />
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {/* 로고 URL 을 칸으로 남겨 둔다 — 외부 이미지 붙여넣기와 **로고 지우기**가
                            둘 다 이 칸 하나로 된다(비우면 이름 글자 칩으로 나간다). */}
                        <UrlField
                          label="스폰서 로고 URL"
                          value={item.logoUrl}
                          onChange={(logoUrl) => p({ logoUrl })}
                          placeholder="로고 URL — https://… (비우면 이름만 나가요)"
                          isValidHttpUrl={isHttpUrl}
                        />
                        <UrlField
                          label="스폰서 홈페이지 링크"
                          value={item.url}
                          onChange={(url) => p({ url })}
                          placeholder="홈페이지 링크 — https://… (선택)"
                          isValidHttpUrl={isHttpUrl}
                        />
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              JPG·PNG·WebP·GIF · 최대 {SESSION_LOGO_MAX_LABEL}. 여백을 잘라낸 투명 배경 PNG 가 가장 깔끔해요 —
              공개 페이지에서는 어느 배경에서든 흰 판 위에 같은 크기로 올라갑니다.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
