import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { collectColumnsFor, isBuilderSource } from "@/lib/collect-columns";
import { formatKstDateTime, kstDateString } from "@/lib/datetime";
import { logActivity } from "@/lib/activity";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const source = await prisma.collectSource.findUnique({
    where: { id },
    include: { fieldMappings: { orderBy: { sortOrder: "asc" } } },
  });
  if (!source) return NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const records = await prisma.collectRecord.findMany({
    where: { sourceId: id },
    orderBy: { createdAt: "desc" },
  });

  // 빌더형은 열을 formConfig 에서 파생한다 — 표와 **같은 함수**를 써야 화면과 CSV 가 갈리지 않는다.
  const columns = collectColumnsFor(source);

  /**
   * 등록번호는 **빌더형에만** 있고, 있으면 맨 앞이어야 한다 — 현장에서 스캔한 번호로
   * 명단을 대조하는 것이 이 CSV 의 주 용도가 된다(§12 현장 운영). 연동형 CSV 는 열이
   * 하나도 바뀌지 않는다.
   */
  const builder = isBuilderSource(source);

  // 현장 체크인 — 빌더형에만. 최초 입장(행사 시간대 기준 표기는 화면 몫, CSV 는 KST 로 통일)·스캔 횟수.
  const checkIns = builder
    ? await prisma.collectCheckIn.groupBy({ by: ["recordId"], where: { sourceId: id }, _min: { scannedAt: true }, _count: { _all: true } })
    : [];
  const ciById = new Map(checkIns.map((c) => [c.recordId, { firstAt: c._min.scannedAt, count: c._count._all }]));

  const headers = [
    "시간 (KST)",
    ...(builder ? ["등록번호", "최초 입장 (KST)", "입장 스캔 횟수"] : []),
    ...columns.map((f) => f.label || f.key),
    "UTM 소스 (last)", "UTM 매체 (last)", "UTM 캠페인 (last)", "UTM 키워드 (last)", "UTM 콘텐츠 (last)",
    "First UTM 소스", "First UTM 매체", "First UTM 캠페인", "First UTM 키워드", "First UTM 콘텐츠",
    "First Referrer", "First Seen (KST)",
    "Referrer",
  ];

  const rows = records.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    return [
      formatKstDateTime(r.createdAt),
      ...(builder
        ? [
            r.registrationNo ?? "",
            ciById.get(r.id)?.firstAt ? formatKstDateTime(ciById.get(r.id)!.firstAt!) : "",
            ciById.get(r.id)?.count ?? "",
          ]
        : []),
      ...columns.map((f) => data[f.key] ?? ""),
      r.utmSource ?? "",
      r.utmMedium ?? "",
      r.utmCampaign ?? "",
      r.utmTerm ?? "",
      r.utmContent ?? "",
      r.firstUtmSource   ?? "",
      r.firstUtmMedium   ?? "",
      r.firstUtmCampaign ?? "",
      r.firstUtmTerm     ?? "",
      r.firstUtmContent  ?? "",
      r.firstReferrer    ?? "",
      r.firstSeenAt ? formatKstDateTime(r.firstSeenAt) : "",
      r.referrer ?? "",
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  // UTF-8 BOM 추가 (엑셀 한글 깨짐 방지)
  const body = "﻿" + csv;

  const safeName = (source.name || "collect").replace(/[^a-zA-Z0-9가-힣_-]+/g, "_");
  const filename = `${safeName}_${kstDateString()}.csv`;

  await logActivity({
    workspaceId: source.workspaceId,
    sourceId: source.id,
    userId: user.id,
    action: "collect.records.exported",
    meta: { sourceId: source.id, format: "csv", recordCount: records.length },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
