import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creatorUtm, creatorUtmDestination, trackingUrl, webUrl } from "@/lib/creator/model";
import { getPublicAppOrigin } from "@/lib/app-url";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { isBotUserAgent } from "@/lib/brief/click";
import { isPreviewUrl } from "@/lib/creator/server";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^cr_[A-Za-z0-9_-]{32}$/.test(code)) return new Response(null, { status: 404 });
  const link = await prisma.creatorLink.findUnique({
    where: { code },
    select: { platform: true, participant: { select: {
      name: true, channels: true, withdrawnAt: true, program: { select: {
        name: true, utm: true, deletedAt: true, project: { select: { deletedAt: true, workspace: { select: { deletedAt: true } } } },
        registrationSource: { select: { id: true, isActive: true, deletedAt: true, mode: true, siteUrl: true } },
      } },
    } } },
  });
  const person = link?.participant;
  const program = person?.program;
  const form = program?.registrationSource;
  const handle = link && person && (person.channels as Record<string, string>)[link.platform];
  if (!link || !person || person.withdrawnAt || !program || program.deletedAt || program.project.deletedAt || program.project.workspace.deletedAt || !handle) return new Response(null, { status: 404 });
  const origin = getPublicAppOrigin() || (process.env.NODE_ENV === "development" ? new URL(request.url).origin : "");
  const site = webUrl.safeParse(form?.siteUrl);
  const fallback = form?.isActive && !form.deletedAt
    ? site.success ? site.data : form.mode === "builder" && origin ? origin + "/register/" + form.id : ""
    : "";
  const destination = creatorUtmDestination(program.utm) || fallback;
  if (!destination) return new Response(null, { status: 404 });
  const url = trackingUrl(destination, creatorUtm(program.utm), { code, platform: link.platform, creator: person.name, program: program.name, handle });
  const preview = isPreviewUrl(new URL(request.url));
  if (preview) {
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
  } else {
    const prefetch = /prefetch|preview/i.test(request.headers.get("sec-purpose") || request.headers.get("purpose") || "");
    if (!prefetch && !isBotUserAgent(request.headers.get("user-agent") ?? "")) {
      const ip = getClientIp(request);
      after(async () => {
        try {
          const limit = await rateLimitAsync("creator-click:" + code + ":" + ip, { limit: 120, windowMs: 60000 });
          if (limit.allowed) await prisma.creatorLink.updateMany({ where: { code, participant: { withdrawnAt: null } }, data: { clicks: { increment: 1 } } });
        } catch {
          console.warn("[creator] click count could not be updated");
        }
      });
    }
  }
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
