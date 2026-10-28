"use client";

/**
 * "기본 정보" 탭 — 일자·장소·관람시간·키컬러·Official Trailer·포스터 + (빌더형) 등록 시간.
 *
 * 연동형·빌더형 공통(tabs.ts 참고). 지금 당장은 화면에 안 쓰이는 값도 있지만(예: 관람시간),
 * 한 곳에 모아 두면 나중에 요약 카드·전년 대비 비교(진행률·페이스)·공개 페이지 등에서
 * 다시 입력받지 않고 바로 쓸 수 있다 — venueConfig 는 원래 "개최일·게이트·배지 등 현장
 * 운영 설정"용으로 만들어 둔 자유 JSON 이라 스키마 변경 없이 여기 담는다.
 *
 * 편집 영역이므로 값은 항상 보이고 그 자리에서 고쳐진다(AGENTS.md §2) — 자동저장.
 */
import { useCallback, useRef, useState } from "react";
import type { AutosaveState } from "@/components/ui/use-autosave";
import { Loader2, Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAutosave } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { FIELD_CLS, R } from "@/components/ui/primitives";
import { ColorField, BRAND_PRESETS } from "@/components/ui/ColorField";
import { extractDominantColor } from "@/lib/color-extract";
import RegistrationTimesSection from "./RegistrationTimesSection";

export interface VenueInfo {
  eventStart?: string;
  eventEnd?: string;
  venue?: string;
  visitingHours?: string;
  accentColor?: string;
  highlightVideoUrl?: string;
  posterUrl?: string;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function InfoTab({
  sourceId,
  initial,
  onSaved,
  formConfig,
  onFormConfigSaved,
}: {
  sourceId: string;
  initial: VenueInfo;
  onSaved?: (value: VenueInfo) => void;
  /** 빌더형만 — 주면 사전등록·현장등록 시간 영역이 붙는다 */
  formConfig?: unknown;
  onFormConfigSaved?: (formConfig: unknown) => void;
}) {
  const [info, setInfo] = useState<VenueInfo>(initial);
  const [extracting, setExtracting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useCallback(async (next: VenueInfo) => {
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // 빈 문자열도 명시적으로 보낸다 — "지운다" 는 뜻이다(patch() 가 undefined 만 걸러낸다).
        body: JSON.stringify({ venueConfig: next }),
      });
      if (!res.ok) return false;
      onSaved?.(next);
      return true;
    } catch { return false; }
  }, [onSaved, sourceId]);

  const { state: infoState, retry: infoRetry } = useAutosave(info, save);
  useReportAutosave(infoState, infoRetry);
  // 등록 시간 영역은 저장 경로가 따로다 — 표시만 머리의 하나로 합친다(가장 나쁜 상태가 이긴다)
  const [times, setTimes] = useState<{ state: AutosaveState; retry?: () => void }>({ state: "idle" });
  const onTimesState = useCallback((state: AutosaveState, retry: () => void) => setTimes({ state, retry }), []);
  const rank: Record<AutosaveState, number> = { error: 3, saving: 2, saved: 1, idle: 0 };
  const saveState = rank[times.state] > rank[infoState] ? times.state : infoState;
  const retry = () => { infoRetry(); times.retry?.(); };

  const patch = (next: Partial<VenueInfo>) => setInfo((v) => ({ ...v, ...next }));

  const handlePosterFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/collect-sources/${sourceId}/poster`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) { toast.error(data?.error ?? "업로드 실패"); return; }
      patch({ posterUrl: data.url });
    } finally {
      setUploading(false);
    }
  };

  const handleExtractColor = async () => {
    if (!info.posterUrl) return;
    setExtracting(true);
    try {
      const hex = await extractDominantColor(info.posterUrl);
      if (hex) patch({ accentColor: hex });
      else toast.error("포스터에서 색을 뽑지 못했어요 — 직접 골라주세요");
    } catch {
      toast.error("포스터에서 색을 뽑지 못했어요 — 직접 골라주세요");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">기본 정보</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            이 행사의 기본값이에요. 요약 대시보드의 전년 대비 진행률·페이스 비교가 여기 날짜를 기준으로 계산돼요.
          </p>
        </div>
        <AutosaveIndicator state={saveState} onRetry={retry} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="행사 시작일">
          <input
            type="date"
            value={info.eventStart ?? ""}
            onChange={(e) => patch({ eventStart: e.target.value })}
            className={`${FIELD_CLS} h-9`}
          />
        </Field>
        <Field label="행사 종료일">
          <input
            type="date"
            value={info.eventEnd ?? ""}
            onChange={(e) => patch({ eventEnd: e.target.value })}
            className={`${FIELD_CLS} h-9`}
          />
        </Field>
      </div>

      <Field label="장소">
        <input
          value={info.venue ?? ""}
          onChange={(e) => patch({ venue: e.target.value })}
          placeholder="예: 코엑스 A홀"
          className={`${FIELD_CLS} h-9`}
        />
      </Field>

      <Field label="관람 시간">
        <input
          value={info.visitingHours ?? ""}
          onChange={(e) => patch({ visitingHours: e.target.value })}
          placeholder="예: 10:00 – 17:00"
          className={`${FIELD_CLS} h-9`}
        />
      </Field>

      <Field label="Official Trailer" hint="유튜브 등 영상 링크">
        <input
          value={info.highlightVideoUrl ?? ""}
          onChange={(e) => patch({ highlightVideoUrl: e.target.value })}
          placeholder="https://youtube.com/watch?v=..."
          className={`${FIELD_CLS} h-9`}
        />
      </Field>

      <Field label="포스터">
        <div className="flex items-start gap-3">
          {info.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.posterUrl} alt="포스터" className={`h-28 w-20 object-cover shrink-0 ${R.control}`} />
          ) : (
            <div className={`h-28 w-20 shrink-0 flex items-center justify-center text-[11px] text-muted-foreground bg-secondary/30 ${R.control}`}>
              없음
            </div>
          )}
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePosterFile(f); e.target.value = ""; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40 ${R.control}`}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? "올리는 중..." : info.posterUrl ? "다시 올리기" : "포스터 올리기"}
            </button>
            <button
              onClick={handleExtractColor}
              disabled={!info.posterUrl || extracting}
              title={!info.posterUrl ? "포스터를 먼저 올려주세요" : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-40 ${R.control}`}
            >
              {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {extracting ? "색 뽑는 중..." : "포스터에서 키컬러 뽑기"}
            </button>
          </div>
        </div>
      </Field>

      <ColorField
        label="키컬러"
        value={info.accentColor ?? ""}
        onChange={(hex) => patch({ accentColor: hex })}
        presets={BRAND_PRESETS}
      />

      {formConfig !== undefined && (
        <div className="border-t border-border pt-6">
          <RegistrationTimesSection
            sourceId={sourceId}
            formConfig={formConfig}
            eventStart={info.eventStart}
            eventEnd={info.eventEnd}
            onSaved={onFormConfigSaved}
            onStateChange={onTimesState}
          />
        </div>
      )}
    </div>
  );
}
