import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { isBuilderSource } from "@/lib/collect-columns";
import { normalizeEmail, primaryFieldKey } from "@/lib/collect-submit";
import { toE164 } from "@/lib/collect-phone";

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  const record = await prisma.collectRecord.findFirst({
    where: { id: recordId, sourceId: id },
  });
  if (!record) return NextResponse.json({ error: "레코드를 찾을 수 없어요" }, { status: 404 });

  // 현장 체크인 기록 — 상세에서는 스캔 시각을 전부 보여 준다(최근 순, 최대 50).
  const [checkIns, src] = await Promise.all([
    prisma.collectCheckIn.findMany({
      where: { recordId },
      orderBy: { scannedAt: "desc" },
      take: 50,
      select: { scannedAt: true, method: true, staffLabel: true },
    }),
    prisma.collectSource.findUnique({ where: { id }, select: { checkinTimezone: true } }),
  ]);

  return NextResponse.json({ record: { ...record, checkIns, checkinTimezone: src?.checkinTimezone ?? "Asia/Seoul" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params;
  const auth = await authorize(id);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { data, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, referrer } = body as {
    data?: Record<string, string>;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmTerm?: string | null;
    utmContent?: string | null;
    referrer?: string | null;
  };

  const updateData: Record<string, unknown> = {};
  if (data !== undefined && typeof data === "object" && data !== null) {
    updateData.data = data;
    /**
     * **정규화 키를 같이 다시 계산한다.**
     *
     * emailNormalized·phoneE164 는 data 에서 파생된 값이고, 중복 차단(§6.2)과 등록
     * 확인 조회(§10.1)가 그 둘만 본다. data 만 고치면 두 값이 옛 주소를 계속 가리켜서
     * ① 같은 사람이 고친 주소로 다시 등록해도 중복에 안 걸리고
     * ② 아무도 쓰지 않는 옛 주소가 그 전시에서 영구 차단되고
     * ③ 등록자는 고친 주소로 자기 QR 을 못 찾는다.
     * 셋 다 조용히 어긋나는 종류라, 오타 하나 고쳐 준 것이 원인이라고는 아무도 못 찾는다.
     *
     * 빌더형만 해당한다 — 연동형은 이 컬럼들을 쓰지 않고(항상 null), 그쪽 화면은
     * 레코드 52,000건이 그대로 돌아가야 한다.
     */
    if (isBuilderSource(auth.source)) {
      const config = normalizeCollectForm(auth.source.formConfig);
      const emailKey = primaryFieldKey(config, data, "email");
      const phoneKey = primaryFieldKey(config, data, "tel");
      const phoneRaw = phoneKey ? String(data[phoneKey] ?? "").trim() : "";
      updateData.emailNormalized = emailKey ? normalizeEmail(data[emailKey]) : null;
      updateData.phoneE164 = phoneRaw ? toE164(phoneRaw, config.validation.defaultCountry) : null;
    }
  }
  if (utmSource !== undefined) updateData.utmSource = utmSource || null;
  if (utmMedium !== undefined) updateData.utmMedium = utmMedium || null;
  if (utmCampaign !== undefined) updateData.utmCampaign = utmCampaign || null;
  if (utmTerm !== undefined) updateData.utmTerm = utmTerm || null;
  if (utmContent !== undefined) updateData.utmContent = utmContent || null;
  if (referrer !== undefined) updateData.referrer = referrer || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "수정할 항목이 없어요" }, { status: 400 });
  }

  // sourceId 로 반드시 함께 스코프한다. authorize(id) 는 "이 소스의 워크스페이스 멤버인가"만 보므로,
  // recordId 만으로 update 하면 자기 소스 id + 남의 레코드 id 조합으로 다른 워크스페이스의
  // 레코드를 수정할 수 있다(활동 로그는 공격자 워크스페이스에 남아 피해자는 알지도 못한다).
  // GET 은 이미 findFirst({ id, sourceId }) 로 걸러 왔는데 PATCH/DELETE 만 빠져 있었다.
  const target = await prisma.collectRecord.findFirst({
    where: { id: recordId, sourceId: id },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "레코드를 찾을 수 없어요" }, { status: 404 });

  /**
   * 이메일을 **이미 등록된 주소로** 고치면 부분 유니크 인덱스에 부딪힌다(§6.2).
   * 잡지 않으면 500 이 나가고 운영자는 "저장이 안 된다" 만 본다 — 무엇이 문제인지,
   * 어느 레코드와 겹치는지 알 수 없다.
   */
  let record;
  try {
    record = await prisma.collectRecord.update({
      where: { id: target.id },
      data: updateData,
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002") {
      return NextResponse.json(
        { error: "그 이메일로 등록된 사람이 이미 있어요. 중복이면 한쪽을 지우고 고쳐 주세요." },
        { status: 409 },
      );
    }
    throw e;
  }

  await logActivity({
    workspaceId: auth.source.workspaceId,
    sourceId: id,
    userId: auth.userId,
    action: "record.updated",
    meta: { recordId, fields: Object.keys(updateData) },
  });

  return NextResponse.json({ record });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params;
  const auth = await authorize(id, true);
  if ("error" in auth) return auth.error;

  // PATCH 와 같은 이유로 sourceId 를 함께 걸어 확인한다 — 스코프 없이 지우면 남의 워크스페이스
  // 레코드를 삭제할 수 있고, 삭제는 되돌릴 수 없다.
  const target = await prisma.collectRecord.findFirst({
    where: { id: recordId, sourceId: id },
    select: { id: true },
  });
  if (!target) return NextResponse.json({ error: "레코드를 찾을 수 없어요" }, { status: 404 });

  await prisma.collectRecord.delete({ where: { id: target.id } });

  await logActivity({
    workspaceId: auth.source.workspaceId,
    sourceId: id,
    userId: auth.userId,
    action: "record.deleted",
    meta: { recordId },
  });

  return NextResponse.json({ ok: true });
}
