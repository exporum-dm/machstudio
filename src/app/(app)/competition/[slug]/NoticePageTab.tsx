"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ImagePlus, Loader2, Moon, Sun, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { FIELD_CLS, FINISH, R, btnCls } from "@/components/ui/primitives";
import { BRAND_PRESETS, ColorField } from "@/components/ui/ColorField";
import { Switch } from "@/components/ui/switch";
import {
  NOTICE_LANGUAGES,
  NOTICE_SECTIONS,
  isPageOnlySection,
  normalizeNoticePageConfig,
  parseNoticeVideo,
  type NoticePageConfig,
  type NoticeBgKey,
  type NoticeSectionBg,
  type NoticeSectionKey,
} from "@/lib/notice/config";
import { noticeStrings } from "@/lib/notice/strings";
import { buildNoticeModel } from "@/lib/notice/build-model";
import { DEFAULT_COMPETITION_THEME } from "@/lib/competition-config";
import { DEFAULT_ROUND_NAME, resolveCompetitionStatus, type CompetitionPhase } from "@/lib/competition-status";
import { isSafeLinkUrl, type DetailPageSettings } from "@/lib/detail-page/config";
import type { NoticeCompetition } from "@/lib/notice/types";
import NoticePreviewPane from "./NoticePreviewPane";
import { SectionBackgroundField, type BackgroundValue } from "./SectionBackgroundField";
import { AddRow, HeadFields, Row, SectionCard, moveItem } from "./NoticeSectionEditors";
import type { CompetitionDetail } from "./page";
import type { RoundDto } from "./VoteSettingsTab";

/**
 * 공고 편집기가 붙는 자리 — 대회 공고 탭과 상세페이지 메뉴가 **같은 편집기**를 쓴다.
 *
 * 둘의 차이는 여기 모아 둔다: 대회는 접수 상태·라운드(선발·심사 auto 소스)·대회 언어가 있고,
 * 상세페이지는 그게 없는 대신 주 버튼 링크·카운트다운 마감 시각·언어 선택을 이 화면에서 정한다.
 */
export interface NoticeEditorHost {
  kind: "competition" | "page";
  /** 이 config 의 noticePage 를 편집한다. 저장할 때 나머지 키는 그대로 실어 보낸다. */
  config: Record<string, unknown>;
  theme: Record<string, string>;
  /** 히어로·섹션 배경 업로드 주소 */
  uploadUrl: string;
  /** 대회 라운드 — 상세페이지는 null(선발 방식·심사 기준은 직접 입력만). */
  rounds: RoundDto[] | null;
  /** 대회의 현재 접수 상태 — 접수 전·마감 후 문구 칸에 표시. 상세페이지는 null. */
  status: { phase: CompetitionPhase; canApply: boolean } | null;
  /** 대회 언어(읽기 전용 표시). 상세페이지는 null — 이 화면에서 고른다. */
  fixedLanguageLabel: string | null;
  /** 상세페이지 전용 값. 대회는 null. */
  pageSettings: DetailPageSettings | null;
  /** 신청 폼 섹션에 고를 수 있는 사전등록(빌더형) 폼. 대회는 null — 그 섹션 자체가 안 보인다. */
  formSources: Array<{ id: string; name: string }> | null;
  /** 편집 중인 값으로 미리보기용 대회 정보를 만든다. */
  buildPreview: (theme: Record<string, string>, settings: DetailPageSettings | null) => NoticeCompetition;
  save: (next: { config: Record<string, unknown>; theme: Record<string, string> }) => Promise<boolean>;
}

/** 상세페이지에서는 대회 말투("접수부터 결선까지")가 안 맞는 섹션 안내만 바꿔 단다. */
const PAGE_SECTION_NOTES: Partial<Record<NoticeSectionKey, string>> = {
  concept: "이 페이지가 무엇인지 한 문장으로",
  snapshot: "일시·장소·대상 같은 사실을 카드로",
  timeline: "주요 일정과 날짜",
  apply: "참여 방법을 번호 카드로",
  selection: "단계별 비율 막대",
  criteria: "항목과 점수",
  prizes: "혜택·시상 — 맨 위 카드가 자동으로 강조돼요",
  countdown: "마감 시각까지 남은 시간",
};

/** 켜 뒀는데 공개 페이지에 안 나오는 이유 — 공개 렌더의 "내용 있음" 조건(build-model)과 짝을 맞춘다. */
function hiddenReasonOf(key: NoticeSectionKey, isPage: boolean): string {
  switch (key) {
    case "concept": return "큰 카피나 본문을 써 주세요.";
    case "banner": return "배경 이미지를 넣거나 큰 문구를 써 주세요.";
    case "split": return "사진과 제목(또는 본문)을 넣어 주세요.";
    case "video": return "유튜브 주소를 넣어 주세요.";
    case "snapshot": return "카드를 하나 이상 추가해 주세요. 사진 위에 큰 문구만 원하면 '사진 배너' 섹션을 쓰세요.";
    case "selection": return "라운드를 하나 이상 추가해 주세요.";
    case "countdown": return isPage ? "마감 시각을 넣어 주세요 (지난 시각이면 안 보여요)." : "기본정보 탭의 접수 마감이 없거나 이미 지났어요.";
    case "form": return "연결할 사전등록 폼을 골라 주세요.";
    default: return "항목을 하나 이상 추가해 주세요.";
  }
}

interface Props {
  competition: CompetitionDetail;
  rounds: RoundDto[];
  patch: (body: Record<string, unknown>, successMessage?: string) => Promise<boolean>;
}

/** 심사 항목 JSON → 공고가 쓰는 모양. auto 소스가 이 값을 그린다. */
function criteriaOf(round: RoundDto | undefined) {
  const raw = (round as unknown as { judgeCriteria?: unknown })?.judgeCriteria;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return {
        name: typeof c.label === "string" ? c.label : "",
        description: typeof c.description === "string" ? c.description : "",
        points: typeof c.maxScore === "number" ? c.maxScore : 0,
      };
    })
    .filter((c) => c.name.trim());
}

export default function NoticePageTab({ competition, rounds, patch }: Props) {
  const status = resolveCompetitionStatus(competition);
  const host: NoticeEditorHost = {
    kind: "competition",
    config: competition.config as unknown as Record<string, unknown>,
    // 키컬러가 비어 있는 예전 대회가 있다. 렌더러 기본값(보라)을 채워 넣어야 색 칸이
    // "지금 실제로 나가는 색"을 보여 준다 — 빈 칸이면 무슨 색인지 알 수 없다.
    theme: { accentColor: DEFAULT_COMPETITION_THEME.accentColor, ...competition.theme },
    uploadUrl: `/api/competitions/${competition.id}/notice-media`,
    rounds,
    status: { phase: status.phase, canApply: status.canApply },
    fixedLanguageLabel:
      NOTICE_LANGUAGES.find((l) => l.value === competition.config.language)?.label ?? competition.config.language,
    pageSettings: null,
    formSources: null,
    /** 미리보기에 넘길 대회 정보. auto 소스(선발·심사)가 여기 라운드를 읽는다. */
    buildPreview: (theme) => ({
      id: competition.id,
      name: competition.name,
      description: competition.description,
      theme,
      recruitOpenAt: competition.recruitOpenAt,
      recruitCloseAt: competition.recruitCloseAt,
      phase: status.phase,
      canApply: status.canApply,
      statusMessages: {
        upcoming: competition.config.statusMessages?.upcoming ?? "접수 시작 전이에요.",
        closed: competition.config.statusMessages?.closed ?? "접수가 마감되었어요.",
      },
      rounds: rounds.map((round) => ({
        kind: round.kind,
        name: round.name,
        publicWeight: round.publicWeight,
        judgeWeight: round.judgeWeight,
        criteria: criteriaOf(round),
      })),
    }),
    save: ({ config, theme }) => patch({ config, theme }, "공고 페이지를 저장했어요"),
  };
  return <NoticeEditor host={host} />;
}

export function NoticeEditor({ host }: { host: NoticeEditorHost }) {
  const isPage = host.kind === "page";
  const rounds = host.rounds;
  const status = host.status;
  // 편집 중에는 빈 행도 남긴다 — 아직 안 쓴 행이 리마운트로 사라지면 안 된다.
  const [np, setNp] = useState<NoticePageConfig>(() =>
    normalizeNoticePageConfig(host.config, { keepEmptyRows: true }),
  );
  /**
   * 키컬러는 config 가 아니라 **theme** 에 있다(대회는 신청 폼·투표·결과가 함께 쓴다).
   * 저장 전에도 미리보기가 따라와야 하므로 여기서 편집 중인 값을 들고 있다가 함께 저장한다.
   */
  const [theme, setTheme] = useState<Record<string, string>>(() => host.theme);
  const [pageSettings, setPageSettings] = useState<DetailPageSettings | null>(() => host.pageSettings);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (patchNp: Partial<NoticePageConfig>) => {
    setNp((prev) => ({ ...prev, ...patchNp }));
    setDirty(true);
  };
  const updateTheme = (patchTheme: Record<string, string>) => {
    setTheme((prev) => ({ ...prev, ...patchTheme }));
    setDirty(true);
  };
  const updatePage = (patchSettings: Partial<DetailPageSettings>) => {
    setPageSettings((prev) => (prev ? { ...prev, ...patchSettings } : prev));
    setDirty(true);
  };
  const section = <K extends NoticeSectionKey>(key: K, patchSection: Partial<NoticePageConfig[K]>) =>
    update({ [key]: { ...np[key], ...patchSection } } as Partial<NoticePageConfig>);
  /** 배경을 빼면 키 자체를 지운다 — 빈 값이 남으면 "켰는데 안 보이는" 상태가 생긴다. */
  const setSectionMedia = (key: NoticeBgKey, value: BackgroundValue | null) => {
    const next = { ...np.sectionMedia };
    if (value) next[key] = value;
    else delete next[key];
    update({ sectionMedia: next });
  };

  const setBg = (key: keyof NoticePageConfig["sectionBg"], value: NoticeSectionBg) =>
    update({ sectionBg: { ...np.sectionBg, [key]: value } });

  /** 전체 라이트/다크 — 섹션 12개를 하나씩 누르게 하면 실제로 아무도 안 쓴다. */
  const setAllBg = (value: NoticeSectionBg) => {
    const next = { ...np.sectionBg };
    for (const key of Object.keys(next) as Array<keyof typeof next>) next[key] = value;
    update({ sectionBg: next });
  };

  const { buildPreview } = host;
  const previewCompetition: NoticeCompetition = useMemo(
    () => buildPreview(theme, pageSettings),
    [buildPreview, theme, pageSettings],
  );

  const nextConfig = () => ({ ...host.config, noticePage: np, ...(pageSettings ? { page: pageSettings } : {}) });
  const previewConfig = useMemo(() => ({ ...host.config, noticePage: np }), [host.config, np]);

  /** 공개 렌더와 **같은 판단**으로 섹션 노출을 계산한다 — 편집 화면만 따로 추측하면 또 어긋난다. */
  const visible = useMemo(
    () => buildNoticeModel(previewCompetition, normalizeNoticePageConfig({ noticePage: np }), { uid: "edit", embedded: false, isPreview: true }).show,
    [previewCompetition, np],
  );
  /** 편집 화면에 보이는 섹션(대회는 상세페이지 전용 섹션 제외)을 np.order 순서로. */
  const editorSections = np.order.filter((key) => isPage || !isPageOnlySection(key));
  const moveSection = (key: NoticeSectionKey, dir: -1 | 1) => {
    const idx = editorSections.indexOf(key);
    const neighbor = editorSections[idx + dir];
    if (!neighbor) return;
    const order = [...np.order];
    const a = order.indexOf(key);
    const b = order.indexOf(neighbor);
    [order[a], order[b]] = [order[b], order[a]];
    update({ order });
  };

  const save = async () => {
    setSaving(true);
    try {
      const ok = await host.save({ config: nextConfig(), theme });
      if (ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const uploadHero = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(host.uploadUrl, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "업로드에 실패했어요"); return; }
      update({
        hero: {
          ...np.hero,
          // 초점은 기존 값을 이어받는다 — 사진만 바꿔 끼울 때 맞춰 둔 위치가 날아가면 안 된다.
          media: {
            type: data.type,
            url: data.url,
            focus: np.hero.media?.focus ?? { x: 50, y: 50 },
            mobileFocus: np.hero.media?.mobileFocus ?? { x: 50, y: 50 },
          },
        },
      });
      toast.success("배경을 올렸어요");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
      {/* min-w-0 — 그리드 항목은 기본이 min-width:auto 라 안쪽 내용이 칸보다 넓으면
          줄어들지 않고 그대로 삐져나간다(모바일에서 가로 스크롤이 생긴 원인). */}
      <div className="min-w-0 space-y-3">
        {/* ── 공개 · 색 ────────────────────────────────────────── */}
        <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{isPage ? "공개" : "이 페이지로 내보내기"}</h2>
              {/*
                이 스위치는 **공개 여부가 아니라 렌더러 선택**이다. 예전 설명은 "끄면
                '아직 공개되지 않았어요'만 보여요" 라고 적혀 있었는데 사실이 아니었다 —
                꺼 두면 외부 사이트에는 **예전 블록 빌더 공고가 그대로 나간다**.
                그래서 여기서 아무리 고쳐도 "옛날 공고만 나온다" 가 됐고, 켤 이유도 없어 보였다.
                지금 무엇이 나가는지를 문장으로 못박는다.
              */}
              <p className="mt-1 text-xs text-muted-foreground">
                {isPage ? (
                  np.enabled ? (
                    <>설치 코드를 붙여 둔 곳에 <b className="text-foreground">이 페이지</b>가 나가요.</>
                  ) : (
                    <>
                      지금은 붙여 둔 곳에 <b className="text-amber-600 dark:text-amber-400">“아직 공개되지 않은 페이지예요”</b>만
                      보여요. 내보내려면 켜고 저장하세요.
                    </>
                  )
                ) : np.enabled ? (
                  <>지금 붙여 둔 곳에는 <b className="text-foreground">이 탭에서 만든 페이지</b>가 나가요.</>
                ) : (
                  <>
                    지금 붙여 둔 곳에는 <b className="text-amber-600 dark:text-amber-400">예전 공고(블록 빌더)</b>가
                    나가요. 여기서 만든 페이지를 내보내려면 켜고 저장하세요.
                  </>
                )}
              </p>
            </div>
            <Switch checked={np.enabled} onChange={(v) => update({ enabled: v })} label={isPage ? "공개" : "이 페이지로 내보내기"} />
          </div>

          {/*
            색 패널.

            키컬러는 **여기가 아니라 Competition.theme 에 산다** — 공고·신청 폼·투표·결과가
            같이 쓰는 브랜드색이라, 공고만 따로 들고 있으면 같은 대회가 화면마다 다른 제품처럼
            보인다. 그래서 이 칸만 theme 을 고치고, 그 사실을 문장으로 적어 둔다.
            (예전에는 "키컬러는 기본정보 탭에서 정합니다" 라고 안내했는데 **그런 칸이 없었다** —
            어디서도 고칠 수 없어 모든 대회가 기본 보라로 나갔다.)
          */}
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <ColorField
              label="키컬러"
              note={isPage ? "히어로 링·비율 막대·강조" : "히어로 링·비율 막대·강조 — 신청 폼과 투표 화면에도 같이 적용돼요"}
              value={theme.accentColor}
              onChange={(v) => updateTheme({ accentColor: v })}
              presets={BRAND_PRESETS}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField
                label="보조 컬러"
                note="제목 강조줄·섹션 라벨"
                value={np.colors.accentAlt}
                onChange={(v) => update({ colors: { ...np.colors, accentAlt: v } })}
                allowInherit
                inheritedFrom={theme.accentColor}
                presets={BRAND_PRESETS}
              />
              <ColorField
                label="버튼 컬러"
                note={isPage ? "주 버튼" : "신청 버튼"}
                value={np.colors.button}
                onChange={(v) => update({ colors: { ...np.colors, button: v } })}
                allowInherit
                inheritedFrom={theme.accentColor}
                presets={BRAND_PRESETS}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorField
                label="라이트 모드 배경"
                value={np.colors.lightBg}
                onChange={(v) => update({ colors: { ...np.colors, lightBg: v } })}
              />
              <ColorField
                label="다크 모드 배경"
                value={np.colors.darkBg}
                onChange={(v) => update({ colors: { ...np.colors, darkBg: v } })}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              글자·선·카드 색과 버튼 글자색은 배경·버튼 밝기에서 자동으로 따라와요 — 대비가 깨지지 않게요.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="text-xs font-medium">전체 모드</span>
            <button onClick={() => setAllBg("light")} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] transition-colors hover:text-foreground ${R.control}`}>
              <Sun className="h-3 w-3" /> 전부 라이트
            </button>
            <button onClick={() => setAllBg("dark")} className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] transition-colors hover:text-foreground ${R.control}`}>
              <Moon className="h-3 w-3" /> 전부 다크
            </button>
            <span className="text-[11px] text-muted-foreground">섹션마다 따로 고를 수도 있어요</span>
          </div>

          {/*
            언어는 **대회 전체 설정**(기본정보 탭)이다 — 공고·신청 폼·투표·결과·발표가 전부
            같은 값을 쓴다. 예전엔 여기서도 따로 고를 수 있었는데, 그 값은 신청 폼 탭에서
            바뀐 실제 언어에 덮여 아무 효과가 없는 죽은 컨트롤이었다(고를 수는 있는데 안 바뀌는
            상태 — 실제로 혼란을 줬다). 그래서 여기는 읽기 전용으로 내리고 한 곳(기본정보)만 남긴다.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="text-xs font-medium">문구 언어</span>
            {host.fixedLanguageLabel !== null ? (
              <>
                <span className={`px-2.5 py-1.5 text-[11px] font-medium ${R.control} bg-secondary text-foreground`}>
                  {host.fixedLanguageLabel}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  대회 전체 설정이에요 — <b>기본정보 탭</b>에서 바꿀 수 있어요.
                </span>
              </>
            ) : (
              <>
                {/* 상세페이지는 대회 설정이 없으니 여기서 고른다 — 목차·카운트다운 같은 자동 문구에만 적용. */}
                {NOTICE_LANGUAGES.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => update({ language: l.value })}
                    className={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${R.control} ${
                      np.language === l.value ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
                <span className="text-[11px] text-muted-foreground">직접 쓴 글은 그대로, 자동 문구(카운트다운 등)만 바뀌어요</span>
              </>
            )}
          </div>
        </section>

        {/* ── 히어로 ──────────────────────────────────────────── */}
        <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">히어로</h2>
            <div className="flex gap-0.5">
              {(["light", "dark"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setBg("hero", value)}
                  className={`px-2 py-1 text-[10px] font-medium transition-colors ${R.control} ${
                    np.sectionBg.hero === value ? "bg-foreground text-background" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {value === "light" ? "라이트" : "다크"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadHero(f); }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 ${R.control}`}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                {np.hero.media ? "배경 바꾸기" : "배경 올리기"}
              </button>
              {np.hero.media && (
                <>
                  <span className="text-[11px] text-muted-foreground">
                    {np.hero.media.type === "video" ? "영상" : "이미지"} 적용됨
                  </span>
                  <button
                    onClick={() => update({ hero: { ...np.hero, media: null } })}
                    className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
                    aria-label="배경 제거"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              배경을 넣으면 글자는 항상 밝게 나가요 — 사진 위 어두운 막 때문에 검은 글자는 안 읽혀요.
            </p>

            {/*
              **초점은 히어로에서 제일 급하다.** 가로 사진이 모바일 세로 화면에서 좌우로 크게
              잘리는데, 히어로는 첫 화면이라 그게 곧 첫인상이다. 영상은 object-position 이
              먹지 않으므로 이미지일 때만 보여 준다.
            */}
            {np.hero.media?.type === "image" && (
              <SectionBackgroundField
                label="배경 초점"
                uploadUrl={host.uploadUrl}
                showTone={false}
                value={{
                  url: np.hero.media.url,
                  focus: np.hero.media.focus,
                  mobileFocus: np.hero.media.mobileFocus,
                  // 히어로는 진하기 손잡이를 안 쓴다 — 껍데기가 그라데이션 스크림을 이미 잡는다.
                  scrim: 72,
                  panel: 88,
                }}
                onChange={(next) =>
                  update({
                    hero: {
                      ...np.hero,
                      media: next
                        ? { type: "image", url: next.url, focus: next.focus, mobileFocus: next.mobileFocus }
                        : null,
                    },
                  })
                }
              />
            )}

            <input value={np.hero.brand} onChange={(e) => update({ hero: { ...np.hero, brand: e.target.value } })}
              placeholder={isPage ? "상단 작은 라벨 (비우면 페이지 이름)" : "상단 작은 라벨 (비우면 대회 이름)"} className={`${FIELD_CLS} h-8`} />

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">대형 제목 — 둘째 줄부터 키컬러</span>
              {np.hero.titleLines.map((line, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    value={line}
                    onChange={(e) => {
                      const titleLines = [...np.hero.titleLines];
                      titleLines[index] = e.target.value;
                      update({ hero: { ...np.hero, titleLines } });
                    }}
                    placeholder={index === 0 ? "첫 줄" : "둘째 줄"}
                    className={`${FIELD_CLS} h-8`}
                  />
                  <button
                    onClick={() => update({ hero: { ...np.hero, titleLines: np.hero.titleLines.filter((_, i) => i !== index) } })}
                    className="rounded p-1 text-muted-foreground hover:text-red-500"
                    aria-label="줄 삭제"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <AddRow label="줄 추가" onClick={() => update({ hero: { ...np.hero, titleLines: [...np.hero.titleLines, ""] } })} />
            </div>

            <textarea value={np.hero.subtitle} onChange={(e) => update({ hero: { ...np.hero, subtitle: e.target.value } })}
              rows={2} placeholder={isPage ? "부제" : "부제 (비우면 대회 설명 첫 줄)"} className={`${FIELD_CLS} h-auto py-2`} />

            {/*
              열 이름을 띄운다. placeholder 는 **채우고 나면 사라져서** 어느 칸이 어느 버튼인지
              알 수 없다 — 실제로 두 칸을 헷갈려 값을 바꿔 넣은 화면을 봤다.
            */}
            <div className="space-y-1.5">
              <div className="grid gap-1.5 text-[10px] font-medium text-muted-foreground sm:grid-cols-2">
                <span>{isPage ? "주 버튼 — 아래 링크로 이동해요" : "주 버튼 — 신청 폼을 엽니다"}</span>
                <span>보조 버튼 — 첫 섹션으로 이동 (비우면 안 보임)</span>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input value={np.hero.ctaLabel} onChange={(e) => update({ hero: { ...np.hero, ctaLabel: e.target.value } })}
                  placeholder="예: Apply now" className={`${FIELD_CLS} h-8`} />
                <input value={np.hero.secondaryLabel} onChange={(e) => update({ hero: { ...np.hero, secondaryLabel: e.target.value } })}
                  placeholder="예: See the schedule" className={`${FIELD_CLS} h-8`} />
              </div>
            </div>

            {/*
              상세페이지에는 신청 폼이 없다 — 주 버튼은 링크로 보낸다(사전등록 폼·다른 페이지).
              링크가 비었거나 형식이 틀리면 버튼을 아예 안 그린다. 눌러도 아무 일 없는 버튼을
              방문자에게 보이지 않게, 그리고 그 사실을 칸 바로 아래에서 알려 준다.
            */}
            {pageSettings && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">주 버튼 링크</span>
                <input
                  value={pageSettings.ctaUrl}
                  onChange={(e) => updatePage({ ctaUrl: e.target.value })}
                  placeholder="https://… (사전등록 폼, 아임웹 다른 페이지 등)"
                  inputMode="url"
                  className={`${FIELD_CLS} h-8 font-mono text-xs`}
                />
                <button
                  onClick={() => updatePage({ ctaUrl: "#form", ctaNewTab: false })}
                  className={`bg-secondary px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
                >
                  이 페이지의 신청 폼으로 내려가기 (#form)
                </button>
                {pageSettings.ctaUrl.trim() && !isSafeLinkUrl(pageSettings.ctaUrl) ? (
                  <p className="text-[11px] text-red-500">https:// 로 시작하는 주소나 #form 을 넣어 주세요 — 지금은 버튼이 안 보여요.</p>
                ) : !pageSettings.ctaUrl.trim() ? (
                  <p className="text-[11px] text-muted-foreground">비워 두면 주 버튼(히어로·카운트다운)이 안 보여요.</p>
                ) : null}
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={pageSettings.ctaNewTab}
                    onChange={(e) => updatePage({ ctaNewTab: e.target.checked })}
                  />
                  새 탭에서 열기
                </label>
              </div>
            )}

            {/*
              접수 전·마감 후에는 버튼이 잠기고 문구가 상태 안내로 바뀐다. 그 자리를 손댈 수
              없어서 영문 공고에도 "접수 시작 전 / 접수 시작 전이에요." 가 그대로 떴다.
              현재 상태에 해당하는 칸에는 표시를 달아 둔다 — 지금 화면에 뭐가 나가는지
              모른 채 네 칸을 다 채우게 하면 안 된다.
            */}
            {status && <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                접수 전 · 마감 후 문구 <span className="font-normal">— 비우면 언어에 맞는 기본 문구</span>
              </span>
              <div className="grid gap-1.5 text-[10px] font-medium text-muted-foreground sm:grid-cols-[64px_1fr_1fr]">
                <span />
                <span>주 버튼 자리에 뜨는 문구 (잠김)</span>
                <span>그 바로 아래 한 줄</span>
              </div>
              {([
                ["upcoming", "접수 전", "upcomingLabel", "upcomingNote"],
                ["closed", "마감 후", "closedLabel", "closedNote"],
              ] as const).map(([phase, label, labelKey, noteKey]) => (
                <div key={phase} className="grid gap-1.5 sm:grid-cols-[64px_1fr_1fr] sm:items-center">
                  <span className="text-[11px] text-muted-foreground">
                    {label}
                    {!status.canApply && status.phase === phase && (
                      <span className="ml-1 text-violet-500" title="지금 이 문구가 나가요">●</span>
                    )}
                  </span>
                  <input value={np.hero[labelKey]} className={`${FIELD_CLS} h-8`}
                    placeholder={phase === "upcoming" ? "버튼 문구 (예: Opens Sep 1)" : "버튼 문구 (예: Applications closed)"}
                    onChange={(e) => update({ hero: { ...np.hero, [labelKey]: e.target.value } })} />
                  <input value={np.hero[noteKey]} className={`${FIELD_CLS} h-8`}
                    placeholder="버튼 아래 안내 (비우면 안 보임)"
                    onChange={(e) => update({ hero: { ...np.hero, [noteKey]: e.target.value } })} />
                </div>
              ))}
            </div>}

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">하단 팩트 — 결선일·장소·정원 같은 것</span>
              {np.hero.facts.map((fact, index) => (
                <Row key={index} index={index} count={np.hero.facts.length}
                  onMove={(from, to) => update({ hero: { ...np.hero, facts: moveItem(np.hero.facts, from, to) } })}
                  onRemove={(i) => update({ hero: { ...np.hero, facts: np.hero.facts.filter((_, x) => x !== i) } })}>
                  <div className="grid gap-1.5 sm:grid-cols-[120px_1fr]">
                    <input value={fact.label} placeholder="라벨" className={`${FIELD_CLS} h-8`}
                      onChange={(e) => { const facts = [...np.hero.facts]; facts[index] = { ...fact, label: e.target.value }; update({ hero: { ...np.hero, facts } }); }} />
                    <input value={fact.value} placeholder="값" className={`${FIELD_CLS} h-8`}
                      onChange={(e) => { const facts = [...np.hero.facts]; facts[index] = { ...fact, value: e.target.value }; update({ hero: { ...np.hero, facts } }); }} />
                  </div>
                </Row>
              ))}
              <AddRow label="팩트 추가" onClick={() => update({ hero: { ...np.hero, facts: [...np.hero.facts, { label: "", value: "" }] } })} />
            </div>
          </div>
        </section>

        {/* ── 섹션들 ──────────────────────────────────────────── */}
        {editorSections.map((key, index) => {
          const meta = NOTICE_SECTIONS.find((item) => item.key === key)!;
          return (
          <SectionCard
            key={key}
            label={meta.label}
            note={(isPage && PAGE_SECTION_NOTES[key]) || meta.note}
            enabled={np[key].enabled}
            bg={np.sectionBg[key]}
            onToggle={(v) => section(key, { enabled: v } as never)}
            onBg={(v) => setBg(key, v)}
            onMove={{
              up: index > 0 ? () => moveSection(key, -1) : null,
              down: index < editorSections.length - 1 ? () => moveSection(key, 1) : null,
            }}
            hiddenReason={np[key].enabled && !visible[key] ? hiddenReasonOf(key, isPage) : null}
          >
            {/*
              배경은 **선택**이다 — 어울리는 섹션이 있고 아닌 섹션이 있다. 그래서 섹션마다
              따로 켜고, 안 켠 섹션은 지금처럼 색만 칠한다.
            */}
            <SectionBackgroundField
              label="배경 이미지 (선택)"
              uploadUrl={host.uploadUrl}
              value={np.sectionMedia[key] ?? null}
              onChange={(next) => setSectionMedia(key, next)}
            />
            <SectionBody
              sectionKey={key}
              np={np}
              section={section}
              rounds={rounds}
              deadline={pageSettings ? { value: pageSettings.deadline, onChange: (deadline) => updatePage({ deadline }) } : null}
              uploadUrl={host.uploadUrl}
              formSources={host.formSources}
            />
          </SectionCard>
          );
        })}

        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-[11px] text-muted-foreground">저장하지 않은 변경이 있어요</span>}
          <motion.button whileTap={{ scale: 0.96 }} onClick={save} disabled={saving || !dirty}
            className={btnCls("key", "text-xs disabled:opacity-40")}>
            {saving ? "저장 중..." : dirty ? "저장" : "저장됨"}
          </motion.button>
        </div>
      </div>

      <div className="min-w-0 xl:sticky xl:top-6 xl:self-start">
        <NoticePreviewPane competition={previewCompetition} config={previewConfig} />
      </div>
    </div>
  );
}

/** ISO → datetime-local 입력값(브라우저 현지 시각). */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** 섹션별 본문 편집. 스위치 하나에 몰아 두면 카드 쪽이 읽기 어려워져 분리했다. */
function SectionBody({
  sectionKey,
  np,
  section,
  rounds: hostRounds,
  deadline,
  uploadUrl,
  formSources,
}: {
  sectionKey: NoticeSectionKey;
  np: NoticePageConfig;
  section: <K extends NoticeSectionKey>(key: K, patch: Partial<NoticePageConfig[K]>) => void;
  /** null = 상세페이지 — 라운드가 없으니 선발 방식·심사 기준은 직접 입력만 연다. */
  rounds: RoundDto[] | null;
  /** 상세페이지의 카운트다운 마감 시각. 대회는 null(기본정보 탭의 접수 마감을 쓴다). */
  deadline: { value: string | null; onChange: (next: string | null) => void } | null;
  uploadUrl: string;
  formSources: Array<{ id: string; name: string }> | null;
}) {
  const rounds = hostRounds ?? [];
  const hasRounds = hostRounds !== null;
  /** 배열의 한 칸만 갈아 끼운다. 중첩(라운드 안의 비율 막대)까지 같은 모양으로 쓴다. */
  const patchAt = <T,>(list: T[], index: number, patch: Partial<T>): T[] =>
    list.map((item, i) => (i === index ? { ...item, ...patch } : item));

  /**
   * 설정에서 값을 복사해 온다 — auto 와 **같은 규칙**이어야 한다.
   * 다르면 "가져오기를 눌렀는데 미리보기랑 다르네"가 된다. auto 의 판단은 build-model 이
   * 하므로, 여기서는 그 입력(라운드 목록)만 같은 모양으로 옮긴다.
   *
   * 라운드 이름·항목 이름은 그대로 둔다 — 번역은 운영자가 이 칸에서 직접 한다.
   */
  const selectionFromSettings = () => {
    // 라벨·설명은 **골라 둔 언어**로 채운다. 한글로 부어 놓으면 영어 공고에서 불러오기를
    // 누른 직후 다시 전부 지워 써야 해서, 불러오기가 오히려 일을 늘린다.
    const t = noticeStrings(np.language);
    return rounds
      .filter((round) => round.publicWeight > 0 || round.judgeWeight > 0)
      .map((round) => ({
        // auto 와 같은 규칙 — 우리가 넣어 둔 기본 이름이면 언어를 따르고, 운영자가 바꿨으면 그대로.
        title:
          round.name === DEFAULT_ROUND_NAME[round.kind === "final" ? "final" : "prelim"]
            ? round.kind === "final" ? t.roundNameFinal : t.roundNamePrelim
            : round.name,
        note: round.kind === "prelim" ? t.roundNotePrelim : t.roundNoteFinal,
        bars: [
          { label: t.barPublic, percent: round.publicWeight },
          { label: t.barJudge, percent: round.judgeWeight },
        ].filter((bar) => bar.percent > 0),
      }));
  };

  /** 심사 기준도 auto 와 같이 **본선 우선**, 본선이 비면 예선. */
  const criteriaFromSettings = () => {
    const final = rounds.find((r) => r.kind === "final" && criteriaOf(r).length > 0);
    return criteriaOf(final ?? rounds.find((r) => criteriaOf(r).length > 0));
  };

  const head = (key: NoticeSectionKey, showDescription = true) => {
    const cfg = np[key] as { kicker: string; title: string; description?: string };
    return (
      <HeadFields
        kicker={cfg.kicker}
        title={cfg.title}
        description={cfg.description}
        showDescription={showDescription}
        onChange={(patch) => section(key, patch as never)}
      />
    );
  };

  if (sectionKey === "banner") {
    const b = np.banner;
    return (
      <>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input value={b.kicker} onChange={(e) => section("banner", { kicker: e.target.value })}
            placeholder="작은 라벨 (예: This is the Energy)" className={`${FIELD_CLS} h-8`} />
          <input value={b.title} onChange={(e) => section("banner", { title: e.target.value })}
            placeholder="큰 문구 (예: SEE WHAT IT FEELS LIKE.)" className={`${FIELD_CLS} h-8`} />
        </div>
        <textarea value={b.body} onChange={(e) => section("banner", { body: e.target.value })}
          rows={2} placeholder="짧은 설명 (선택)" className={`${FIELD_CLS} h-auto py-2`} />
        <p className="text-[11px] text-muted-foreground">사진은 위 <b>배경 이미지</b>에 넣어요. 글은 사진 아래쪽에 얹혀요 — 배경 어둡기로 글이 잘 읽히게 맞추세요.</p>
      </>
    );
  }

  if (sectionKey === "split") {
    const sp = np.split;
    return (
      <>
        <SectionBackgroundField
          label="사진"
          uploadUrl={uploadUrl}
          showTone={false}
          value={sp.image ? { ...sp.image, scrim: 0, panel: 0 } : null}
          onChange={(next) => section("split", { image: next ? { url: next.url, focus: next.focus, mobileFocus: next.mobileFocus } : null })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">사진 위치</span>
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              onClick={() => section("split", { imageSide: side })}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${R.control} ${
                sp.imageSide === side ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {side === "left" ? "왼쪽" : "오른쪽"}
            </button>
          ))}
          <span className="text-[11px] text-muted-foreground">· 반대쪽 패널은 버튼 컬러로 칠해져요</span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input value={sp.kicker} onChange={(e) => section("split", { kicker: e.target.value })}
            placeholder="작은 라벨 (선택)" className={`${FIELD_CLS} h-8`} />
          <input value={sp.title} onChange={(e) => section("split", { title: e.target.value })}
            placeholder="제목 (예: FEEL THE K-POP ENERGY!)" className={`${FIELD_CLS} h-8`} />
        </div>
        <textarea value={sp.body} onChange={(e) => section("split", { body: e.target.value })}
          rows={3} placeholder="본문 — 빈 줄로 문단을 나눠요" className={`${FIELD_CLS} h-auto py-2`} />
      </>
    );
  }

  if (sectionKey === "video") {
    const v = np.video;
    const parsed = v.url.trim() ? parseNoticeVideo(v.url) : null;
    return (
      <>
        {head("video")}
        <input value={v.url} onChange={(e) => section("video", { url: e.target.value })} inputMode="url"
          placeholder="유튜브 주소 (https://youtu.be/… · https://youtube.com/shorts/…)" className={`${FIELD_CLS} h-8 font-mono text-xs`} />
        {v.url.trim() && !parsed ? (
          <p className="text-[11px] text-red-500">유튜브 주소만 넣을 수 있어요 — 영상 파일을 직접 올리면 방문자마다 수십 MB가 나가요.</p>
        ) : parsed ? (
          <p className="text-[11px] text-muted-foreground">{parsed.vertical ? "세로 영상(쇼츠)으로" : "가로 영상으로"} 보여요.</p>
        ) : null}
        <span className="block pt-1 text-[10px] font-medium text-muted-foreground">영상 옆 설명 (선택)</span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input value={v.captionLabel} onChange={(e) => section("video", { captionLabel: e.target.value })}
            placeholder="작은 딱지 (예: Class Song)" className={`${FIELD_CLS} h-8`} />
          <input value={v.captionTitle} onChange={(e) => section("video", { captionTitle: e.target.value })}
            placeholder="제목 (예: LNGSHOT Saucin)" className={`${FIELD_CLS} h-8`} />
        </div>
        <textarea value={v.captionBody} onChange={(e) => section("video", { captionBody: e.target.value })}
          rows={2} placeholder="설명 (예: 다 외우지 않아도 괜찮아요)" className={`${FIELD_CLS} h-auto py-2`} />
      </>
    );
  }

  if (sectionKey === "form") {
    const fm = np.form;
    return (
      <>
        {head("form")}
        <select
          value={fm.sourceId}
          onChange={(e) => section("form", { sourceId: e.target.value })}
          className={`${FIELD_CLS} h-8`}
        >
          <option value="">사전등록 폼 고르기</option>
          {(formSources ?? []).map((source) => (
            <option key={source.id} value={source.id}>{source.name}</option>
          ))}
        </select>
        {formSources && formSources.length === 0 && (
          <p className="text-[11px] text-muted-foreground">이 프로젝트에 빌더형 사전등록 폼이 없어요 — 사전등록 메뉴에서 먼저 만들어 주세요.</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          미리보기에는 자리만 보이고, 실제 페이지에서 폼이 떠요. 히어로 주 버튼 링크를 <b>#form</b> 으로 두면 이 폼으로 내려가요.
        </p>
      </>
    );
  }

  if (sectionKey === "concept") {
    const c = np.concept;
    return (
      <>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input value={c.kicker} onChange={(e) => section("concept", { kicker: e.target.value })}
            placeholder="작은 라벨" className={`${FIELD_CLS} h-8`} />
          <input value={c.highlight} onChange={(e) => section("concept", { highlight: e.target.value })}
            placeholder="강조구 (키컬러로 이어 붙음)" className={`${FIELD_CLS} h-8`} />
        </div>
        <input value={c.headline} onChange={(e) => section("concept", { headline: e.target.value })}
          placeholder="큰 카피" className={`${FIELD_CLS} h-8`} />
        <textarea value={c.body} onChange={(e) => section("concept", { body: e.target.value })}
          rows={4} placeholder="본문 — 빈 줄로 문단을 나눠요" className={`${FIELD_CLS} h-auto py-2`} />
      </>
    );
  }

  if (sectionKey === "snapshot") {
    const items = np.snapshot.items;
    return (
      <>
        {head("snapshot", false)}
        {items.map((item, index) => (
          <Row key={index} index={index} count={items.length}
            onMove={(from, to) => section("snapshot", { items: moveItem(items, from, to) })}
            onRemove={(i) => section("snapshot", { items: items.filter((_, x) => x !== i) })}>
            <div className="grid gap-1.5 sm:grid-cols-[130px_1fr]">
              <input value={item.label} placeholder="라벨" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, label: e.target.value }; section("snapshot", { items: next }); }} />
              <input value={item.value} placeholder="값" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, value: e.target.value }; section("snapshot", { items: next }); }} />
            </div>
            <input value={item.note} placeholder="부연 (선택)" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, note: e.target.value }; section("snapshot", { items: next }); }} />
          </Row>
        ))}
        <AddRow label="항목 추가" onClick={() => section("snapshot", { items: [...items, { label: "", value: "", note: "" }] })} />
      </>
    );
  }

  if (sectionKey === "timeline") {
    const items = np.timeline.items;
    return (
      <>
        {head("timeline")}
        {items.map((item, index) => (
          <Row key={index} index={index} count={items.length}
            onMove={(from, to) => section("timeline", { items: moveItem(items, from, to) })}
            onRemove={(i) => section("timeline", { items: items.filter((_, x) => x !== i) })}>
            <div className="grid gap-1.5 sm:grid-cols-[140px_1fr]">
              <input value={item.date} placeholder="날짜" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, date: e.target.value }; section("timeline", { items: next }); }} />
              <input value={item.title} placeholder="제목" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, title: e.target.value }; section("timeline", { items: next }); }} />
            </div>
            <input value={item.description} placeholder="설명 (선택)" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, description: e.target.value }; section("timeline", { items: next }); }} />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={item.emphasis}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, emphasis: e.target.checked }; section("timeline", { items: next }); }} />
              강조 — 마감·결선처럼 먼저 보여야 하는 날
            </label>
          </Row>
        ))}
        <AddRow label="일정 추가" onClick={() => section("timeline", { items: [...items, { date: "", title: "", description: "", emphasis: false }] })} />
      </>
    );
  }

  if (sectionKey === "apply") {
    const items = np.apply.items;
    return (
      <>
        {head("apply")}
        {items.map((item, index) => (
          <Row key={index} index={index} count={items.length}
            onMove={(from, to) => section("apply", { items: moveItem(items, from, to) })}
            onRemove={(i) => section("apply", { items: items.filter((_, x) => x !== i) })}>
            <input value={item.title} placeholder="카드 제목" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, title: e.target.value }; section("apply", { items: next }); }} />
            <textarea value={item.items.join("\n")} rows={3} placeholder="준비물 — 한 줄에 하나"
              className={`${FIELD_CLS} h-auto py-2 text-xs`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, items: e.target.value.split("\n") }; section("apply", { items: next }); }} />
          </Row>
        ))}
        <AddRow label="카드 추가" onClick={() => section("apply", { items: [...items, { title: "", items: [""] }] })} />
      </>
    );
  }

  if (sectionKey === "eligibility") {
    return (
      <>
        {head("eligibility", false)}
        <textarea value={np.eligibility.items.join("\n")} rows={6} placeholder="자격 요건 — 한 줄에 하나"
          className={`${FIELD_CLS} h-auto py-2`}
          onChange={(e) => section("eligibility", { items: e.target.value.split("\n") })} />
      </>
    );
  }

  if (sectionKey === "selection") {
    const s = np.selection;
    return (
      <>
        {head("selection", false)}
        {hasRounds && <SourceToggle
          source={s.source}
          onChange={(source) => section("selection", { source })}
          autoNote={`투표 설정의 대중:심사 비율을 그대로 그려요 (${rounds.map((r) => `${r.name} ${r.publicWeight}:${r.judgeWeight}`).join(" · ") || "라운드 없음"})`}
        />}
        {(!hasRounds || s.source === "manual") && (
          <>
            {hasRounds && <p className="text-[11px] text-amber-700 dark:text-amber-400">
              직접 입력은 투표 설정과 따로 놀아요 — 비율을 바꾸면 여기도 같이 고쳐야 합니다.
            </p>}
            {/*
              **빈 칸에서 시작하지 않게 한다.** 직접 입력으로 바꾸는 가장 흔한 이유는
              "가져온 값이 마음에 안 든다"(영문 대회인데 라운드 이름이 한글이라든지)이지
              처음부터 다시 쓰고 싶어서가 아니다. 설정값을 그대로 부어 주고 고치게 한다.
            */}
            {hasRounds && <AddRow
              label={s.rounds.length > 0 ? "설정값 다시 불러오기 (덮어써요)" : "설정값 불러오기"}
              onClick={() => section("selection", { rounds: selectionFromSettings() })}
            />}
            {s.rounds.map((round, index) => (
              <Row key={index} index={index} count={s.rounds.length}
                onMove={(from, to) => section("selection", { rounds: moveItem(s.rounds, from, to) })}
                onRemove={(i) => section("selection", { rounds: s.rounds.filter((_, n) => n !== i) })}>
                <input value={round.title} placeholder="라운드 이름 (예: Preliminary)"
                  className={`${FIELD_CLS} h-8`}
                  onChange={(e) => section("selection", { rounds: patchAt(s.rounds, index, { title: e.target.value }) })} />
                <input value={round.note} placeholder="한 줄 설명 (예: Decides who advances)"
                  className={`${FIELD_CLS} h-8`}
                  onChange={(e) => section("selection", { rounds: patchAt(s.rounds, index, { note: e.target.value }) })} />
                {round.bars.map((bar, barIndex) => (
                  <div key={barIndex} className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <input value={bar.label} placeholder="항목 (예: Audience vote)" className={`${FIELD_CLS} h-8`}
                        onChange={(e) => section("selection", {
                          rounds: patchAt(s.rounds, index, { bars: patchAt(round.bars, barIndex, { label: e.target.value }) }),
                        })} />
                    </div>
                    <div className="w-16 shrink-0">
                      <input type="number" min={0} max={100} value={bar.percent} className={`${FIELD_CLS} h-8`}
                        onChange={(e) => section("selection", {
                          rounds: patchAt(s.rounds, index, {
                            bars: patchAt(round.bars, barIndex, { percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }),
                          }),
                        })} />
                    </div>
                    <span className="w-3 shrink-0 text-[11px] text-muted-foreground">%</span>
                    <button aria-label="비율 삭제" className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
                      onClick={() => section("selection", {
                        rounds: patchAt(s.rounds, index, { bars: round.bars.filter((_, n) => n !== barIndex) }),
                      })}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <AddRow label="비율 추가" onClick={() => section("selection", {
                  rounds: patchAt(s.rounds, index, { bars: [...round.bars, { label: "", percent: 0 }] }),
                })} />
              </Row>
            ))}
            <AddRow label="라운드 추가" onClick={() => section("selection", {
              rounds: [...s.rounds, { title: "", note: "", bars: [{ label: "", percent: 0 }] }],
            })} />
          </>
        )}
        <input value={s.footnote} onChange={(e) => section("selection", { footnote: e.target.value })}
          placeholder="각주 (선택)" className={`${FIELD_CLS} h-8`} />
      </>
    );
  }

  if (sectionKey === "criteria") {
    const c = np.criteria;
    const finalRound = rounds.find((r) => r.kind === "final");
    return (
      <>
        {head("criteria")}
        {hasRounds && <SourceToggle
          source={c.source}
          onChange={(source) => section("criteria", { source })}
          autoNote={`심사단 탭의 항목·배점을 그대로 그려요 (본선 우선${finalRound ? "" : " · 본선 항목 없으면 예선"})`}
        />}
        {(!hasRounds || c.source === "manual") && (
          <>
            {hasRounds && <p className="text-[11px] text-amber-700 dark:text-amber-400">
              직접 입력은 심사단 탭과 따로 놀아요 — 배점을 바꾸면 여기도 같이 고쳐야 합니다.
            </p>}
            {hasRounds && <AddRow
              label={c.items.length > 0 ? "설정값 다시 불러오기 (덮어써요)" : "설정값 불러오기"}
              onClick={() => section("criteria", { items: criteriaFromSettings() })}
            />}
            {c.items.map((item, index) => (
              <Row key={index} index={index} count={c.items.length}
                onMove={(from, to) => section("criteria", { items: moveItem(c.items, from, to) })}
                onRemove={(i) => section("criteria", { items: c.items.filter((_, n) => n !== i) })}>
                <div className="flex items-start gap-1.5">
                  <div className="min-w-0 flex-1">
                    <input value={item.name} placeholder="제목 (예: Creativity)" className={`${FIELD_CLS} h-8`}
                      onChange={(e) => section("criteria", { items: patchAt(c.items, index, { name: e.target.value }) })} />
                  </div>
                  <div className="w-20 shrink-0">
                    <input type="number" min={0} value={item.points} placeholder="배점" className={`${FIELD_CLS} h-8`}
                      onChange={(e) => section("criteria", { items: patchAt(c.items, index, { points: Math.max(0, Number(e.target.value) || 0) }) })} />
                  </div>
                </div>
                <input value={item.description} placeholder="내용 — 이 항목에서 무엇을 보는지" className={`${FIELD_CLS} h-8`}
                  onChange={(e) => section("criteria", { items: patchAt(c.items, index, { description: e.target.value }) })} />
              </Row>
            ))}
            <AddRow label="항목 추가" onClick={() => section("criteria", {
              items: [...c.items, { name: "", description: "", points: 0 }],
            })} />
          </>
        )}
      </>
    );
  }

  if (sectionKey === "prizes") {
    const items = np.prizes.items;
    return (
      <>
        {head("prizes", false)}
        {items.map((item, index) => (
          <Row key={index} index={index} count={items.length}
            onMove={(from, to) => section("prizes", { items: moveItem(items, from, to) })}
            onRemove={(i) => section("prizes", { items: items.filter((_, x) => x !== i) })}>
            <div className="grid gap-1.5 sm:grid-cols-[110px_1fr_100px]">
              <input value={item.rank} placeholder="등수" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, rank: e.target.value }; section("prizes", { items: next }); }} />
              <input value={item.title} placeholder="상 이름" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, title: e.target.value }; section("prizes", { items: next }); }} />
              <input value={item.amount} placeholder="금액" className={`${FIELD_CLS} h-8`}
                onChange={(e) => { const next = [...items]; next[index] = { ...item, amount: e.target.value }; section("prizes", { items: next }); }} />
            </div>
            <input value={item.description} placeholder="설명 (선택)" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, description: e.target.value }; section("prizes", { items: next }); }} />
          </Row>
        ))}
        <AddRow label="상 추가" onClick={() => section("prizes", { items: [...items, { rank: "", title: "", description: "", amount: "" }] })} />
        <p className="text-[11px] text-muted-foreground">맨 위 카드가 자동으로 강조돼요.</p>
      </>
    );
  }

  if (sectionKey === "countdown") {
    const c = np.countdown;
    return (
      <>
        {head("countdown")}
        <input value={c.ctaLabel} onChange={(e) => section("countdown", { ctaLabel: e.target.value })}
          placeholder="버튼 문구 (비우면 히어로와 같게)" className={`${FIELD_CLS} h-8`} />
        {deadline ? (
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-muted-foreground">마감 시각 (이 컴퓨터 시간 기준)</span>
            <input
              type="datetime-local"
              value={deadline.value ? toLocalInputValue(deadline.value) : ""}
              onChange={(e) => deadline.onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
              className={`${FIELD_CLS} h-8`}
            />
            <p className="text-[11px] text-muted-foreground">마감이 없거나 지났으면 섹션이 안 나와요.</p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            남은 시간은 <b>기본정보 탭의 접수 마감</b>에서 자동으로 계산돼요. 마감이 없거나 지났으면 섹션이 안 나옵니다.
          </p>
        )}
      </>
    );
  }

  if (sectionKey === "faq") {
    const items = np.faq.items;
    return (
      <>
        {head("faq", false)}
        {items.map((item, index) => (
          <Row key={index} index={index} count={items.length}
            onMove={(from, to) => section("faq", { items: moveItem(items, from, to) })}
            onRemove={(i) => section("faq", { items: items.filter((_, x) => x !== i) })}>
            <input value={item.question} placeholder="질문" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, question: e.target.value }; section("faq", { items: next }); }} />
            <textarea value={item.answer} rows={2} placeholder="답변" className={`${FIELD_CLS} h-auto py-2 text-xs`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, answer: e.target.value }; section("faq", { items: next }); }} />
          </Row>
        ))}
        <AddRow label="질문 추가" onClick={() => section("faq", { items: [...items, { question: "", answer: "" }] })} />
      </>
    );
  }

  const items = np.sponsors.items;
  return (
    <>
      {head("sponsors", false)}
      {items.map((item, index) => (
        <Row key={index} index={index} count={items.length}
          onMove={(from, to) => section("sponsors", { items: moveItem(items, from, to) })}
          onRemove={(i) => section("sponsors", { items: items.filter((_, x) => x !== i) })}>
          <div className="grid gap-1.5 sm:grid-cols-[100px_1fr]">
            <input value={item.tier} placeholder="구분" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, tier: e.target.value }; section("sponsors", { items: next }); }} />
            <input value={item.name} placeholder="이름" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, name: e.target.value }; section("sponsors", { items: next }); }} />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <input value={item.logoUrl} placeholder="로고 URL (선택)" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, logoUrl: e.target.value }; section("sponsors", { items: next }); }} />
            <input value={item.url} placeholder="홈페이지 (선택)" className={`${FIELD_CLS} h-8`}
              onChange={(e) => { const next = [...items]; next[index] = { ...item, url: e.target.value }; section("sponsors", { items: next }); }} />
          </div>
        </Row>
      ))}
      <AddRow label="후원사 추가" onClick={() => section("sponsors", { items: [...items, { tier: "", name: "", logoUrl: "", url: "" }] })} />
    </>
  );
}

/** auto / 직접 입력 전환 — 어디서 값이 오는지 화면에 적어 둔다. */
function SourceToggle({
  source,
  onChange,
  autoNote,
}: {
  source: "auto" | "manual";
  onChange: (value: "auto" | "manual") => void;
  autoNote: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {(["auto", "manual"] as const).map((value) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${R.control} ${
              source === value ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {value === "auto" ? "설정에서 가져오기" : "직접 입력"}
          </button>
        ))}
      </div>
      {source === "auto" && <p className="text-[11px] text-muted-foreground">{autoNote}</p>}
    </div>
  );
}
