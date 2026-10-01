/**
 * 현장 체크인 설정·현황 — 사전등록(빌더형) 소스 상세의 "현장 체크인" 탭.
 *
 *  GET   설정(켜짐·링크·PIN 설정 여부·시간대) + 일자별 입장 집계 + 최근 스캔
 *  PATCH 켜고 끄기 · 시간대 · PIN 바꾸기 · 링크 새로 만들기 (ADMIN 이상)
 *
 * 링크를 새로 만들면 예전 링크는 바로 404, PIN 을 바꾸면 운영요원 세션이 전부 끊긴다 —
 * 휴대폰 분실·링크 유출 때 쓰는 손잡이다.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { getPublicAppOrigin } from "@/lib/app-url";
import { hashSharePassword } from "@/lib/share-password";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { buildTicketView } from "@/lib/collect-lookup";
import { eventDateIn, isCheckinTimezone, isValidPin, normalizePin } from "@/lib/collect-checkin";

async function authorize(id: string, requireAdmin: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };
  const source = await prisma.collectSource.findUnique({ where: { id } });
  if (!source || source.deletedAt) return { error: NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 }) };
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: source.workspaceId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "접근 권한 없음" }, { status: 403 }) };
  if (requireAdmin && membership.role === "MEMBER") {
    return { error: NextResponse.json({ error: "권한 없음 (ADMIN 이상)" }, { status: 403 }) };
  }
  return { source, userId: user.id };
}

/** 운영요원에게 보내는 주소 — 정식 공개 주소로(AGENTS.md ①). 로컬 개발에서만 요청 주소로 대신한다. */
function checkinUrl(request: Request, token: string | null): string {
  if (!token) return "";
  const origin = getPublicAppOrigin() || (process.env.NODE_ENV !== "production" ? new URL(request.url).origin : "");
  return origin ? `${origin}/checkin/${token}` : "";
}

const newToken = () => randomBytes(18).toString("base64url");

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id, false);
  if ("error" in auth) return auth.error;
  const { source } = auth;

  const [byDay, recent] = await Promise.all([
    prisma.$queryRaw<{ eventDate: string; scans: number; unique: number }[]>`
      SELECT "eventDate", COUNT(*)::int AS scans, COUNT(DISTINCT "recordId")::int AS unique
        FROM "CollectCheckIn" WHERE "sourceId" = ${id}
       GROUP BY "eventDate" ORDER BY "eventDate" DESC LIMIT 14`,
    prisma.collectCheckIn.findMany({
      where: { sourceId: id },
      orderBy: { scannedAt: "desc" },
      take: 30,
      select: { id: true, scannedAt: true, method: true, staffLabel: true, record: { select: { registrationNo: true, data: true } } },
    }),
  ]);

  const config = normalizeCollectForm(source.formConfig);
  return NextResponse.json({
    builder: source.mode === "builder",
    enabled: source.checkinEnabled,
    timezone: source.checkinTimezone,
    pinSet: Boolean(source.checkinPinHash),
    url: checkinUrl(request, source.checkinToken),
    today: eventDateIn(source.checkinTimezone),
    eventDates: config.eventInfo.eventDates,
    byDay,
    recent: recent.map((r) => {
      const view = buildTicketView(config, r.record);
      return {
        id: r.id,
        scannedAt: r.scannedAt,
        method: r.method,
        staffLabel: r.staffLabel,
        registrationNo: r.record.registrationNo,
        name: view?.name ?? "",
        visitorType: view?.visitorType ?? "",
      };
    }),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id, true);
  if ("error" in auth) return auth.error;
  const { source, userId } = auth;
  if (source.mode !== "builder") {
    return NextResponse.json({ error: "현장 체크인은 등록번호·QR 이 있는 빌더형 사전등록에서만 쓸 수 있어요" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const changed: string[] = [];

  if (typeof body.enabled === "boolean") {
    data.checkinEnabled = body.enabled;
    // 처음 켤 때 링크를 만든다 — 꺼 두는 동안엔 링크가 없어도 된다.
    if (body.enabled && !source.checkinToken) data.checkinToken = newToken();
    changed.push(body.enabled ? "켬" : "끔");
  }
  if (body.timezone !== undefined) {
    if (!isCheckinTimezone(body.timezone)) return NextResponse.json({ error: "지원하지 않는 시간대예요" }, { status: 400 });
    data.checkinTimezone = body.timezone;
    changed.push(`시간대 ${body.timezone}`);
  }
  if (body.pin !== undefined) {
    const pin = normalizePin(body.pin);
    if (!isValidPin(pin)) return NextResponse.json({ error: "PIN은 숫자 4자리예요" }, { status: 400 });
    data.checkinPinHash = hashSharePassword(pin);
    changed.push("PIN 변경");
  }
  if (body.regenerateToken === true) {
    data.checkinToken = newToken();
    changed.push("링크 새로 만듦");
  }
  if (changed.length === 0) return NextResponse.json({ error: "바꿀 내용이 없어요" }, { status: 400 });

  const updated = await prisma.collectSource.update({ where: { id }, data });
  await logActivity({ workspaceId: source.workspaceId, sourceId: id, userId, action: "collect.checkin_updated", meta: { changed } }).catch(() => null);

  return NextResponse.json({
    enabled: updated.checkinEnabled,
    timezone: updated.checkinTimezone,
    pinSet: Boolean(updated.checkinPinHash),
    url: checkinUrl(request, updated.checkinToken),
  });
}
