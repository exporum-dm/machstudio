import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardBrief, publicBriefUrl, shortBase } from "@/lib/brief/server";
import { loadPickItems, sortBriefItems, toClientItem } from "@/lib/brief/queries";
import { toSlug } from "@/lib/brief/model";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardBrief(id, { write: false });
  if (!g.ok) return g.response;

  const [items, issues] = await Promise.all([
    loadPickItems(id),
    prisma.briefIssue.findMany({
      where: { briefId: id },
      orderBy: { publishedAt: "desc" },
      select: { id: true, title: true, publishedAt: true, _count: { select: { items: true } } },
      take: 50,
    }),
  ]);
  const base = shortBase(request);
  return NextResponse.json({
    canWrite: g.canWrite,
    brief: { ...g.brief, publicUrl: publicBriefUrl(request, g.brief.slug) },
    items: sortBriefItems(items).map((i) => toClientItem(i, base)),
    issues: issues.map((i) => ({ id: i.id, title: i.title, publishedAt: i.publishedAt, itemCount: i._count.items })),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardBrief(id, { write: true });
  if (!g.ok) return g.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 60);
  if (typeof body.intro === "string") data.intro = body.intro.slice(0, 200);
  if (typeof body.isPublic === "boolean") data.isPublic = body.isPublic;
  if (typeof body.appendPublicLink === "boolean") data.appendPublicLink = body.appendPublicLink;
  if (typeof body.slug === "string") {
    const slug = toSlug(body.slug);
    if (!slug) return NextResponse.json({ error: "주소는 영문·숫자·하이픈으로 적어주세요" }, { status: 400 });
    const taken = await prisma.brief.findFirst({ where: { slug, NOT: { id } }, select: { id: true } });
    if (taken) return NextResponse.json({ error: "이미 쓰는 주소예요" }, { status: 409 });
    data.slug = slug;
  }

  const brief = await prisma.brief.update({ where: { id }, data });
  return NextResponse.json({ brief: { ...brief, publicUrl: publicBriefUrl(request, brief.slug) } });
}
