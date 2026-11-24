import { isPublicationKind } from "@/lib/creator/publication-server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !isPublicationKind(kind)) return new Response(null, { status: 404 });
  const response = `
(() => {
  const script = document.currentScript;
  if (!script) return;
  const url = new URL(${JSON.stringify("/creator-show/" + id + "/" + kind)}, script.src);
  const frame = document.createElement("iframe");
  frame.src = url.href;
  frame.title = ${JSON.stringify(kind === "roster" ? "선발 크리에이터 소개" : "우수 크리에이터 발표")};
  frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "display:block;width:100%;height:0;border:0";
  const resize = (event) => {
    if (event.source !== frame.contentWindow || event.origin !== url.origin) return;
    const data = event.data;
    if (data?.type !== "mach-creator-height" || !Number.isFinite(data.height) || data.height < 0) return;
    frame.style.height = Math.min(data.height, 150000) + "px";
    frame.hidden = data.height === 0;
  };
  window.addEventListener("message", resize);
  if (document.head.contains(script)) {
    const mount = () => document.body.append(frame);
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    script.after(frame);
  }
})();`;
  return new Response(response, { headers: { "Content-Type": "application/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300" } });
}
