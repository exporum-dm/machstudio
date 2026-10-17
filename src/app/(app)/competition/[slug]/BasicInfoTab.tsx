"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";
import {
  COMPETITION_PHASE_META,
  COMPETITION_PHASE_OVERRIDES,
  resolveCompetitionStatus,
  type RoundTiming,
} from "@/lib/competition-status";
import { NOTICE_LANGUAGES } from "@/lib/notice/config";
import type { CompetitionDetail } from "./page";

interface Props {
  competition: CompetitionDetail;
  /** 단계 자동 판정용 라운드 일정 */
  rounds?: RoundTiming[];
  patch: (body: Record<string, unknown>, successMessage?: string) => Promise<boolean>;
}

export default function BasicInfoTab({ competition, rounds, patch }: Props) {
  const [name, setName] = useState(competition.name);
  const [description, setDescription] = useState(competition.description ?? "");
  const [slug, setSlug] = useState(competition.slug);
  const [openAt, setOpenAt] = useState(competition.recruitOpenAt ? kstDateTimeLocalInput(competition.recruitOpenAt) : "");
  const [closeAt, setCloseAt] = useState(competition.recruitCloseAt ? kstDateTimeLocalInput(competition.recruitCloseAt) : "");
  const [saving, setSaving] = useState(false);

  const status = resolveCompetitionStatus({ ...competition, rounds });

  const save = async () => {
    if (!name.trim()) { toast.error("대회 이름을 입력해주세요"); return; }
    setSaving(true);
    try {
      await patch(
        {
          name: name.trim(),
          description: description.trim() || null,
          slug: slug.trim(),
          recruitOpenAt: openAt ? kstDateTimeLocalToIso(openAt) : null,
          recruitCloseAt: closeAt ? kstDateTimeLocalToIso(closeAt) : null,
        },
        "저장했어요",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">기본 정보</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">대회 이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD_CLS} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">주소(슬러그)</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className={`${FIELD_CLS} font-mono`} />
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">설명</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={FIELD_CLS} />
          </label>
        </div>
      </section>

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">언어</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          공고 페이지·신청 폼·투표·결과·발표 — <b>대회의 모든 공개 화면이 여기 하나로</b> 정해져요.
          화면마다 따로 고를 필요가 없어요. 항목 이름·문구는 직접 쓴 그대로 나가고,
          버튼·안내처럼 우리가 채워 넣는 문구만 이 언어를 따라가요.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {NOTICE_LANGUAGES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => void patch({ config: { ...competition.config, language: value } }, "언어를 바꿨어요")}
              className={`px-2.5 py-1 text-[11px] transition-colors ${R.control} ${
                competition.config.language === value ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">접수 기간</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          기간을 정하면 공고 페이지의 신청 폼이 자동으로 열리고 닫혀요. 서버에서도 같은 기준으로 막습니다.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">접수 시작</span>
            <input type="datetime-local" value={openAt} onChange={(e) => setOpenAt(e.target.value)} className={FIELD_CLS} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">접수 마감</span>
            <input type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} className={FIELD_CLS} />
          </label>
        </div>
      </section>

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">단계</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          기본은 접수 기간에 따른 자동 판정이에요. 현장에서 즉시 바꿔야 할 때만 수동으로 고정하세요.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">현재</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COMPETITION_PHASE_META[status.phase].tone}`}>
            {COMPETITION_PHASE_META[status.phase].label}
          </span>
          {status.isOverridden && <span className="text-[11px] text-muted-foreground">(수동 고정됨)</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            onClick={() => patch({ phaseOverride: null }, "자동 판정으로 되돌렸어요")}
            className={`px-3 py-1.5 text-xs transition-colors ${R.control} ${
              competition.phaseOverride === null ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            자동
          </button>
          {COMPETITION_PHASE_OVERRIDES.map((phase) => (
            <button
              key={phase}
              onClick={() => patch({ phaseOverride: phase }, `${COMPETITION_PHASE_META[phase].label} 단계로 고정했어요`)}
              className={`px-3 py-1.5 text-xs transition-colors ${R.control} ${
                competition.phaseOverride === phase ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {COMPETITION_PHASE_META[phase].label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className={`bg-violet-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50 ${R.control}`}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
