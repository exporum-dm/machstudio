"use client";

/**
 * "현장 체크인" 탭 — 빌더형 사전등록 전용(등록번호·QR 이 있는 쪽).
 *
 * 위: 고치는 영역 — 켜고 끄기 · PIN · 시간대 · 운영요원 링크(복사·QR). 값은 그 자리에서 바뀐다.
 * 아래: 읽는 영역 — 오늘 입장 인원이 헤드라인, 일자별 표, 최근 스캔. 15초마다 새로 고친다.
 *
 * 위험한 조작(링크 새로 만들기 = 운영요원 전원 링크 교체)만 작게, 확인 뒤에 둔다.
 */
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, ExternalLink, KeyRound, Loader2, RefreshCw, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Btn, Chip, FINISH, R } from "@/components/ui/primitives";
import { CHECKIN_TIMEZONES, dateTimeIn, normalizePin } from "@/lib/collect-checkin";

interface CheckinState {
  builder: boolean;
  enabled: boolean;
  timezone: string;
  pinSet: boolean;
  url: string;
  today: string;
  eventDates: string[];
  byDay: { eventDate: string; scans: number; unique: number }[];
  recent: { id: string; scannedAt: string; method: string; staffLabel: string; registrationNo: string | null; name: string; visitorType: string }[];
}

const METHOD_LABEL: Record<string, string> = { camera: "카메라", scanner: "스캐너", manual: "직접 입력" };

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : `bg-secondary ${FINISH.s2}`}`}
    >
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export default function CheckinTab({ sourceId, canEdit }: { sourceId: string; canEdit: boolean }) {
  const confirm = useConfirm();
  const [state, setState] = useState<CheckinState | null>(null);
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/collect-sources/${sourceId}/checkin`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "불러오지 못했어요");
    return data as CheckinState;
  }, [sourceId]);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      load()
        .then((d) => { if (!cancelled) setState(d); })
        .catch((e) => { if (!cancelled) setError((e as Error).message); });
    void tick();
    // 행사 중 이 탭을 띄워 두면 입장 인원이 따라 올라간다
    const t = setInterval(() => { if (document.visibilityState === "visible") void tick(); }, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [load]);

  // 운영요원이 자기 휴대폰으로 찍어서 여는 QR
  useEffect(() => {
    let cancelled = false;
    if (!state?.url) return;
    QRCode.toDataURL(state.url, { errorCorrectionLevel: "M", margin: 2, width: 320 })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [state?.url]);

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/checkin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "저장하지 못했어요");
      setState((s) => (s ? { ...s, ...data } : s));
      toast.success(okMsg);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!state?.url) return;
    try {
      await navigator.clipboard.writeText(state.url);
      toast.success("링크를 복사했어요");
    } catch {
      toast.error("복사하지 못했어요");
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: "체크인 링크를 새로 만들까요?",
      description: "지금 링크는 바로 열리지 않게 돼요. 운영요원에게 새 링크를 다시 보내야 해요. 링크가 밖으로 샜을 때 쓰세요.",
      confirmLabel: "새로 만들기",
      tone: "danger",
    });
    if (ok) await patch({ regenerateToken: true }, "새 링크를 만들었어요");
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!state) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중</div>;
  if (!state.builder) {
    return <p className="text-sm text-muted-foreground">현장 체크인은 등록번호·QR을 발급하는 빌더형 사전등록에서만 쓸 수 있어요.</p>;
  }

  const todayRow = state.byDay.find((d) => d.eventDate === state.today);
  const days = Array.from(new Set([...state.eventDates, ...state.byDay.map((d) => d.eventDate)])).sort();

  return (
    <div className="grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* 설정 */}
      <section className={`${R.panel} ${FINISH.s1} min-w-0 space-y-5 bg-card p-5`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><ScanLine className="h-4 w-4 text-emerald-500" /> 현장 체크인</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              켜면 운영요원이 휴대폰으로 방문자 QR을 찍어 입장을 기록해요. 스캔할 때마다 시각이 쌓이고, 수집 데이터 표와 CSV에 입장 시각이 나와요.
            </p>
          </div>
          <Switch label="현장 체크인" on={state.enabled} disabled={!canEdit || saving} onChange={(enabled) => patch({ enabled }, enabled ? "현장 체크인을 켰어요" : "현장 체크인을 껐어요")} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="checkin-pin">운영요원 PIN (숫자 4자리)</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="checkin-pin"
                value={pin}
                onChange={(e) => setPin(normalizePin(e.target.value))}
                inputMode="numeric"
                autoComplete="off"
                disabled={!canEdit}
                placeholder={state.pinSet ? "설정됨 · 바꾸려면 새 4자리 입력" : "4자리 입력"}
                className={`w-full ${R.control} ${FINISH.s2} bg-background py-2 pl-9 pr-3 font-mono text-sm tracking-[0.3em] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring`}
              />
            </div>
            <Btn
              tone="key"
              disabled={!canEdit || pin.length !== 4 || saving}
              onClick={async () => {
                if (await patch({ pin }, state.pinSet ? "PIN을 바꿨어요 — 운영요원은 새 PIN으로 다시 들어와야 해요" : "PIN을 저장했어요")) {
                  setPin("");
                  setState((s) => (s ? { ...s, pinSet: true } : s));
                }
              }}
            >
              저장
            </Btn>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {state.pinSet ? "PIN이 설정돼 있어요. 바꾸면 이미 들어와 있던 운영요원도 새 PIN을 다시 입력해야 해요." : "PIN이 없으면 운영요원이 들어올 수 없어요."}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="checkin-tz">행사 시간대</label>
          <select
            id="checkin-tz"
            value={state.timezone}
            disabled={!canEdit || saving}
            onChange={(e) => patch({ timezone: e.target.value }, "시간대를 바꿨어요")}
            className={`w-full ${R.control} ${FINISH.s2} min-h-9 bg-background px-2 text-sm`}
          >
            {CHECKIN_TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <p className="text-[11px] text-muted-foreground">입장 날짜와 시각이 이 시간대로 기록돼요. 해외 전시는 현지 시간대로 맞춰 주세요.</p>
        </div>

        {state.enabled && state.url ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-medium">운영요원 링크</p>
            <div className={`flex items-center gap-1 ${R.control} bg-secondary/60 p-1.5`}>
              <span className="min-w-0 flex-1 truncate px-1.5 font-mono text-xs">{state.url}</span>
              <Btn tone="ghost" className="px-2" onClick={copy} aria-label="링크 복사"><Copy className="h-4 w-4" /></Btn>
              <a href={state.url} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-9 items-center px-2 text-muted-foreground hover:text-foreground ${R.control}`} aria-label="새 창으로 열기">
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <div className="flex items-center gap-4">
              {/* data: URL 이라 next/image 최적화 대상이 아니다 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qr && <img src={qr} alt="운영요원 링크 QR" width={120} height={120} className={`${R.surface} bg-white p-1`} />}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                운영요원은 이 QR을 휴대폰 카메라로 찍거나 링크를 열고, PIN을 넣으면 바로 스캔할 수 있어요.
                {!state.pinSet && <b className="block pt-1 text-amber-600 dark:text-amber-400">PIN을 먼저 저장해 주세요.</b>}
              </p>
            </div>
            {canEdit && (
              <button type="button" onClick={regenerate} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
                링크 새로 만들기 (예전 링크 막기)
              </button>
            )}
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">켜면 운영요원 링크와 QR이 여기 나타나요.</p>
        )}
      </section>

      {/* 현황 */}
      <section className="min-w-0 space-y-4">
        <div className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">오늘 입장 ({state.today})</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{todayRow?.unique ?? 0}<span className="ml-1 text-base font-medium text-muted-foreground">명</span></p>
              <p className="text-xs text-muted-foreground tabular-nums">스캔 {todayRow?.scans ?? 0}회 (다시 찍은 것 포함)</p>
            </div>
            <Btn tone="ghost" className="px-2" onClick={() => load().then(setState).catch(() => {})} aria-label="새로고침"><RefreshCw className="h-4 w-4" /></Btn>
          </div>
          {days.length > 0 && (
            <ul className="mt-4 divide-y divide-border text-sm">
              {days.map((d) => {
                const row = state.byDay.find((x) => x.eventDate === d);
                return (
                  <li key={d} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-1.5 tabular-nums">
                      {d}
                      {state.eventDates.includes(d) && <Chip className="py-0">개최일</Chip>}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      <b className="text-foreground">{row?.unique ?? 0}</b>명 · 스캔 {row?.scans ?? 0}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`${R.panel} ${FINISH.s1} bg-card p-5`}>
          <h3 className="text-sm font-semibold">최근 스캔</h3>
          {state.recent.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">아직 스캔 기록이 없어요.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {state.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name || r.registrationNo}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[r.visitorType, METHOD_LABEL[r.method] ?? r.method, r.staffLabel].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dateTimeIn(state.timezone, r.scannedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
