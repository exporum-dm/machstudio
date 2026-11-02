import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { rateLimitAsync } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";
import { getPublicAppOrigin } from "@/lib/app-url";

const makeCode = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 7);

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function shortBaseUrl() {
  const configured = process.env.SHORT_URL_BASE || process.env.NEXT_PUBLIC_SHORT_URL_BASE;
  const base = configured || getPublicAppOrigin();
  return base.replace(/\/+$/, "");
}

async function createUniqueShortLink(input: {
  longUrl: string;
  workspaceId: string;
  createdById: string;
}) {
  for (let i = 0; i < 8; i += 1) {
    const code = makeCode();
    try {
      return await prisma.shortLink.create({ data: { ...input, code } });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("SHORT_CODE_COLLISION");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const limit = await rateLimitAsync(`shorten-url:${user.id}`, { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "잠시 후 다시 시도해주세요" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const longUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!longUrl || !isHttpUrl(longUrl)) {
    return NextResponse.json({ error: "올바른 URL이 필요해요" }, { status: 400 });
  }
  const publicBase = shortBaseUrl();
  if (!publicBase) return NextResponse.json({ error: "공개 주소 설정을 확인해 주세요" }, { status: 503 });

  try {
    let membership = await prisma.workspaceMember.findFirst({ where: { userId: user.id } });
    if (membership?.role === "MEMBER") {
      return NextResponse.json({ error: "뷰어는 단축 URL을 생성할 수 없어요." }, { status: 403 });
    }

    if (!membership) {
      const dbUser = await prisma.user.upsert({
        where: { id: user.id },
        update: {},
        create: { id: user.id, email: user.email!, name: user.user_metadata?.name ?? user.email },
      });
      const workspace = await prisma.workspace.create({
        data: { name: "내 워크스페이스", slug: `ws-${user.id.slice(0, 8)}` },
      });
      membership = await prisma.workspaceMember.create({
        data: { userId: dbUser.id, workspaceId: workspace.id, role: "OWNER" },
      });
    }

    const shortLink = await createUniqueShortLink({
      longUrl,
      workspaceId: membership.workspaceId,
      createdById: user.id,
    });
    const shortUrl = `${publicBase}/r/${shortLink.code}`;

    await logActivity({
      workspaceId: membership.workspaceId,
      userId: user.id,
      action: "shortLink.created",
      meta: { shortLinkId: shortLink.id, code: shortLink.code, longUrl },
    });

    return NextResponse.json({ shortUrl });
  } catch (error) {
    console.error("Failed to create short link", error);
    return NextResponse.json({ error: "URL을 단축하지 못했어요" }, { status: 502 });
  }
}
