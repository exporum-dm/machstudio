"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Btn, FieldSelect } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { COMPETITION_PHASE_META, COMPETITION_PHASE_OVERRIDES, resolveCompetitionStatus, type CompetitionStatusInput } from "@/lib/competition-status";

export default function CompetitionLifecycle({ competition, patch }: {
  competition: CompetitionStatusInput;
  patch: (body: Record<string, unknown>, message?: string) => Promise<boolean>;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const status = resolveCompetitionStatus(competition);
  const change = async (phaseOverride: string | null) => {
    if (busy || phaseOverride === competition.phaseOverride) return;
    if (phaseOverride === "closed" && !await confirm({
      title: "대회를 종료할까요?",
      description: "진행 중 대시보드에서 제외하고 새 신청과 투표를 중단합니다. 참가작·집계·공개 결과 링크는 그대로 남습니다.",
      confirmLabel: "대회 종료",
    })) return;
    if (status.phase === "closed" && phaseOverride !== "closed" && !await confirm({ title: "대회를 다시 진행할까요?", description: "선택한 상태와 일정에 따라 접수·투표 및 대시보드 표시가 다시 활성화될 수 있습니다.", confirmLabel: "상태 변경" })) return;
    setBusy(true);
    try { await patch({ phaseOverride }, phaseOverride === "closed" ? "대회를 종료했어요. 대시보드에서 제외됩니다." : "대회 상태를 변경했어요"); }
    catch { toast.error("상태를 바꾸지 못했어요. 연결을 확인하고 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">진행 상태
        <FieldSelect value={competition.phaseOverride ?? "auto"} onChange={e => void change(e.target.value === "auto" ? null : e.target.value)} disabled={busy} className="w-auto">
          <option value="auto">자동 · {COMPETITION_PHASE_META[resolveCompetitionStatus({ ...competition, phaseOverride: null }).phase].label}</option>
          {COMPETITION_PHASE_OVERRIDES.map(phase => <option key={phase} value={phase}>{COMPETITION_PHASE_META[phase].label}</option>)}
        </FieldSelect>
      </label>
      {status.phase !== "closed" && <Btn tone="ghost" disabled={busy} onClick={() => void change("closed")}><CheckCircle2 className="h-4 w-4" aria-hidden />대회 종료</Btn>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{status.phase === "closed" ? "종료된 대회입니다. 대시보드에서는 숨기고 대회 목록과 결과는 유지합니다." : status.phase === "announced" ? "발표가 완료되어 대시보드에서 제외됩니다. 대회 목록에서 계속 관리할 수 있습니다." : "완료된 대회는 ‘대회 종료’로 정리하세요. 종료 후에도 기록과 결과를 볼 수 있습니다."}</p>
  </div>;
}
