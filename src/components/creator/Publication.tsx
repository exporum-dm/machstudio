import { buildStkCss } from "@/lib/stk-css";
import { contrastRatio } from "@/lib/color";
import type { Publication } from "@/lib/creator/model";
import { parseAccount } from "@/lib/creator/social";

const publicationCss = `
.mach-creator-publication {
  container: creator-publication / inline-size;
  width: 100%;
  background: var(--card);
  color: var(--text);
  text-align: left;
  font: 15px/1.6 Pretendard, Inter, "Noto Sans", Arial, sans-serif;
}
.mach-creator-publication h2, .mach-creator-publication h3, .mach-creator-publication p,
.mach-creator-publication dl, .mach-creator-publication dd { margin: 0; }
.mach-creator-publication .mcp-inner { max-width: 1280px; margin: auto; padding: 78px 22px 88px; }
.mach-creator-publication .mcp-header { margin: 0 auto 44px; text-align: center; }
.mach-creator-publication .mcp-kicker { margin: 0 0 9px; font-weight: 750; color: var(--mcp-key-text); }
.mach-creator-publication .mcp-title { margin: 0; color: var(--text); font: 800 38px/1.2 Pretendard, Inter, Arial, sans-serif; overflow-wrap: anywhere; }
.mach-creator-publication .mcp-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 26px; }
.mach-creator-publication .mcp-card {
  display: flex; flex-direction: column; min-width: 0; overflow: hidden; overflow-wrap: anywhere;
  border-radius: 24px; background: var(--mcp-paper); box-shadow: var(--card-shadow);
}
.mach-creator-publication .mcp-image { display: block; width: 100%; max-width: none; height: 300px; object-fit: cover; }
.mach-creator-publication .mcp-body { display: flex; flex: 1; flex-direction: column; gap: 12px; padding: 24px 22px 22px; }
.mach-creator-publication .mcp-name { margin: 0; color: var(--text); font: 800 23px/1.25 Pretendard, Inter, Arial, sans-serif; }
.mach-creator-publication .mcp-handle { margin-top: -8px; color: var(--mcp-key-text); font-size: 13px; font-weight: 700; }
.mach-creator-publication .mcp-bio { color: var(--text); font-size: 14px; white-space: pre-wrap; }
.mach-creator-publication .mcp-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.mach-creator-publication .mcp-tag, .mach-creator-publication .mcp-award {
  width: fit-content; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 750;
}
.mach-creator-publication .mcp-tag { background: var(--key-dim); color: var(--mcp-key-text); }
.mach-creator-publication .mcp-award { background: var(--key); color: var(--mcp-on-key); }
.mach-creator-publication .mcp-details { display: grid; gap: 1px; overflow: hidden; border-radius: 14px; }
.mach-creator-publication .mcp-details div { display: grid; gap: 2px; padding: 10px 14px; background: var(--mcp-soft); }
.mach-creator-publication .mcp-details dt { color: var(--muted); font-size: 12px; }
.mach-creator-publication .mcp-details dd { font-size: 13px; font-weight: 700; white-space: pre-wrap; }
.mach-creator-publication .mcp-footer { display: grid; gap: 10px; margin-top: auto; }
.mach-creator-publication .mcp-link {
  display: grid; place-items: center; min-height: 44px; padding: 8px 12px; border-radius: 999px;
  background: var(--key); color: var(--mcp-on-key); font-size: 13px; font-weight: 750; text-decoration: none;
  transition: box-shadow 150ms ease, transform 150ms ease;
}
.mach-creator-publication .mcp-link:hover { box-shadow: var(--btn-shadow-hover); transform: translateY(-1px); }
.mach-creator-publication .mcp-link:active { transform: translateY(1px); }
.mach-creator-publication .mcp-link:focus-visible { outline: 2px solid var(--mcp-key-text); outline-offset: 3px; }
@container creator-publication (max-width: 1050px) {
  .mach-creator-publication .mcp-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
@container creator-publication (max-width: 680px) {
  .mach-creator-publication .mcp-inner { padding: 54px 15px 64px; }
  .mach-creator-publication .mcp-header { margin-bottom: 30px; }
  .mach-creator-publication .mcp-title { font-size: 29px; }
  .mach-creator-publication .mcp-grid { grid-template-columns: minmax(0,1fr); gap: 22px; }
  .mach-creator-publication .mcp-image { height: clamp(225px,86cqw,340px); }
}
@media (prefers-reduced-motion: reduce) {
  .mach-creator-publication .mcp-link { transition: none; }
  .mach-creator-publication .mcp-link:hover, .mach-creator-publication .mcp-link:active { transform: none; }
}
`;

function readable(surface: string) {
  return contrastRatio(surface, "#ffffff") >= contrastRatio(surface, "#171717") ? "#ffffff" : "#171717";
}

export function CreatorPublication({ publication, kicker, awards = false }: { publication: Publication; kicker?: string; awards?: boolean }) {
  const { title, background, accent, entries } = publication;
  if (!entries.length) return null;
  const ink = readable(background);
  const theme = `mcp-${background.slice(1)}-${accent.slice(1)}`;
  const tokens = buildStkCss(accent, ink, background).replaceAll(".stk-live", `.${theme}`);
  const keyText = contrastRatio(accent, background) >= 5 ? "var(--key)" : "var(--text)";
  const palette = `.${theme} {
    --mcp-paper: color-mix(in srgb, var(--card) 28%, ${readable(ink)});
    --mcp-soft: color-mix(in srgb, var(--mcp-paper) 95%, var(--text));
    --mcp-on-key: ${readable(accent)};
    --mcp-key-text: ${keyText};
  }`;
  return (
    <>
      <style>{tokens + palette + publicationCss}</style>
      <section data-creator-publication className={`mach-creator-publication ${theme}`}>
        <div className="mcp-inner">
          <header className="mcp-header">
            {kicker && <p className="mcp-kicker">{kicker}</p>}
            <h2 className="mcp-title">{title}</h2>
          </header>
          <div className="mcp-grid">
            {entries.map((entry, index) => {
              const tags = entry.interests?.split(/[·,\r\n]+/).map((tag) => tag.trim()).filter(Boolean) ?? [];
              const details = [
                ...(awards ? [["주요 분야", entry.interests]] : []),
                ["활동 지역", entry.region], ["언어", entry.languages],
                ["공개 연락처", entry.publicContact],
              ].filter(([, value]) => value?.trim());
              const account = entry.social ? parseAccount(entry.social) : null;
              return (
                <article key={entry.participantId ?? index} className="mcp-card">
                  {entry.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- Public profile image supplied by the operator.
                    <img src={entry.image} alt="" className="mcp-image" loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <div className="mcp-body">
                    {entry.award && <span className="mcp-award">{entry.award}</span>}
                    <h3 className="mcp-name">{entry.name}</h3>
                    {account?.platform && account.handle && <p className="mcp-handle">@{account.handle}</p>}
                    {entry.bio?.trim() && <p className="mcp-bio">{entry.bio}</p>}
                    {!awards && tags.length > 0 && <div className="mcp-tags">{tags.map((tag, i) => <span key={i} className="mcp-tag">{tag}</span>)}</div>}
                    {(details.length > 0 || entry.social) && <div className="mcp-footer">
                      {details.length > 0 && <dl className="mcp-details">
                        {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                      </dl>}
                      {entry.social && <a className="mcp-link" href={entry.social} target="_blank" rel="noopener noreferrer">SNS 보기</a>}
                    </div>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
