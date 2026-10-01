/**
 * 스캔 한 번 → 기록 + 판정.
 *
 * 등록번호는 **이 소스의 것**이어야 한다. 다른 전시의 번호면 "다른 행사" 로만 알리고 이름은 주지 않는다
 * (링크 하나로 다른 전시 명단을 떠볼 수 없게). 형식·체크digit 이 틀리면 DB 를 보지 않는다.
 * 재스캔도 전부 기록한다(운영 결정) — 판정은 오늘 이 사람의 스캔 수로 first/repeat.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { extractRegistrationNo } from "@/lib/collect-registration-no";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { buildTicketView } from "@/lib/collect-lookup";
import { eventDateIn, judgeScan, normalizeMethod, pickCompany, type ScanResult } from "@/lib/collect-checkin";
import { hasCheckinSession, loadCheckinSource } from "@/lib/collect-checkin-server";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const source = await loadCheckinSource(token);
  if (!source) return NextResponse.json({ error: "체크인 링크가 없거나 꺼져 있어요" }, { status: 404 });
  if (!(await hasCheckinSession(token, source.checkinPinHash))) {
    return NextResponse.json({ error: "PIN을 다시 입력해 주세요" }, { status: 401 });
  }

  const limit = await rateLimitAsync(`checkin-scan:${token}:${getClientIp(request)}`, { limit: 240, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "스캔이 너무 빨라요. 잠시 후 다시 해 주세요" }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { code?: unknown; method?: unknown; staffLabel?: unknown };
  const regNo = extractRegistrationNo(body.code);
  if (!regNo) return NextResponse.json({ status: "invalid" } satisfies ScanResult);

  const record = await prisma.collectRecord.findUnique({
    where: { registrationNo: regNo },
    select: { id: true, sourceId: true, registrationNo: true, data: true },
  });
  if (!record) return NextResponse.json({ status: "not_found" } satisfies ScanResult);
  if (record.sourceId !== source.id) return NextResponse.json({ status: "other_event" } satisfies ScanResult);

  const now = new Date();
  const eventDate = eventDateIn(source.checkinTimezone, now);
  await prisma.collectCheckIn.create({
    data: {
      sourceId: source.id,
      recordId: record.id,
      eventDate,
      scannedAt: now,
      method: normalizeMethod(body.method),
      staffLabel: typeof body.staffLabel === "string" ? body.staffLabel.trim().slice(0, 40) : "",
    },
  });
  const today = await prisma.collectCheckIn.findMany({
    where: { recordId: record.id, eventDate },
    orderBy: { scannedAt: "asc" },
    select: { scannedAt: true },
  });

  const config = normalizeCollectForm(source.formConfig);
  const view = buildTicketView(config, record);
  const data = (record.data && typeof record.data === "object" ? record.data : {}) as Record<string, unknown>;
  return NextResponse.json(
    judgeScan(
      {
        registrationNo: regNo,
        name: view?.name ?? "",
        visitorType: view?.visitorType ?? "",
        company: pickCompany(config, data),
        extras: view?.extras ?? [],
      },
      today.map((t) => t.scannedAt),
      now,
    ),
  );
}
