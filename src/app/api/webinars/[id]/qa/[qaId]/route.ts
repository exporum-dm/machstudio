import { NextResponse } from "next/server";
import { withLiveSignal } from "@/lib/webinar-live-signal";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; qaId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, qaId } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { id } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const body = await request.json();

  const question = await prisma.webinarQA.findFirst({
    where: { id: qaId, webinarId: id },
    select: { id: true },
  });
  if (!question) return NextResponse.json({ error: "질문을 찾지 못했어요" }, { status: 404 });

  // 상태 변경(pending/answered/dismissed). 답변완료·미채택이면 시청 화면 송출도 함께 종료.
  if (body.status !== undefined) {
    if (!["pending", "answered", "dismissed"].includes(String(body.status))) {
      return NextResponse.json({ error: "상태 값을 확인해주세요" }, { status: 400 });
    }
    await prisma.webinarQA.update({
      where: { id: question.id },
      data: { status: body.status, ...(body.status !== "pending" ? { onScreen: false } : {}) },
    });
  }

  // 화면에 띄우기(송출) — 웨비나당 1개만. 켜는 순간 다른 질문을 전부 끈다(팝업·투표 규칙 계승).
  if (body.onScreen === true) {
    try {
      await prisma.$transaction([
        prisma.webinarQA.updateMany({ where: { webinarId: id, onScreen: true }, data: { onScreen: false } }),
        prisma.webinarQA.update({ where: { id: question.id }, data: { onScreen: true } }),
      ]);
    } catch (e) {
      // 부분 유니크 인덱스(웨비나당 송출 1개) 위반 — 동시에 다른 질문이 켜진 경우. 500 대신 409.
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "다른 질문이 방금 송출됐어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
      }
      throw e;
    }
  } else if (body.onScreen === false) {
    await prisma.webinarQA.update({ where: { id: question.id }, data: { onScreen: false } });
  }

  const updated = await prisma.webinarQA.findUnique({ where: { id: question.id } });
  return NextResponse.json({ question: updated });
}

/**
 * 질문 삭제 — 하드 삭제다.
 *
 * '숨기기'(status=dismissed)와 무엇이 다른가:
 *   숨기기 — 시청자에게만 안 보인다(공개 GET·live-state 가 dismissed 를 걸러 낸다). 되돌릴 수 있고
 *            운영 대시보드 '최근 질문'·분석 탭 '상위 질문' 에는 **계속 뜬다**(그쪽은 status 필터가 없다).
 *   삭제   — 기록에서 사라진다. 추천 표(WebinarQAVote)도 cascade 로 함께 지워진다.
 *
 * 왜 필요한가: 테스트로 넣은 질문, 중복 제출, 욕설·타인 정보가 섞인 질문, 그리고 "내 질문
 * 지워 주세요" 요청을 처리할 수단이 지금까지 숨기기밖에 없었다. WebinarQA 는 name·company·
 * phone·email 4개 PII 컬럼을 실제로 들고 있는데 숨기기는 그 값을 하나도 지우지 않는다.
 * (등록자 단위 파기는 webinar-registrant-purge 가 '본문 유지 + PII 익명화' 로 따로 처리한다 —
 *  이건 "그 질문 하나를 없앤다" 는 다른 요청이다.)
 *
 * 소속 검증은 두 조건을 다 건다: id 하나만 맞으면 다른 웨비나의 질문을 지울 수 있다.
 * 삭제하면 부분 유니크 인덱스(웨비나당 송출 1개)도 자연히 비므로 onScreen 별도 처리는 없다.
 */
async function deleteHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string; qaId: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, qaId } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  // 소속이 어긋나면 404 로 끝낸다(존재 여부도 알려주지 않는다). 로그에 남길 값은 지우기 전에 읽는다.
  const question = await prisma.webinarQA.findFirst({
    where: { id: qaId, webinarId: id },
    select: { id: true, status: true, onScreen: true, voteCount: true, registrationId: true, name: true, company: true, phone: true, email: true },
  });
  if (!question) return NextResponse.json({ error: "질문을 찾지 못했어요" }, { status: 404 });

  await prisma.webinarQA.delete({ where: { id: question.id } });

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.qa_deleted",
    // 질문 본문·이름·연락처는 로그에 남기지 않는다 — 지워 달라는 요청으로 지운 것이
    // 활동 로그에 그대로 남으면 파기가 아니다(설문 응답 삭제와 같은 규칙).
    meta: {
      webinarId: id, qaId,
      status: question.status, onScreen: question.onScreen, voteCount: question.voteCount,
      hadRegistration: Boolean(question.registrationId),
      hadPii: Boolean(question.name || question.company || question.phone || question.email),
    },
  });

  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const PATCH = withLiveSignal("qa", patchHandler);
export const DELETE = withLiveSignal("qa", deleteHandler);
