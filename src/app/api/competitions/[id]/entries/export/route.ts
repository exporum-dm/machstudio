/**
 * 대회 참가작 내보내기 — `?format=xlsx`(기본) | `csv`.
 *
 * 운영자 전용(로그인 + 워크스페이스 멤버). 연락처·팀원 명단이 들어가는 파일이라 누가 언제
 * 받았는지 활동 기록에 남긴다(사전등록 CSV 와 같은 기준).
 */
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { normalizeCompetitionConfig } from "@/lib/competition-config";
import { buildEntryExportTable } from "@/lib/competition-entry-export";
import { kstDateString } from "@/lib/datetime";
import { serializeCsv } from "@/lib/webinar-registrant-csv";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const competition = await prisma.competition.findUnique({ where: { id } });
  if (!competition) return NextResponse.json({ error: "대회 없음" }, { status: 404 });
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: competition.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const [entries, rounds, voteGroups] = await Promise.all([
    prisma.competitionEntry.findMany({ where: { competitionId: id } }),
    prisma.competitionRound.findMany({ where: { competitionId: id }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.competitionVote.groupBy({ by: ["roundId", "entryId"], where: { round: { competitionId: id } }, _count: { _all: true } }),
  ]);
  const votes = new Map(voteGroups.map((g) => [`${g.roundId}:${g.entryId}`, g._count._all]));

  // 꺼 둔 항목도 예전 참가작에는 값이 남아 있을 수 있지만, 상세 화면과 같은 기준(켜 둔 항목)으로 맞춘다.
  const config = normalizeCompetitionConfig(competition.config, { includeDisabled: true });
  const table = buildEntryExportTable({ fields: config.form.fields, entries, rounds, votes });

  const safeName = (competition.name || "competition").replace(/[^a-zA-Z0-9가-힣_-]+/g, "_");
  const filename = `${safeName}_참가작_${kstDateString()}.${format}`;

  await logActivity({
    workspaceId: competition.workspaceId,
    userId: user.id,
    action: "competition.entries_exported",
    meta: { competitionId: id, format, entryCount: entries.length },
  });

  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  if (format === "csv") {
    // UTF-8 BOM — 엑셀에서 열 때 한글이 깨지지 않게. 셀은 수식 인젝션 방어(csvCell)를 거친다.
    return new NextResponse("\uFEFF" + serializeCsv(table), {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": disposition, "Cache-Control": "no-store" },
    });
  }

  const sheet = XLSX.utils.aoa_to_sheet(table);
  // 열 너비 — 내용 길이를 대충 따라가되(한 줄 기준) 너무 넓어지지 않게 자른다.
  sheet["!cols"] = table[0].map((_, col) => {
    const longest = Math.max(...table.map((row) => Math.max(...String(row[col] ?? "").split("\n").map((line) => line.length))));
    return { wch: Math.min(Math.max(longest + 2, 8), 48) };
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "참가작");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}
