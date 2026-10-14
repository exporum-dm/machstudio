/**
 * 등록자 DB 열 필터의 "값 고르기" 목록 — 그 열에 실제 들어 있는 값과 건수(많은 순 200개).
 * `?c=field:<항목 키>` | `utmSource` | `utmMedium` | `registrationNo`
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { distinctValuesSql, parseColumnFilters } from "@/lib/collect-record-filters";

const LIMIT = 200;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const source = await prisma.collectSource.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
  if (!source) return NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 });
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  // 열 이름 검증은 필터와 같은 규칙으로 — 화이트리스트 밖이면 빈 목록.
  const column = new URL(request.url).searchParams.get("c");
  const [filter] = parseColumnFilters(JSON.stringify([{ c: column, empty: "empty" }]));
  if (!filter || filter.c === "checkin") return NextResponse.json({ values: [], truncated: false });

  const rows = await prisma.$queryRaw<Array<{ v: string | null; n: number }>>(distinctValuesSql(source.id, filter.c, LIMIT + 1));
  return NextResponse.json({
    values: rows.slice(0, LIMIT).map((r) => ({ value: r.v ?? "", count: r.n })),
    truncated: rows.length > LIMIT,
  });
}
