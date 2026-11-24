import { buildStkCss } from "@/lib/stk-css";
import { contrastRatio } from "@/lib/color";
import type { Publication } from "@/lib/creator/model";
import type { CSSProperties } from "react";

export function CreatorPublication({ publication }: { publication: Publication }) {
  const { title, background, accent, entries } = publication;
  if (!entries.length) return null;
  const readable = (surface: string) => contrastRatio(surface, "#ffffff") >= contrastRatio(surface, "#171717") ? "#ffffff" : "#171717";
  const ink = readable(background);
  return (
    <section data-creator-publication className="stk-live overflow-hidden rounded-2xl bg-[var(--card)] p-5 sm:p-8"
      style={{ "--creator-on-accent": readable(accent) } as CSSProperties}>
      <style>{buildStkCss(accent, ink, background)}</style>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] items-start gap-4">
        {entries.map((entry, index) => (
          <article key={index} className="min-w-0 overflow-hidden rounded-xl bg-[var(--card-2)] shadow-[var(--card-shadow)]">
            {entry.image && (
              // eslint-disable-next-line @next/next/no-img-element -- Operator-provided image URL on the public profile.
              <img src={entry.image} alt="" className="aspect-[5/3] w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
            )}
            <div className="grid gap-2 p-5">
              {entry.award && <span className="w-fit rounded-full bg-[var(--key)] px-2.5 py-1 text-xs font-bold text-[var(--creator-on-accent)]">{entry.award}</span>}
              <h2 className="break-words text-lg font-semibold">{entry.name}</h2>
              {(entry.region || entry.languages) && <p className="break-words text-sm">{[entry.region, entry.languages].filter(Boolean).join(" · ")}</p>}
              {entry.bio && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.bio}</p>}
              {entry.interests && <p className="whitespace-pre-wrap break-words text-sm">{entry.interests}</p>}
              {entry.publicContact && <p className="break-words text-sm">{entry.publicContact}</p>}
              {entry.social && <a className="mt-2 w-fit rounded-lg bg-[var(--key)] px-3 py-2 text-sm font-medium text-[var(--creator-on-accent)] shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 motion-reduce:transition-none"
                href={entry.social} target="_blank" rel="noopener noreferrer">SNS 보기</a>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
