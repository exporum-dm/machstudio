"use client";

/**
 * 번역 표 — 기본 언어로 쓴 글 **옆에** 그 언어의 번역을 적는다.
 *
 * ── 왜 빌더를 언어별로 여러 벌 두지 않나 ──────────────────────────────
 * 언어마다 빌더를 따로 열어 주면 영어에서만 항목을 하나 더하는 일이 반드시 생긴다.
 * 그 순간 두 언어의 저장 키가 달라지고, 등록 데이터를 **한 테이블에 모으려던 이유**가
 * 사라진다. 구조는 기본 언어 한 곳에서만 바꾸고, 다른 언어는 문구만 채운다.
 *
 * ── 영역 판정(AGENTS.md §2 고치는 영역) ───────────────────────────────
 * 여기는 고치는 영역이다. 그래서 **한 행 = 한 문구, 열 = 원문·번역**의 인라인 표이고,
 * 접기·모달 뒤로 숨기지 않는다. 저장은 상위의 자동저장에 얹힌다(별도 저장 버튼 없음).
 *
 * 수집 빌더와 웨비나 등록 폼이 **같은 컴포넌트**를 쓴다 — 저장 구조는 다르지만 편집
 * 경험까지 두 벌이면 한쪽에만 들어가는 개선이 생긴다(`lib/translation-entry` 머리말).
 */
import { useMemo } from "react";
import { Copy } from "lucide-react";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { translationProgress, type TranslationEntry } from "@/lib/translation-entry";
import { formLocaleLabel } from "@/lib/form-locale";

export function TranslationTable<TConfig>({
  config,
  entries,
  locale,
  baseLocale,
  onChange,
  emptyHint,
}: {
  config: TConfig;
  entries: TranslationEntry<TConfig>[];
  /** 지금 번역 중인 언어. 기본 언어가 들어오면 안 된다(호출부가 가른다). */
  locale: string;
  baseLocale: string;
  onChange: (next: TConfig) => void;
  /** 번역할 글이 아직 없을 때 어디를 채우라고 안내할지 — 제품마다 탭 이름이 다르다. */
  emptyHint: string;
}) {
  const { done, total } = translationProgress(entries);

  // 묶음 순서는 폼이 그려지는 순서를 따른다 — 표를 위에서 아래로 읽으면 폼을 위에서
  // 아래로 읽는 것과 같아야 "어디 문구인지" 를 매번 되짚지 않는다.
  const groups = useMemo(() => {
    const map = new Map<string, TranslationEntry<TConfig>[]>();
    for (const e of entries) {
      const list = map.get(e.group);
      if (list) list.push(e);
      else map.set(e.group, [e]);
    }
    return [...map.entries()];
  }, [entries]);

  if (total === 0) {
    return (
      <p className="rounded-xl bg-secondary/40 p-6 text-center text-xs leading-relaxed text-muted-foreground">
        번역할 문구가 아직 없어요.
        <br />
        <b className="text-foreground">{formLocaleLabel(baseLocale)}</b> {emptyHint}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          원문 옆에 <b className="text-foreground">{formLocaleLabel(locale)}</b> 문구를 적어요. 비워 두면 그 칸만{" "}
          {formLocaleLabel(baseLocale)}로 나갑니다.
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            done === total ? "bg-emerald-500/12 text-emerald-600" : "bg-amber-500/12 text-amber-700 dark:text-amber-400"
          }`}
        >
          {done} / {total}
        </span>
      </div>

      {groups.map(([group, rows]) => (
        <section key={group} className={`${R.surface} bg-card p-3 ${FINISH.s2}`}>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{group}</h3>
          <div className="space-y-2">
            {rows.map((entry) => (
              <TranslationRow key={entry.id} entry={entry} config={config} onChange={onChange} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TranslationRow<TConfig>({
  entry,
  config,
  onChange,
}: {
  entry: TranslationEntry<TConfig>;
  config: TConfig;
  onChange: (next: TConfig) => void;
}) {
  const set = (value: string) => onChange(entry.write(config, value));

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-2">
      <div className="min-w-0">
        <p className="mb-1 truncate text-[11px] text-muted-foreground" title={entry.context}>
          {entry.context}
        </p>
        {/* 원문은 **읽는 값**이다 — 입력칸처럼 보이면 여기서 고치려 들고, 그러면 기본 언어가 바뀐다. */}
        <p className="whitespace-pre-wrap break-words rounded-lg bg-secondary/40 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          {entry.base}
        </p>
      </div>

      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">번역</span>
          {/* 원문 그대로 쓰는 칸(고유명사·"Email")이 실제로 흔하다 — 타이핑을 시키지 않는다. */}
          <button
            type="button"
            onClick={() => set(entry.base)}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Copy className="h-3 w-3" />원문 그대로
          </button>
        </div>
        {entry.multiline ? (
          <textarea
            value={entry.value}
            onChange={(e) => set(e.target.value)}
            rows={Math.min(8, Math.max(3, entry.base.split("\n").length))}
            placeholder={entry.base}
            className={`${FIELD_CLS} w-full resize-y text-xs leading-relaxed`}
          />
        ) : (
          <input
            value={entry.value}
            onChange={(e) => set(e.target.value)}
            placeholder={entry.base}
            className={`${FIELD_CLS} w-full text-xs`}
          />
        )}
      </div>
    </div>
  );
}
