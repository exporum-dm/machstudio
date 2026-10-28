/**
 * 오프라인 스캐너 파일 가져오기 — "현장 체크인" 탭의 파일 올리기.
 *
 *  POST { lines: string[] }  (화면이 xlsx·csv·txt 를 줄로 풀어 2,000줄씩 보낸다)
 *
 * 등록 레코드는 건드리지 않고 CollectCheckIn 만 **추가**한다. 같은 사람·같은 시각은 이미 있으면
 * 건너뛰어서, 같은 파일을 두 번 올려도 숫자가 불지 않는다. 시각은 소스의 체크인 시간대 기준 현지 시각.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { parseScannerLine, zonedLocalToUtc } from "@/lib/collect-scanner-import";

const MAX_LINES = 5000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const source = await prisma.collectSource.findUnique({ where: { id } });
  if (!source || source.deletedAt) return NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 });
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });
  if (membership.role === "MEMBER") return NextResponse.json({ error: "권한 없음 (ADMIN 이상)" }, { status: 403 });
  if (source.mode !== "builder") return NextResponse.json({ error: "등록번호를 발급하는 빌더형 사전등록에서만 쓸 수 있어요" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { lines?: unknown };
  const lines = Array.isArray(body.lines) ? body.lines.filter((l): l is string => typeof l === "string") : [];
  if (lines.length === 0) return NextResponse.json({ error: "읽을 줄이 없어요" }, { status: 400 });
  if (lines.length > MAX_LINES) return NextResponse.json({ error: `한 번에 ${MAX_LINES}줄까지 보낼 수 있어요` }, { status: 400 });

  const parsed = lines.map(parseScannerLine);
  const skipped = parsed.filter((p) => !p).length;
  const scans = parsed.filter((p): p is NonNullable<typeof p> => Boolean(p));
  const regNos = Array.from(new Set(scans.map((s) => s.registrationNo).filter((n): n is string => Boolean(n))));
  const records = regNos.length
    ? await prisma.collectRecord.findMany({ where: { registrationNo: { in: regNos } }, select: { id: true, sourceId: true, registrationNo: true } })
    : [];
  const mine = new Map(records.filter((r) => r.sourceId === id).map((r) => [r.registrationNo!, r.id]));
  const otherEvent = new Set(records.filter((r) => r.sourceId !== id).map((r) => r.registrationNo!));

  const unmatched: string[] = [];
  let otherEventScans = 0;
  const candidates: { recordId: string; scannedAt: Date; eventDate: string; staffLabel: string }[] = [];
  for (const s of scans) {
    const recordId = s.registrationNo ? mine.get(s.registrationNo) : undefined;
    if (!recordId) {
      if (s.registrationNo && otherEvent.has(s.registrationNo)) otherEventScans++;
      else unmatched.push(s.raw);
      continue;
    }
    const scannedAt = zonedLocalToUtc(s.local, source.checkinTimezone);
    if (Number.isNaN(scannedAt.getTime())) { unmatched.push(s.raw); continue; }
    candidates.push({ recordId, scannedAt, eventDate: s.eventDate, staffLabel: s.device.slice(0, 40) });
  }

  // 이미 들어간 스캔(같은 사람·같은 시각)은 건너뛴다 — 다시 올려도 안전하게.
  const recordIds = Array.from(new Set(candidates.map((c) => c.recordId)));
  const existing = recordIds.length
    ? await prisma.collectCheckIn.findMany({ where: { sourceId: id, recordId: { in: recordIds } }, select: { recordId: true, scannedAt: true } })
    : [];
  const seen = new Set(existing.map((e) => `${e.recordId}|${e.scannedAt.getTime()}`));
  const fresh = candidates.filter((c) => {
    const key = `${c.recordId}|${c.scannedAt.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (fresh.length) {
    await prisma.collectCheckIn.createMany({
      data: fresh.map((c) => ({ sourceId: id, recordId: c.recordId, eventDate: c.eventDate, scannedAt: c.scannedAt, method: "scanner", staffLabel: c.staffLabel })),
    });
  }

  await logActivity({
    workspaceId: source.workspaceId,
    sourceId: id,
    userId: user.id,
    action: "collect.checkin_imported",
    meta: { lines: lines.length, inserted: fresh.length, duplicate: candidates.length - fresh.length, unmatched: unmatched.length, otherEvent: otherEventScans },
  }).catch(() => null);

  return NextResponse.json({
    inserted: fresh.length,
    duplicate: candidates.length - fresh.length,
    otherEvent: otherEventScans,
    skipped,
    unmatched: unmatched.slice(0, 50),
    unmatchedCount: unmatched.length,
  });
}
