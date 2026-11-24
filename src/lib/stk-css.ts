import { onAccentColor, readableTextOn } from "@/lib/color";
import { webinarRadiusScale } from "@/lib/webinar-radius";

// 공개 화면과 임베드가 공유하는 STK 토큰과 기본 스타일.
export function buildStkCss(accent: string, text: string, surface: string, borderRadius?: string) {
  const rs = webinarRadiusScale(borderRadius);
  /**
   * 글자색은 **운영자가 고른 값을 그대로 쓰되, 배경 위에서 안 읽히면 뒤집는다**(readableTextOn).
   *
   * 테마 편집기는 글자색과 배경색을 따로 고르게 해 두었고, 그래서 흰 배경에 흰 글자·형광
   * 배경에 흰 글자 같은 조합이 실제로 저장된다. 여기서 한 번 거르면 이 토큰을 쓰는 네 화면
   * (대기·입장확인·시청·종료)과 설문 폼이 전부 같은 보호를 받는다 — 화면마다 따로 막지 않는다.
   * 3:1 미만일 때만 개입하므로 의도적인 저대비 디자인은 건드리지 않는다.
   */
  const ink = readableTextOn(surface, text);
  return `
.stk-live { --key: ${accent}; --on-key: ${onAccentColor(accent)}; --key-dim: color-mix(in srgb, ${accent} 12%, transparent); --key-border: color-mix(in srgb, ${accent} 36%, transparent);
  --text:${ink}; --muted:color-mix(in srgb, ${ink} 62%, transparent); --sub:color-mix(in srgb, ${ink} 42%, transparent);
  --card:${surface}; --card-2:color-mix(in srgb, ${ink} 5%, ${surface});
  --line:color-mix(in srgb, ${ink} 10%, transparent); --line-md:color-mix(in srgb, ${ink} 17%, transparent); --r-scale:${rs}; --radius-sm:${12 * rs}px; --radius:${20 * rs}px; --radius-lg:${28 * rs}px;
  --card-shadow:0 1px 3px rgba(0,0,0,0.05), 0 14px 34px -16px rgba(0,0,0,0.22);
  --btn-shadow:0 1px 2px rgba(0,0,0,0.05), 0 2px 5px -2px rgba(0,0,0,0.13);
  --btn-shadow-hover:0 2px 5px -1px rgba(0,0,0,0.10), 0 10px 20px -6px rgba(0,0,0,0.22);
  --btn-shadow-key:0 2px 8px -1px color-mix(in srgb, ${accent} 42%, transparent);
  width:100%; color:var(--text); -webkit-font-smoothing:antialiased; }
.stk-live * { box-sizing:border-box; }
.stk-live .live-inner { max-width:1280px; margin:0 auto; padding:56px 24px 96px; }
.stk-live .live-hero { text-align:center; margin-bottom:44px; }
.stk-live .live-badge { display:inline-flex; align-items:center; gap:8px; padding:8px 16px 8px 12px; border:1px solid var(--key-border); border-radius:999px; background:var(--key-dim); font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; margin-bottom:24px; }
.stk-live .live-dot { width:7px; height:7px; border-radius:50%; background:var(--key); animation:stkPulse 2s ease-in-out infinite; flex-shrink:0; }
@keyframes stkPulse { 0%,100%{ box-shadow:0 0 0 0 var(--key-border); } 60%{ box-shadow:0 0 0 9px transparent; } }
.stk-live .live-title { font-size:clamp(30px,4.2vw,52px); line-height:1.12; font-weight:900; letter-spacing:-0.045em; word-break:keep-all; color:var(--text); margin:0; }
.stk-live .live-desc { max-width:720px; margin:20px auto 0; color:var(--muted); font-size:clamp(15px,1.7vw,18px); line-height:1.72; word-break:keep-all; white-space:pre-wrap; }
.stk-live .ag-wrap { margin-top:72px; padding-top:72px; border-top:1px solid var(--line); }
.stk-live .ag-head { text-align:center; margin-bottom:44px; }
.stk-live .ag-kicker { display:inline-flex; align-items:center; margin-bottom:16px; padding:8px 16px; border-radius:999px; border:1px solid var(--key-border); background:var(--key-dim); font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; }
.stk-live .ag-head h2 { font-size:clamp(28px,3.6vw,44px); line-height:1.1; font-weight:900; letter-spacing:-0.05em; color:var(--text); margin:0; }
.stk-live .ag-session { border-radius:var(--radius); background:var(--card); overflow:hidden; margin-bottom:14px; box-shadow:var(--card-shadow); transition:box-shadow .2s ease; }
.stk-live .ag-session:hover { box-shadow:0 0 0 1px var(--key-border), var(--card-shadow); }
.stk-live .ag-sess-head { display:grid; grid-template-columns:90px 1fr auto; gap:16px; align-items:start; padding:20px 24px; border-bottom:1px solid var(--line); }
.stk-live .ag-sess-num { font-size:11px; font-weight:900; letter-spacing:0.06em; text-transform:uppercase; color:var(--key); padding-top:3px; }
.stk-live .ag-sess-title { font-size:15px; font-weight:750; line-height:1.42; color:var(--text); letter-spacing:-0.03em; word-break:keep-all; margin:0; }
.stk-live .ag-sess-time { font-size:12.5px; font-weight:600; color:var(--sub); white-space:nowrap; text-align:right; padding-top:3px; }
.stk-live .ag-sess-body { display:flex; gap:20px; padding:22px 24px; align-items:center; }
.stk-live .ag-avatar { flex-shrink:0; width:56px; height:56px; border-radius:50%; overflow:hidden; background:var(--key-dim); border:1px solid var(--key-border); display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; color:var(--key); }
.stk-live .ag-avatar img { width:100%; height:100%; object-fit:cover; object-position:top center; }
.stk-live .ag-speaker-desc { font-size:14px; line-height:1.66; color:var(--muted); margin-top:6px; word-break:keep-all; }
.stk-live .ag-speaker-name { font-size:15px; font-weight:750; color:var(--text); letter-spacing:-0.02em; }
.stk-live .ag-footer { text-align:center; padding-top:32px; font-size:13px; color:var(--sub); }
@media (max-width:720px) {
  .stk-live .live-inner { padding:40px 18px 64px; }
  .stk-live .live-hero { text-align:left; }
  .stk-live .live-desc { margin-left:0; }
  .stk-live .ag-head { text-align:left; }
  .stk-live .ag-sess-head { grid-template-columns:1fr; gap:8px; padding:16px 18px; }
  .stk-live .ag-sess-time { text-align:left; }
  .stk-live .ag-sess-body { padding:16px 18px; }
}
`;
}
