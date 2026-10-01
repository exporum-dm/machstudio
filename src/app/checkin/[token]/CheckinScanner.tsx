"use client";

/**
 * 현장 체크인 스캐너 — 운영요원 휴대폰 화면.
 *
 * 다루는 영역(AGENTS.md §3): 줄이 서 있는 입구에서 쓰는 도구라 **훑기 쉬움**이 전부다.
 *  · 판정은 색 + 형태로 즉시 구분 — 초록(오늘 첫 입장) · 노랑(다시 스캔) · 빨강(명단에 없음/다른 행사)
 *  · 진동·소리로도 알린다 — 운영요원은 화면보다 방문자를 본다
 *  · 입력 세 가지를 한 화면에서: 카메라 · 번호 직접 입력 · 바코드 스캐너(키보드처럼 들어온다)
 *
 * 카메라 프레임은 jsQR 로 브라우저 안에서 읽는다(서버로 영상이 가지 않는다). 같은 QR 을 들고 있으면
 * 연달아 읽히므로 SAME_CODE_COOLDOWN_MS 안의 같은 코드는 한 번만 보낸다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, CheckCircle2, AlertTriangle, XCircle, Keyboard, Loader2, ScanLine, UserRound } from "lucide-react";
import { shouldSubmitScan, timeIn, type CheckinMethod, type ScanResult } from "@/lib/collect-checkin";

interface Status {
  sourceName: string;
  timezone: string;
  pinSet: boolean;
  authed: boolean;
  today?: { date: string; scans: number; unique: number };
}

interface Shown extends ScanResult {
  key: number;
  method: CheckinMethod;
}

const STAFF_KEY = "mc_checkin_staff_label";

function feedback(kind: "ok" | "warn" | "bad") {
  try {
    navigator.vibrate?.(kind === "ok" ? 80 : kind === "warn" ? [60, 60, 60] : [200, 80, 200]);
  } catch {
    /* 진동이 없는 기기 */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === "ok" ? 1046 : kind === "warn" ? 660 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (kind === "bad" ? 0.35 : 0.12));
    osc.onended = () => void ctx.close();
  } catch {
    /* 소리를 못 내도 판정은 화면에 보인다 */
  }
}

export function CheckinScanner({ token, sourceName, timezone }: { token: string; sourceName: string; timezone: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/checkin/${token}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "불러오지 못했어요");
      setStatus(data);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/checkin/${token}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setLoadError(data.error || "불러오지 못했어요");
        else setStatus(data);
      })
      .catch(() => { if (!cancelled) setLoadError("인터넷 연결을 확인해 주세요"); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-dvh bg-neutral-950 text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-neutral-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <ScanLine className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{sourceName}</p>
            <p className="text-[11px] text-white/50">현장 체크인</p>
          </div>
          {status?.today && (
            <div className="text-right text-[11px] leading-tight text-white/70">
              <p><b className="text-base text-white tabular-nums">{status.today.unique}</b> 명</p>
              <p className="tabular-nums">스캔 {status.today.scans}</p>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-10 pt-4">
        {loadError ? (
          <p className="rounded-2xl bg-white/5 p-6 text-center text-sm text-white/70">{loadError}</p>
        ) : !status ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중</div>
        ) : !status.authed ? (
          <PinGate token={token} pinSet={status.pinSet} onPassed={refresh} />
        ) : (
          <ScanPanel token={token} timezone={timezone} onScanned={refresh} onUnauthorized={refresh} />
        )}
      </main>
    </div>
  );
}

// ─── PIN ─────────────────────────────────────────────────────────────────

function PinGate({ token, pinSet, onPassed }: { token: string; pinSet: boolean; onPassed: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/checkin/${token}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "확인하지 못했어요");
      onPassed();
    } catch (e) {
      setError((e as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (!pinSet) {
    return <p className="rounded-2xl bg-white/5 p-6 text-center text-sm text-white/70">아직 PIN이 설정되지 않았어요. 관리자에게 PIN 설정을 요청해 주세요.</p>;
  }

  return (
    <form
      className="mx-auto mt-10 max-w-xs space-y-4 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (pin.length === 4) void submit(pin);
      }}
    >
      <p className="text-lg font-semibold">PIN 4자리를 입력해 주세요</p>
      <p className="text-xs text-white/50">관리자에게 받은 번호예요. 한 번 입력하면 오늘은 다시 묻지 않아요.</p>
      <input
        value={pin}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 4);
          setPin(v);
          setError("");
          if (v.length === 4) void submit(v);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        aria-label="PIN"
        className="w-full rounded-2xl bg-white/10 py-4 text-center font-mono text-3xl tracking-[0.6em] outline-none ring-emerald-400/60 focus:ring-2"
        placeholder="••••"
        disabled={busy}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      {busy && <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/60" />}
    </form>
  );
}

// ─── 스캔 ────────────────────────────────────────────────────────────────

function ScanPanel({
  token,
  timezone,
  onScanned,
  onUnauthorized,
}: {
  token: string;
  timezone: string;
  onScanned: () => void;
  onUnauthorized: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [history, setHistory] = useState<Shown[]>([]);
  const [manual, setManual] = useState("");
  const [staff, setStaff] = useState(() => {
    try {
      return localStorage.getItem(STAFF_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);

  // 앞 스캔을 저장하는 동안 들어온 스캐너·직접 입력은 버리지 않고 줄 세운다 — 붐비는 입구에서
  // 바로 다음 사람을 찍으면 그게 사라지던 문제(카메라는 다시 읽으니 줄 세우지 않는다).
  const queueRef = useRef<Array<{ code: string; method: CheckinMethod }>>([]);

  const submit = useCallback(
    async (code: string, method: CheckinMethod): Promise<void> => {
      const now = Date.now();
      if (!shouldSubmitScan(code, lastRef.current, now)) return;
      if (busyRef.current) {
        if (method !== "camera" && !queueRef.current.some((q) => q.code === code)) queueRef.current.push({ code, method });
        return;
      }
      lastRef.current = { code, at: now };
      busyRef.current = true;
      setSending(true);
      try {
        const res = await fetch(`/api/checkin/${token}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, method, staffLabel: staff }),
        });
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as ScanResult & { error?: string };
        if (!res.ok) throw new Error(data.error || "기록하지 못했어요");
        const item: Shown = { ...data, key: now, method };
        setShown(item);
        setHistory((h) => [item, ...h].slice(0, 12));
        feedback(data.status === "first" ? "ok" : data.status === "repeat" ? "warn" : "bad");
        if (data.status === "first" || data.status === "repeat") onScanned();
      } catch (e) {
        setShown({ status: "invalid", key: now, method, person: undefined, scannedAt: undefined, todayCount: undefined, firstAtToday: undefined });
        setCameraError((e as Error).message);
        feedback("bad");
      } finally {
        busyRef.current = false;
        setSending(false);
        const next = queueRef.current.shift();
        if (next) setTimeout(() => void submitRef.current(next.code, next.method), 0);
      }
    },
    [token, staff, onScanned, onUnauthorized],
  );
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // 카메라 프레임 읽기
  useEffect(() => {
    if (!cameraOn) return;
    let raf = 0;
    let lastTick = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - lastTick < 140) return; // 초당 7번이면 충분하고 배터리를 덜 쓴다
      lastTick = t;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) return;
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (!w || !h) return;
      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      if (found?.data) void submit(found.data, "camera");
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cameraOn, submit]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    void wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }, []);

  const startCamera = async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setCameraOn(true);
      // 스캔 중 화면이 꺼지지 않게 — 지원 안 하는 브라우저는 그냥 넘어간다
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wakeRef.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* noop */
      }
    } catch (e) {
      const name = (e as { name?: string }).name;
      setCameraError(
        name === "NotAllowedError"
          ? "카메라 권한이 거부됐어요. 브라우저 설정에서 카메라를 허용해 주세요."
          : "카메라를 켜지 못했어요. 번호 직접 입력이나 바코드 스캐너를 써 주세요.",
      );
    }
  };

  useEffect(() => stopCamera, [stopCamera]);

  // 바코드 스캐너(키보드처럼 빠르게 입력 후 Enter) — 입력칸에 포커스가 없을 때만
  useEffect(() => {
    let buf = "";
    let lastKey = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const now = Date.now();
      if (now - lastKey > 80) buf = ""; // 사람 타이핑은 이보다 느리다
      lastKey = now;
      if (e.key === "Enter") {
        if (buf.length >= 13) void submit(buf, "scanner");
        buf = "";
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const saveStaff = (v: string) => {
    setStaff(v);
    try {
      localStorage.setItem(STAFF_KEY, v);
    } catch {
      /* 저장 못 해도 이번 화면에서는 쓴다 */
    }
  };

  return (
    <div className="space-y-4">
      {/* 카메라 */}
      {/* 카메라가 켜져 있으면 판정 카드를 화면 아래쪽에 겹쳐 띄운다 — 스크롤 없이 영상과 결과를 같이 본다 */}
      <div className="relative aspect-[3/4] max-h-[64dvh] w-full overflow-hidden rounded-3xl bg-black">
        <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${cameraOn ? "" : "hidden"}`} />
        {cameraOn ? (
          <>
            <div className="pointer-events-none absolute inset-x-[16%] top-[10%] aspect-square rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            {shown && (
              <div className="absolute inset-x-2 bottom-2">
                <ResultCard result={shown} timezone={timezone} overlay />
              </div>
            )}
            {sending && <Loader2 className="absolute right-3 top-3 h-5 w-5 animate-spin text-white/80" />}
            <button type="button" onClick={stopCamera} className="absolute bottom-3 right-3 rounded-full bg-black/60 p-2.5 text-white/80" aria-label="카메라 끄기">
              <CameraOff className="h-5 w-5" />
            </button>
          </>
        ) : (
          <button type="button" onClick={startCamera} className="flex h-full w-full flex-col items-center justify-center gap-3 text-white/80 active:bg-white/5">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-neutral-950"><Camera className="h-8 w-8" /></span>
            <span className="text-base font-semibold">카메라로 QR 스캔</span>
            <span className="text-xs text-white/50">누르면 카메라 권한을 물어봐요</span>
          </button>
        )}
      </div>
      {cameraError && <p className="text-center text-xs text-amber-300">{cameraError}</p>}

      {/* 판정 */}
      {shown && !cameraOn && <ResultCard result={shown} timezone={timezone} />}

      {/* 번호 직접 입력 */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            lastRef.current = null; // 같은 번호를 일부러 다시 넣는 경우는 막지 않는다
            void submit(manual.trim(), "manual");
            setManual("");
          }
        }}
      >
        <div className="relative flex-1">
          <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, "").slice(0, 13))}
            inputMode="numeric"
            placeholder="등록번호 13자리 직접 입력"
            aria-label="등록번호 직접 입력"
            className="w-full rounded-xl bg-white/10 py-3 pl-9 pr-3 font-mono text-sm tracking-wider outline-none ring-emerald-400/60 placeholder:font-sans placeholder:tracking-normal placeholder:text-white/35 focus:ring-2"
          />
        </div>
        <button type="submit" disabled={manual.length < 13 || sending} className="rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 disabled:opacity-40">
          확인
        </button>
      </form>

      <label className="flex items-center gap-2 text-xs text-white/50">
        <UserRound className="h-3.5 w-3.5" aria-hidden />
        <span className="shrink-0">담당·입구</span>
        <input
          value={staff}
          onChange={(e) => saveStaff(e.target.value.slice(0, 40))}
          placeholder="예: 입구 A · 김민지 (선택)"
          className="min-w-0 flex-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-white outline-none placeholder:text-white/30 focus:bg-white/10"
        />
      </label>
      <p className="text-[11px] leading-relaxed text-white/35">USB·블루투스 바코드 스캐너를 연결했다면 이 화면에서 바로 찍으면 돼요.</p>

      {/* 이 기기의 최근 스캔 */}
      {history.length > 0 && (
        <section className="space-y-1.5 pt-2">
          <h2 className="text-xs font-semibold text-white/50">이 기기 최근 스캔</h2>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-white/5">
            {history.map((h) => (
              <li key={h.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                <StatusIcon status={h.status} small />
                <span className="min-w-0 flex-1 truncate">{h.person?.name || h.person?.registrationNo || statusText(h.status)}</span>
                <span className="shrink-0 text-xs tabular-nums text-white/40">{timeIn(timezone, new Date(h.key))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function statusText(s: ScanResult["status"]): string {
  return {
    first: "입장 확인",
    repeat: "다시 스캔",
    not_found: "명단에 없음",
    other_event: "다른 행사 등록번호",
    invalid: "등록번호를 읽지 못했어요",
  }[s];
}

function StatusIcon({ status, small }: { status: ScanResult["status"]; small?: boolean }) {
  const cls = small ? "h-4 w-4 shrink-0" : "h-7 w-7 shrink-0";
  if (status === "first") return <CheckCircle2 className={`${cls} text-emerald-400`} aria-hidden />;
  if (status === "repeat") return <AlertTriangle className={`${cls} text-amber-300`} aria-hidden />;
  return <XCircle className={`${cls} text-red-400`} aria-hidden />;
}

function ResultCard({ result, timezone, overlay }: { result: Shown; timezone: string; overlay?: boolean }) {
  const ring = result.status === "first" ? "ring-emerald-400/70" : result.status === "repeat" ? "ring-amber-300/70" : "ring-red-400/70";
  // 영상 위에 겹칠 땐 글자가 읽히도록 짙은 바탕(색은 테두리·아이콘이 말한다), 아래 놓일 땐 옅은 색 바탕
  const bg = overlay
    ? result.status === "first" ? "bg-emerald-950/90" : result.status === "repeat" ? "bg-amber-950/90" : "bg-red-950/90"
    : result.status === "first" ? "bg-emerald-500/15" : result.status === "repeat" ? "bg-amber-400/15" : "bg-red-500/15";
  const p = result.person;
  return (
    <section
      key={result.key}
      className={`animate-in fade-in zoom-in-95 rounded-3xl ring-2 duration-150 motion-reduce:animate-none ${ring} ${bg} ${overlay ? "p-4 backdrop-blur" : "p-5"}`}
      aria-live="assertive"
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={result.status} />
        <p className="text-lg font-bold">{statusText(result.status)}</p>
      </div>
      {p ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-2xl font-bold leading-tight">{p.name || "(이름 없음)"}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {p.visitorType && <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-medium">{p.visitorType}</span>}
            {p.company && <span className="text-white/80">{p.company}</span>}
          </div>
          {p.extras.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pt-1 text-sm">
              {p.extras.map((x) => (
                <div key={x.label} className="contents">
                  <dt className="text-white/50">{x.label}</dt>
                  <dd className="font-medium">{x.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="pt-1 font-mono text-xs text-white/40">{p.registrationNo}</p>
          {result.status === "repeat" && result.firstAtToday && (
            <p className="pt-1 text-sm text-amber-200">
              오늘 {result.todayCount}번째 스캔 · 첫 입장 {timeIn(timezone, result.firstAtToday)}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-white/70">
          {result.status === "not_found"
            ? "이 등록번호는 사전등록 명단에 없어요. 현장 등록으로 안내해 주세요."
            : result.status === "other_event"
              ? "다른 행사의 QR이에요. 이 행사 등록 QR인지 확인해 주세요."
              : "QR이 아니거나 번호가 틀려요. 다시 찍거나 번호를 직접 입력해 주세요."}
        </p>
      )}
    </section>
  );
}
