"use client";

import { useState } from "react";
import { fill, type ReferralBoardCopy } from "@/lib/collect-referral-copy";

type Result =
  | { kind: "found"; rank: number; count: number; label: string; rewarded: boolean }
  | { kind: "zero" }
  | { kind: "none" }
  | { kind: "error"; text: string };

/** 이름 + 연락처 뒤 4자리로 내 순위 찾기. 둘 다 맞아야 서버가 답한다. */
export function RankSearch({ sourceId, copy: T, accent }: { sourceId: string; copy: ReferralBoardCopy; accent: string }) {
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || last4.length !== 4) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ name: name.trim(), last4 });
      const res = await fetch(`/api/rank/${encodeURIComponent(sourceId)}/search?${qs}`, { cache: "no-store" });
      if (res.status === 429) { setResult({ kind: "error", text: T.tooMany }); return; }
      const data = await res.json().catch(() => null) as { registered?: boolean; me?: { rank: number; count: number; label: string; rewarded: boolean } | null } | null;
      if (!res.ok || !data) { setResult({ kind: "error", text: T.tooMany }); return; }
      setResult(data.me ? { kind: "found", ...data.me } : data.registered ? { kind: "zero" } : { kind: "none" });
    } catch {
      setResult({ kind: "error", text: T.tooMany });
    } finally {
      setBusy(false);
    }
  };

  const input = "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-base outline-none focus:border-neutral-400";
  return (
    <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{T.searchTitle}</h2>
      <p className="mt-0.5 text-xs text-neutral-500">{T.searchHelp}</p>
      <form onSubmit={submit} className="mt-3 grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
        <label className="sr-only" htmlFor="rank-name">{T.name}</label>
        <input id="rank-name" className={input} placeholder={T.name} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sr-only" htmlFor="rank-last4">{T.last4}</label>
        <input
          id="rank-last4"
          className={`${input} tabular-nums`}
          placeholder={T.last4}
          inputMode="numeric"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        <button
          type="submit"
          disabled={busy || !name.trim() || last4.length !== 4}
          className="col-span-2 h-11 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-1"
          style={{ background: accent }}
        >
          {busy ? T.searching : T.search}
        </button>
      </form>
      <div role="status" aria-live="polite">
        {result?.kind === "found" && (
          <p className="mt-3 rounded-xl bg-neutral-50 px-3.5 py-3 text-sm">
            <strong className="mr-1 text-lg tabular-nums" style={{ color: accent }}>{fill(T.rank, { rank: result.rank })}</strong>
            {fill(T.meFound, { label: result.label, rank: result.rank, n: result.count })}
            {result.rewarded && <span className="ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${accent} 12%, white)`, color: accent }}>{T.rewarded}</span>}
          </p>
        )}
        {result?.kind === "zero" && <p className="mt-3 text-sm text-neutral-600">{T.meZero}</p>}
        {result?.kind === "none" && <p className="mt-3 text-sm text-neutral-600">{T.notFound}</p>}
        {result?.kind === "error" && <p className="mt-3 text-sm text-rose-600">{result.text}</p>}
      </div>
    </section>
  );
}
