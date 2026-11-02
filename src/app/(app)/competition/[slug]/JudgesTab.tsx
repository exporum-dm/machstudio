"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { getPublicAppOrigin } from "@/lib/app-url";
import { toast } from "sonner";
import { InlineError } from "@/components/ui/inline-error";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { formatKst } from "@/lib/datetime";
import { normalizeCriteria, type JudgeCriterion } from "@/lib/competition-scoring";
import type { CompetitionDetail } from "./page";
import type { RoundDto } from "./VoteSettingsTab";

type JudgeRoundKind = "prelim" | "final";

interface Judge {
  id: string;
  name: string;
  email: string | null;
  affiliation: string | null;
  accessToken: string;
  weight: number;
  roundKind: JudgeRoundKind;
  hasPassword: boolean;
  savedCount: number;
  submittedCount: number;
  lastSeenAt: string | null;
}

const ROUND_KIND_LABEL: Record<JudgeRoundKind, string> = { prelim: "예선", final: "본선" };

export default function JudgesTab({
  competition,
  rounds,
  onRoundsChange,
}: {
  competition: CompetitionDetail;
  rounds: RoundDto[];
  onRoundsChange: (rounds: RoundDto[]) => void;
}) {
  const confirm = useConfirm();
  const [judges, setJudges] = useState<Judge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; affiliation: string; roundKind: JudgeRoundKind }>({
    name: "", email: "", affiliation: "", roundKind: "final",
  });
  const [creating, setCreating] = useState(false);
  /** 발급된 비밀번호는 이 화면에서만 보인다 — 저장은 해시라 다시 못 본다. */
  const [issued, setIssued] = useState<Record<string, string>>({});

  const fetchJudges = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/judges`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setJudges(data.judges ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [competition.id]);

  useEffect(() => { void Promise.resolve().then(fetchJudges); }, [fetchJudges]);

  const addJudge = async () => {
    if (!form.name.trim()) { toast.error("심사위원 이름을 입력해주세요"); return; }
    setCreating(true);
    try {
      const res = await fetch(`/api/competitions/${competition.id}/judges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "추가 실패"); return; }
      setJudges((prev) => [...prev, data.judge]);
      setIssued((prev) => ({ ...prev, [data.judge.id]: data.password }));
      // roundKind 는 남겨둔다 — 같은 라운드 심사위원을 여러 명 연달아 등록하는 게 보통이다.
      setForm((f) => ({ ...f, name: "", email: "", affiliation: "" }));
      toast.success(`${ROUND_KIND_LABEL[data.judge.roundKind as JudgeRoundKind]} 심사위원을 추가했어요 — 비밀번호를 지금 전달하세요`);
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (judge: Judge) => {
    const ok = await confirm({
      title: `${judge.name} 심사위원의 비밀번호를 재설정할까요?`,
      description: "기존 비밀번호와 로그인 상태가 즉시 무효가 돼요. 새 비밀번호를 다시 전달해야 합니다.",
      confirmLabel: "재설정",
    });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competition.id}/judges/${judge.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetPassword: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "재설정 실패"); return; }
    setIssued((prev) => ({ ...prev, [judge.id]: data.password }));
    toast.success("새 비밀번호를 발급했어요");
  };

  const rotateLink = async (judge: Judge) => {
    const ok = await confirm({
      title: `${judge.name} 심사위원의 링크를 새로 만들까요?`,
      description: "이미 보낸 링크는 즉시 열리지 않게 돼요.",
      confirmLabel: "새로 만들기",
    });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competition.id}/judges/${judge.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotateToken: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "실패"); return; }
    setJudges((prev) => prev.map((j) => (j.id === judge.id ? { ...j, accessToken: data.judge.accessToken } : j)));
    toast.success("새 링크를 발급했어요");
  };

  const changeRound = async (judge: Judge, roundKind: JudgeRoundKind) => {
    if (judge.roundKind === roundKind) return;
    setJudges((prev) => prev.map((j) => (j.id === judge.id ? { ...j, roundKind } : j)));
    const res = await fetch(`/api/competitions/${competition.id}/judges/${judge.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundKind }),
    });
    if (!res.ok) {
      setJudges((prev) => prev.map((j) => (j.id === judge.id ? { ...j, roundKind: judge.roundKind } : j)));
      toast.error("배정 변경 실패");
      return;
    }
    toast.success(`${ROUND_KIND_LABEL[roundKind]} 심사위원으로 옮겼어요`);
  };

  const removeJudge = async (judge: Judge) => {
    const ok = await confirm({
      title: `${judge.name} 심사위원을 삭제할까요?`,
      description: "이 심사위원이 매긴 점수도 함께 삭제되고 집계에서 빠져요.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/competitions/${competition.id}/judges/${judge.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    setJudges((prev) => prev.filter((j) => j.id !== judge.id));
    toast.success("삭제했어요");
  };

  return (
    <div className="space-y-4">
      <CriteriaEditor competition={competition} rounds={rounds} onRoundsChange={onRoundsChange} />

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">심사위원</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          심사위원마다 다른 링크와 비밀번호를 발급해요. <b>배정된 라운드의 전 참가작을 심사합니다.</b>
        </p>

        <div className="mt-4 flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">배정 라운드</span>
          <div className="flex gap-1">
            {(["prelim", "final"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setForm((f) => ({ ...f, roundKind: value }))}
                className={`px-2.5 py-1 text-[11px] transition-colors ${R.control} ${
                  form.roundKind === value ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {ROUND_KIND_LABEL[value]} 심사
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="이름"
            className={`${FIELD_CLS} h-9`}
          />
          <input
            value={form.affiliation}
            onChange={(e) => setForm((f) => ({ ...f, affiliation: e.target.value }))}
            placeholder="소속 (선택)"
            className={`${FIELD_CLS} h-9`}
          />
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="이메일 (선택)"
            className={`${FIELD_CLS} h-9`}
          />
          <button
            onClick={addJudge}
            disabled={creating}
            className={`flex items-center justify-center gap-1 bg-violet-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50 ${R.control}`}
          >
            <Plus className="h-3.5 w-3.5" /> 추가
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <InlineError message="심사위원을 불러오지 못했어요" onRetry={fetchJudges} />
          ) : judges.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
              <Users className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">아직 심사위원이 없어요</p>
            </div>
          ) : (
            judges.map((judge) => (
              <JudgeRow
                key={judge.id}
                judge={judge}
                issuedPassword={issued[judge.id]}
                onResetPassword={() => resetPassword(judge)}
                onRotateLink={() => rotateLink(judge)}
                onRemove={() => removeJudge(judge)}
                onChangeRound={(kind) => changeRound(judge, kind)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function JudgeRow({
  judge, issuedPassword, onResetPassword, onRotateLink, onRemove, onChangeRound,
}: {
  judge: Judge;
  issuedPassword?: string;
  onResetPassword: () => void;
  onRotateLink: () => void;
  onRemove: () => void;
  onChangeRound: (kind: JudgeRoundKind) => void;
}) {
  const [copied, setCopied] = useState(false);
  const origin = getPublicAppOrigin();
  const link = origin ? `${origin}/j/${judge.accessToken}` : "";

  return (
    <div className={`bg-background p-3 ${R.surface} ${FINISH.s2}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{judge.name}</span>
            {judge.affiliation && <span className="text-[11px] text-muted-foreground">{judge.affiliation}</span>}
            {judge.submittedCount > 0 && (
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                제출 {judge.submittedCount}건
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {judge.email ?? "이메일 없음"}
            {judge.lastSeenAt ? ` · 최근 접속 ${formatKst(judge.lastSeenAt)}` : " · 접속 기록 없음"}
          </p>
        </div>

        <div className={`flex shrink-0 gap-0.5 bg-secondary p-0.5 ${R.control}`}>
          {(["prelim", "final"] as const).map((value) => (
            <button
              key={value}
              onClick={() => onChangeRound(value)}
              className={`px-2 py-1 text-[11px] transition-colors ${R.control} ${
                judge.roundKind === value ? "bg-violet-500 text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {ROUND_KIND_LABEL[value]}
            </button>
          ))}
        </div>

        <button
          disabled={!link}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              toast.success("링크를 복사했어요");
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("복사에 실패했어요");
            }
          }}
          className={`flex items-center gap-1 bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} 링크
        </button>
        <button
          onClick={onResetPassword}
          className={`flex items-center gap-1 bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
        >
          <KeyRound className="h-3 w-3" /> 비밀번호
        </button>
        <button
          onClick={onRotateLink}
          className={`flex items-center gap-1 bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
          title="링크 재발급"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
        <button
          onClick={onRemove}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
          aria-label="삭제"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {issuedPassword && (
        <div className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            비밀번호: <code className="font-mono text-xs">{issuedPassword}</code>
          </p>
          <p className="mt-0.5 text-[10px] text-amber-700/80 dark:text-amber-400/80">
            지금 전달하세요. 이 화면을 벗어나면 다시 볼 수 없고, 잊으면 재설정만 가능해요.
          </p>
        </div>
      )}
    </div>
  );
}

function CriteriaEditor({
  competition, rounds, onRoundsChange,
}: {
  competition: CompetitionDetail;
  rounds: RoundDto[];
  onRoundsChange: (rounds: RoundDto[]) => void;
}) {
  const [kind, setKind] = useState<"prelim" | "final">("prelim");
  const round = rounds.find((r) => r.kind === kind);

  if (!round) return null;

  const save = async (body: Record<string, unknown>, message: string) => {
    const res = await fetch(`/api/competitions/${competition.id}/rounds/${round.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
    onRoundsChange(rounds.map((r) => (r.id === round.id ? { ...r, ...data.round } : r)));
    toast.success(message);
  };

  return (
    <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">심사 항목 · 배점</h2>
        <div className="flex gap-1">
          {(["prelim", "final"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setKind(value)}
              className={`px-2.5 py-1 text-[11px] transition-colors ${R.control} ${
                kind === value ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {value === "prelim" ? "예선" : "본선"}
            </button>
          ))}
        </div>
      </div>

      {/* key 로 라운드를 바꿀 때 폼을 새로 마운트한다 — effect 로 state 를 되맞추면
          저장 직후 서버 응답이 다시 흘러들어와 편집 중인 값을 덮어쓴다. */}
      <CriteriaForm key={round.id} round={round} save={save} />
    </section>
  );
}

function CriteriaForm({
  round,
  save,
}: {
  round: RoundDto;
  save: (body: Record<string, unknown>, message: string) => Promise<void>;
}) {
  const [criteria, setCriteria] = useState<JudgeCriterion[]>(() => normalizeCriteria(round.judgeCriteria));
  const [publicWeight, setPublicWeight] = useState(round.publicWeight);

  const total = criteria.reduce((sum, c) => sum + c.maxScore, 0);

  return (
    <>
      <div className="mt-3 space-y-1.5">
        {/*
          폭은 **래퍼가 갖고 입력은 w-full 을 유지한다**(primitives.tsx 의 FIELD_CLS 주석).
          `${FIELD_CLS} w-20` 처럼 덧붙이면 컴파일된 CSS 순서 때문에 .w-full 이 이겨서
          아무 효과가 없다 — 실제로 이 화면에서 제목 칸이 찌그러져 입력이 안 됐다.
        */}
        {criteria.length > 0 && (
          <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium text-muted-foreground">
            <span className="w-40 shrink-0">제목</span>
            <span className="min-w-0 flex-1">내용</span>
            <span className="w-20 shrink-0">배점</span>
            <span className="w-5 shrink-0" />
          </div>
        )}
        {criteria.map((criterion, index) => {
          const patch = (next: Partial<(typeof criteria)[number]>) => {
            const list = [...criteria];
            list[index] = { ...list[index], key: list[index].key || `c${index + 1}`, ...next };
            setCriteria(list);
          };
          return (
            <div key={index} className="flex items-start gap-1.5">
              <div className="w-40 shrink-0">
                <input
                  value={criterion.label}
                  onChange={(e) => patch({ label: e.target.value })}
                  placeholder="제목 (예: 창의성)"
                  className={`${FIELD_CLS} h-8`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <input
                  value={criterion.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="내용 — 이 항목에서 무엇을 보는지 (심사위원·공고에 함께 보여요)"
                  className={`${FIELD_CLS} h-8`}
                />
              </div>
              <div className="w-20 shrink-0">
                <input
                  type="number"
                  min={1}
                  value={criterion.maxScore}
                  onChange={(e) => patch({ maxScore: Math.max(1, Number(e.target.value) || 1) })}
                  placeholder="배점"
                  className={`${FIELD_CLS} h-8`}
                />
              </div>
              <button
                onClick={() => setCriteria(criteria.filter((_, i) => i !== index))}
                className="mt-1.5 rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
                aria-label="항목 삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCriteria([...criteria, { key: `c${criteria.length + 1}`, label: "", description: "", maxScore: 10 }])}
            className={`flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
          >
            <Plus className="h-3 w-3" /> 항목 추가
          </button>
          <span className="text-[11px] text-muted-foreground">만점 {total}점</span>
          <button
            onClick={() => save({ judgeCriteria: criteria.filter((c) => c.label.trim()) }, "심사 항목을 저장했어요")}
            className={`ml-auto bg-violet-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 ${R.control}`}
          >
            저장
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium">대중 : 심사단 비율</span>
          <span className="font-mono text-xs tabular-nums">
            {publicWeight} : {100 - publicWeight}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={publicWeight}
          onChange={(e) => setPublicWeight(Number(e.target.value))}
          onMouseUp={() => save({ publicWeight, judgeWeight: 100 - publicWeight }, "비율을 저장했어요")}
          onTouchEnd={() => save({ publicWeight, judgeWeight: 100 - publicWeight }, "비율을 저장했어요")}
          className="mt-2 w-full accent-violet-500"
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          대중 표와 심사 점수를 각각 0~100으로 맞춘 뒤 이 비율로 합산해요. 그래야 표 수가 심사를 압도하지 않아요.
        </p>
      </div>
    </>
  );
}
