import { NextResponse } from "next/server";
import { withLiveSignal } from "@/lib/webinar-live-signal";
import type { Prisma } from "@/generated/prisma";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { isSurveyAcceptingResponses, normalizeSurveyQuestions, retainAnsweredQuestions, surveyOpenState, validateSurveyQuestionLimits } from "@/lib/webinar-survey";

async function authorize(webinarId: string, userId: string) {
  const webinar = await prisma.webinar.findUnique({ where: { id: webinarId }, select: { id: true, workspaceId: true } });
  if (!webinar) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: webinar.workspaceId } },
  });
  return membership ? webinar : null;
}

// 활동 피드 기록 — 다른 푸시 타입(popup/poll/tally)과 동일하게 설문 변경도 감사 로그를 남긴다
function logSurveyUpdate(workspaceId: string, userId: string, webinarId: string, surveyId: string, changes: string[]) {
  return logActivity({
    workspaceId,
    userId,
    action: "webinar.survey_updated",
    meta: { webinarId, surveyId, changes },
  });
}

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string; surveyId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, surveyId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const existing = await prisma.webinarSurvey.findFirst({ where: { id: surveyId, webinarId: id } });
  if (!existing) return NextResponse.json({ error: "없는 설문이에요" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const data: Prisma.WebinarSurveyUpdateInput = {};
  if (typeof body?.title === "string") data.title = body.title.trim() || existing.title;
  if (body?.description !== undefined) data.description = String(body.description ?? "").trim() || null;
  // 제출 완료 화면 문구 — 빈 값이면 null(노출면별 기본 문구로 폴백)
  if (body?.doneTitle !== undefined) data.doneTitle = String(body.doneTitle ?? "").trim() || null;
  if (body?.doneDescription !== undefined) data.doneDescription = String(body.doneDescription ?? "").trim() || null;
  // 종료 화면 카드 버튼 문구 — 빈 값이면 null(EndedScreen 이 "설문 참여하기" 로 폴백)
  if (body?.ctaLabel !== undefined) data.ctaLabel = String(body.ctaLabel ?? "").trim() || null;
  let retiredCount = 0;
  if (body?.questions !== undefined) {
    const incoming = normalizeSurveyQuestions(body.questions, { includeHidden: true });

    // 상한 초과는 조용히 자르지 않고 알린다 — 예전엔 slice(0,30)/slice(0,20) 가 버렸는데
    // 응답은 200 이라 화면에 '저장됨' 이 떴고, 운영자는 문항이 사라진 걸 나중에 알았다.
    const limitError = validateSurveyQuestionLimits(incoming);
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });

    // 편집기에서 지운 문항 중 **이미 답변이 있는 것**은 보관 상태로 남긴다.
    // 정의에서 사라지면 분석·개별응답·CSV 가 그 열을 못 그려 수집된 답변이 조회 불가가 된다.
    const previous = normalizeSurveyQuestions(existing.questions, { includeHidden: true });
    const dropped = previous.filter((q) => !incoming.some((n) => n.id === q.id)).map((q) => q.id);
    let questions = incoming;
    if (dropped.length) {
      const responses = await prisma.webinarSurveyResponse.findMany({
        where: { surveyId, webinarId: id },
        select: { answers: true },
      });
      const answered = new Set<string>();
      for (const r of responses) {
        for (const key of Object.keys((r.answers ?? {}) as Record<string, unknown>)) answered.add(key);
      }
      questions = retainAnsweredQuestions(incoming, previous, answered);
      retiredCount = questions.length - incoming.length;
    }
    data.questions = questions as unknown as Prisma.InputJsonValue;
  }
  if (typeof body?.isOpen === "boolean") data.isOpen = body.isOpen;

  /**
   * 응답 기간 — 시작·마감 예약. null/빈 문자열이면 해제, 아니면 유효한 시각만 수용.
   *
   * 뒤집힌 범위(시작 >= 마감)는 **거부한다.** 판정 함수(surveyOpenState)는 그 조합에서
   * "마감" 을 택해 안전하게 동작하지만, 저장까지 받아 주면 운영자는 기간을 설정했다고
   * 믿는데 설문은 영구히 닫힌 상태가 된다 — 조용히 죽는 설정은 만들지 않는다.
   * 한쪽만 보내는 PATCH 도 있으므로 검사는 **저장 후 최종 상태**로 한다.
   */
  const parseSchedule = (value: unknown, label: string): Date | null | { error: string } => {
    if (value === null || value === "") return null;
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? { error: `${label} 시각이 올바르지 않아요` } : d;
  };
  if (body?.opensAt !== undefined) {
    const r = parseSchedule(body.opensAt, "시작 예약");
    if (r && typeof r === "object" && "error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    data.opensAt = r;
  }
  if (body?.closesAt !== undefined) {
    const r = parseSchedule(body.closesAt, "마감 예약");
    if (r && typeof r === "object" && "error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    data.closesAt = r;
  }
  /**
   * 저장 후 최종 응답 창을 미리 계산한다 — 아래 두 판정이 이 값을 쓴다.
   * (한쪽만 보내는 PATCH 가 흔하므로 현재 값과 합쳐야 한다.)
   */
  const scheduleTouched = body?.opensAt !== undefined || body?.closesAt !== undefined;
  const nextWindow = {
    isOpen: typeof body?.isOpen === "boolean" ? body.isOpen : existing.isOpen,
    opensAt: data.opensAt !== undefined ? (data.opensAt as Date | null) : existing.opensAt,
    closesAt: data.closesAt !== undefined ? (data.closesAt as Date | null) : existing.closesAt,
  };
  if (scheduleTouched) {
    if (nextWindow.opensAt && nextWindow.closesAt && nextWindow.opensAt.getTime() >= nextWindow.closesAt.getTime()) {
      return NextResponse.json({ error: "시작이 마감보다 늦어요 — 기간을 다시 확인해주세요" }, { status: 400 });
    }
    /**
     * 송출 중인 설문에 응답 기간을 걸어 지금 못 받게 만들면 **발행도 내린다.**
     *
     * live-state 는 응답 기간을 벗어난 설문을 걸러 시청자에게 안 보낸다. 그래서 발행 플래그만
     * 남으면 콘솔은 "송출 중" 이라 하고 시청자 화면엔 아무것도 없는, 아무도 못 알아채는 어긋남이
     * 생긴다. 상태를 바꾼 그 요청에서 같이 정리하는 게 정직하다.
     */
    if (existing.isActive && !isSurveyAcceptingResponses(nextWindow)) {
      data.isActive = false;
    }
  }

  /**
   * 종료 화면 연결은 **여러 개 가능**하다 — 만족도 설문과 다음 행사 사전조사를 함께 걸 수 있다.
   * 예전엔 켤 때 다른 설문의 연결을 내렸는데(원-액티브), 스키마에는 그런 제약이 없었고
   * 코드만 하나로 묶고 있었다. 종료 화면이 카드 목록이라 N개를 그리는 데 문제가 없다.
   *
   * 라이브 푸시(isActive)는 여전히 하나뿐이다 — 그건 화면을 덮는 오버레이라 겹치면 안 되고,
   * 부분 유니크 인덱스가 DB 차원에서 보증한다(아래 블록). 두 축을 섞지 않는다.
   */
  if (typeof body?.showOnEnded === "boolean") data.showOnEnded = body.showOnEnded;

  // 라이브 푸시 활성화 — 원-액티브: 켤 때 기존 활성 설문을 먼저 내린다 (부분 유니크 인덱스가 레이스 보증, P2002→409)
  if (body?.isActive === true) {
    /**
     * 지금 응답을 받지 않는 설문은 **발행을 거절한다.**
     *
     * 예전엔 그대로 200 이었다. 그런데 live-state 가 걸러서 시청자에게는 아무것도 안 뜨고,
     * 더 나쁜 건 아래 트랜잭션 첫 줄이 **지금 잘 송출되던 설문을 내려버린다**는 것이다 —
     * 라이브 중에 화면이 조용히 비는 사고가 된다. 그래서 트랜잭션 앞에서 막는다.
     */
    if (!isSurveyAcceptingResponses(nextWindow)) {
      const state = surveyOpenState(nextWindow);
      return NextResponse.json(
        {
          error:
            state === "before"
              ? "아직 응답 시작 전인 설문이에요 — 시작 예약을 지우거나 시각이 지난 뒤 발행해주세요"
              : state === "closed"
                ? "응답이 마감된 설문이에요 — 마감 예약을 지운 뒤 발행해주세요"
                : "응답 받기가 꺼진 설문이에요 — 먼저 켜주세요",
          state,
        },
        { status: 400 },
      );
    }
    try {
      const [, survey] = await prisma.$transaction([
        prisma.webinarSurvey.updateMany({ where: { webinarId: id, isActive: true }, data: { isActive: false } }),
        // pushedAt = 재노출 키 — 발행 시에만 갱신 (편집으로 바뀌는 updatedAt 과 분리해, 라이브 중 수정이 시청자 모달을 재노출하지 않게)
        prisma.webinarSurvey.update({ where: { id: surveyId }, data: { ...data, isActive: true, pushedAt: new Date(), sentBy: user.id } }),
      ]);
      await logSurveyUpdate(webinar.workspaceId, user.id, id, surveyId, ["isActive:true", ...Object.keys(data)]);
      return NextResponse.json({ survey, retired: retiredCount });
    } catch (e) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "다른 설문이 방금 발행됐어요. 새로고침 후 다시 시도해주세요." }, { status: 409 });
      }
      throw e;
    }
  }
  if (body?.isActive === false) data.isActive = false;

  const survey = await prisma.webinarSurvey.update({ where: { id: surveyId }, data });
  // 자동저장(문항 편집)까지 전부 기록하면 피드가 시끄러워짐 — 발행/중지·마감·마감 예약·종료화면 연결 같은 상태 변화만 남긴다
  if (body?.isActive === false || typeof body?.isOpen === "boolean" || typeof body?.showOnEnded === "boolean" || body?.opensAt !== undefined || body?.closesAt !== undefined) {
    await logSurveyUpdate(webinar.workspaceId, user.id, id, surveyId, Object.keys(data));
  }
  // retired — 답변이 있어 보관 처리된 문항 수. 편집기가 "지웠지만 보관됨" 을 알릴 수 있게 함께 준다.
  return NextResponse.json({ survey, retired: retiredCount });
}

async function deleteHandler(request: Request, { params }: { params: Promise<{ id: string; surveyId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id, surveyId } = await params;
  const webinar = await authorize(id, user.id);
  if (!webinar) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });

  const existing = await prisma.webinarSurvey.findFirst({ where: { id: surveyId, webinarId: id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "없는 설문이에요" }, { status: 404 });

  await prisma.webinarSurvey.delete({ where: { id: surveyId } });
  await logActivity({ workspaceId: webinar.workspaceId, userId: user.id, action: "webinar.survey_deleted", meta: { webinarId: id, surveyId } });
  return NextResponse.json({ ok: true });
}

// 라이브 시청 화면 즉시 알림 — 성공한 변경만(src/lib/webinar-live-signal.ts)
export const PATCH = withLiveSignal("survey", patchHandler);
export const DELETE = withLiveSignal("survey", deleteHandler);
