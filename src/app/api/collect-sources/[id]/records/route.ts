import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { logActivity } from "@/lib/activity";

async function authorize(id: string, requireAdmin = false) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };

  const source = await prisma.collectSource.findUnique({ where: { id } });
  if (!source) return { error: NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 }) };

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "접근 권한 없음" }, { status: 403 }) };
  if (requireAdmin && membership.role === "MEMBER") {
    return { error: NextResponse.json({ error: "권한 없음 (ADMIN 이상)" }, { status: 403 }) };
  }

  return { source, userId: user.id };
}

// 정렬 ORDER BY 절을 안전하게 구성. 컬럼명은 화이트리스트, JSONB 필드 키는 파라미터 바인딩.
// kind: "createdAt" | "utmSource" | "utmMedium" | "field"(fieldKey 필요)
function buildOrderBy(sort: string | null, dir: string | null, fieldKey: string | null): Prisma.Sql {
  const direction = dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  // 동률 시 안정 정렬을 위해 createdAt DESC 를 보조 키로
  const tiebreak = Prisma.sql`, "createdAt" DESC`;
  switch (sort) {
    case "utmSource":
      return Prisma.sql`ORDER BY COALESCE("utmSource",'') ${direction}${tiebreak}`;
    case "utmMedium":
      return Prisma.sql`ORDER BY COALESCE("utmMedium",'') ${direction}${tiebreak}`;
    case "field":
      if (fieldKey) {
        // ->> 의 우항(키)은 파라미터 바인딩되어 SQL 인젝션 안전. 빈 값은 NULL 처리.
        return Prisma.sql`ORDER BY NULLIF("data"->>${fieldKey}, '') ${direction} NULLS LAST${tiebreak}`;
      }
      return Prisma.sql`ORDER BY "createdAt" ${direction}`;
    case "createdAt":
    default:
      return Prisma.sql`ORDER BY "createdAt" ${direction}`;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1");
  const rawLimit = parseInt(searchParams.get("limit") ?? "100");
  const limit = Math.min(Math.max(rawLimit || 100, 1), 500);
  const skip = (page - 1) * limit;
  const q = searchParams.get("q")?.trim();
  const utmSource = searchParams.get("utmSource");
  const utmMedium = searchParams.get("utmMedium");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sort = searchParams.get("sort");
  const dir = searchParams.get("dir");
  const sortField = searchParams.get("sortField");

  const orderBy = buildOrderBy(sort, dir, sortField);

  // 필터 조건을 raw SQL 조각으로 구성 (검색 유무와 무관하게 동일 적용)
  const conditions: Prisma.Sql[] = [Prisma.sql`"sourceId" = ${id}`];
  if (utmSource) conditions.push(Prisma.sql`"utmSource" = ${utmSource}`);
  if (utmMedium) conditions.push(Prisma.sql`"utmMedium" = ${utmMedium}`);
  if (from) conditions.push(Prisma.sql`"createdAt" >= ${new Date(from)}`);
  if (to) conditions.push(Prisma.sql`"createdAt" <= ${new Date(to)}`);
  if (q) {
    // Postgres JSONB ::text 캐스팅으로 모든 필드값에서 ILIKE 검색
    const escaped = q.replace(/[%_\\]/g, (m) => "\\" + m);
    const pattern = `%${escaped}%`;
    conditions.push(Prisma.sql`(
      "data"::text ILIKE ${pattern}
      OR COALESCE("utmSource",'') ILIKE ${pattern}
      OR COALESCE("utmMedium",'') ILIKE ${pattern}
      OR COALESCE("utmCampaign",'') ILIKE ${pattern}
      OR COALESCE("referrer",'') ILIKE ${pattern}
      OR COALESCE("registrationNo",'') ILIKE ${pattern}
    )`);
  }
  const whereClause = Prisma.join(conditions, " AND ");

  // 1) 정렬·페이지네이션된 ID 목록을 raw SQL 로 조회 (JSONB 필드 정렬 지원)
  const idRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "CollectRecord"
    WHERE ${whereClause}
    ${orderBy}
    LIMIT ${limit} OFFSET ${skip}
  `);
  const ids = idRows.map((r) => r.id);

  // 2) 전체 카운트
  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "CollectRecord"
    WHERE ${whereClause}
  `);
  const total = Number(countRows[0]?.count ?? 0);

  // 3) 레코드 본문 조회 후 raw SQL 정렬 순서대로 재정렬 (findMany 는 순서 보장 안 함)
  let records: Array<Awaited<ReturnType<typeof prisma.collectRecord.findMany>>[number] & { checkIn?: { firstAt: Date; lastAt: Date; count: number } }> = [];
  if (ids.length > 0) {
    const [fetched, checkIns] = await Promise.all([
      prisma.collectRecord.findMany({ where: { id: { in: ids } } }),
      // 현장 체크인 요약 — 이 페이지의 레코드만. 체크인을 안 쓰는 소스는 0건이라 비용이 거의 없다.
      prisma.collectCheckIn.groupBy({
        by: ["recordId"],
        where: { recordId: { in: ids } },
        _min: { scannedAt: true },
        _max: { scannedAt: true },
        _count: { _all: true },
      }),
    ]);
    const ciById = new Map(checkIns.map((c) => [c.recordId, { firstAt: c._min.scannedAt!, lastAt: c._max.scannedAt!, count: c._count._all }]));
    const byId = new Map(fetched.map((r) => [r.id, r]));
    records = ids.map((rid) => byId.get(rid)!).filter(Boolean).map((r) => (ciById.has(r.id) ? { ...r, checkIn: ciById.get(r.id) } : r));
  }

  return NextResponse.json({ records, total, page, limit, q });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id, true);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const ids: unknown = body?.ids;

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string")) {
    return NextResponse.json({ error: "삭제할 레코드 ID 배열이 필요해요" }, { status: 400 });
  }

  const result = await prisma.collectRecord.deleteMany({
    where: { sourceId: id, id: { in: ids as string[] } },
  });

  await logActivity({
    workspaceId: auth.source.workspaceId,
    sourceId: id,
    userId: auth.userId,
    action: "records.bulk_deleted",
    meta: { count: result.count },
  });

  return NextResponse.json({ deleted: result.count });
}
