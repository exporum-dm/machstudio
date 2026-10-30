import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { buildMemo, parseMemo } from "@/lib/webinar-memo";
import { logActivity } from "@/lib/activity";
import { purgeRegistrantTraces } from "@/lib/webinar-registrant-purge";

interface RegistrationPatch {
  name?: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  industry?: string | null;
  agreeMarketing?: boolean;
  agreePrivacy?: boolean;
  agreeThirdParty?: boolean;
  memo?: string | null;
}

type AuthResult =
  | { error: NextResponse; workspaceId?: undefined; userId?: undefined }
  | { error: null; workspaceId: string; userId: string };

async function authorize(webinarId: string): Promise<AuthResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };

  const webinar = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!webinar) return { error: NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 }) };

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return { error: NextResponse.json({ error: "접근 권한 없음" }, { status: 403 }) };
  // 등록자 단건 삭제·수정(동의 상태 포함) — 같은 화면의 일괄 삭제·명단 내보내기와 동일하게 관리자
  // 이상만(MEMBER 차단). 여기만 빠져 있으면 멤버가 단건 API로 그 가드를 그냥 우회할 수 있었다.
  if (membership.role === "MEMBER") {
    return { error: NextResponse.json({ error: "이 작업을 할 권한이 없어요. 관리자에게 문의하세요." }, { status: 403 }) };
  }

  return { error: null, workspaceId: webinar.workspaceId, userId: user.id };
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizePhone(value: unknown) {
  const text = String(value ?? "").replace(/[^0-9]/g, "");
  return text || null;
}

function normalizeEmail(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; registrationId: string }> }
) {
  const { id, registrationId } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const registration = await prisma.webinarRegistration.findFirst({
    where: { id: registrationId, webinarId: id },
    // memo 도 읽는다 — 아래에서 customFields(응답자가 낸 커스텀 답변)를 보존하려면 기존 값이 필요하다.
    select: { id: true, memo: true },
  });

  if (!registration) {
    return NextResponse.json({ error: "등록자를 찾지 못했어요" }, { status: 404 });
  }

  const body = await request.json() as RegistrationPatch;
  const name = String(body.name ?? "").trim();
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);

  if (!name) return NextResponse.json({ error: "이름을 입력해주세요" }, { status: 400 });
  if (!phone && !email) return NextResponse.json({ error: "연락처 또는 이메일이 필요합니다." }, { status: 400 });

  const updated = await prisma.webinarRegistration.update({
    where: { id: registration.id },
    data: {
      name,
      phone,
      email,
      company: clean(body.company),
      department: clean(body.department),
      jobTitle: clean(body.jobTitle),
      industry: clean(body.industry),
      agreeMarketing: Boolean(body.agreeMarketing),
      agreePrivacy: body.agreePrivacy !== false,
      agreeThirdParty: Boolean(body.agreeThirdParty),
      // 상세 패널의 메모 칸은 **운영자 메모(note)만** 편집한다. 등록 폼 커스텀 문항 답변은
      // 같은 컬럼의 customFields 에 들어 있으므로, 기존 값에서 그것만 살려 다시 조립한다.
      // (예전에는 textarea 내용이 컬럼을 통째로 덮어써 커스텀 답변이 사라졌다)
      memo: buildMemo(String(body.memo ?? ""), parseMemo(registration.memo).customFields),
    },
  });

  return NextResponse.json({ registration: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; registrationId: string }> }
) {
  const { id, registrationId } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const registration = await prisma.webinarRegistration.findFirst({
    where: { id: registrationId, webinarId: id },
    select: { id: true },
  });

  if (!registration) {
    return NextResponse.json({ error: "등록자를 찾지 못했어요" }, { status: 404 });
  }

  // 등록 행만 지우면 리마인더·Q&A·채팅에 개인정보가 남는다(purge 헬퍼 주석 참고).
  // 같은 트랜잭션에서 정리한다 — 중간에 실패해 리마인더만 남으면 다시 발송 대상이 된다.
  const purged = await prisma.$transaction(async (tx) => {
    const summary = await purgeRegistrantTraces(tx, id, [registration.id]);
    await tx.webinarRegistration.delete({ where: { id: registration.id } });
    return summary;
  });

  await logActivity({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "webinar.registration_deleted",
    meta: { webinarId: id, registrationId, purged },
  });

  return NextResponse.json({ ok: true });
}
