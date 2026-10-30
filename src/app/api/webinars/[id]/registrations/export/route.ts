import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { normalizeRegistrationForm } from "@/lib/webinar-config";
import { assembleWebinarEngagement } from "@/lib/webinar-scoring";
import { normalizeSurveyQuestions, type SurveyAnswers } from "@/lib/webinar-survey";
import { buildRegistrantCsvTable, serializeCsv, type CsvQAItem } from "@/lib/webinar-registrant-csv";
import { buildSessionNumbering, resolveSessionRef } from "@/lib/webinar-sessions";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { id } = await params;
  const webinar = await prisma.webinar.findUnique({ where: { id } });
  if (!webinar) return NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 });

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return NextResponse.json({ error: "접근 권한 없음" }, { status: 403 });
  // 전체 명단(PII) 내보내기 — 웨비나 삭제·대량삭제에 준해 관리자 이상만(MEMBER 차단). 멤버 내보내기가 필요하면 이 가드를 완화하세요.
  if (membership.role === "MEMBER") return NextResponse.json({ error: "명단 내보내기 권한이 없어요. 관리자에게 문의하세요." }, { status: 403 });

  // ?ids=a,b,c 가 있으면 선택 등록자만 내보낸다(없으면 전체) — 이 웨비나 스코프 유지
  const idsParam = new URL(request.url).searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 1000) : null;

  // CSV 에 쓰는 컬럼만 — select 없이 전 컬럼을 끌어오면 대형 JSON 까지 실려 egress 낭비다.
  const registrations = await prisma.webinarRegistration.findMany({
    where: { webinarId: id, ...(ids && ids.length ? { id: { in: ids } } : {}) },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true, name: true, phone: true, email: true, company: true, department: true,
      jobTitle: true, industry: true, agreeMarketing: true, agreeThirdParty: true, submittedAt: true, enteredAt: true,
      memo: true, utmSource: true, utmMedium: true, utmCampaign: true,
      firstUtmSource: true, firstUtmMedium: true, firstUtmCampaign: true, referrer: true,
    },
  });

  // 참여 점수·세그먼트 — 명단과 함께 리드 퀄리티를 내보낸다(캡 적용 체류 기반)
  const engagement = await assembleWebinarEngagement(id, { liveStartAt: webinar.liveStartAt, liveEndAt: webinar.liveEndAt, broadcastEndedAt: webinar.broadcastEndedAt });
  const scoreMap = new Map(engagement.rows.map((r) => [r.registrationId, r]));

  /**
   * 설문 응답·문의를 같은 행에 붙인다 — "누가 설문을 어떻게 했고 무엇을 물었나" 는 사람
   * 기준 질문인데, 예전에는 설문이 화면(등록자 상세)에만 있고 문의는 운영 콘솔에만 있어서
   * 파일로는 답할 수 없었다.
   *
   * 모양이 다른 둘을 다르게 붙인다:
   *   · 설문 — 문항 세트가 고정 → `[설문제목] 문항` 열로 편다(피벗·필터가 바로 된다).
   *   · 문의 — 1인 N건, 개수가 가변 → 열로 펴면 파일마다 열 수가 달라진다. 개수 + 한 칸.
   *
   * 이 라우트는 등록자 전체를 내보내므로(선택 내보내기는 ids 필터) 응답도 전량 필요하다.
   * 등록자 스코프(webinarId + registrationId in 명단)로만 읽어 다른 웨비나가 섞이지 않게 한다.
   */
  const exportedIds = registrations.map((r) => r.id);
  const [surveys, surveyResponses, qaItems, unlinkedSurveyCount, unlinkedQaCount, qaSessions] = await Promise.all([
    prisma.webinarSurvey.findMany({
      where: { webinarId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, questions: true },
    }),
    exportedIds.length
      ? prisma.webinarSurveyResponse.findMany({
          where: { webinarId: id, registrationId: { in: exportedIds } },
          select: { surveyId: true, registrationId: true, answers: true },
        })
      : [],
    exportedIds.length
      ? prisma.webinarQA.findMany({
          where: { webinarId: id, registrationId: { in: exportedIds } },
          orderBy: { createdAt: "asc" },
          select: { registrationId: true, question: true, status: true, sessionNumber: true, createdAt: true },
        })
      : [],
    // 등록자와 연결되지 않은 응답 수 — 명단 행에 붙일 수 없다. 조용히 빼면 "설문 응답
    // 40건이라던데 파일엔 37건" 이 되므로, 응답 헤더로 알려 화면이 문구를 띄운다.
    prisma.webinarSurveyResponse.count({ where: { webinarId: id, registrationId: null } }),
    prisma.webinarQA.count({ where: { webinarId: id, registrationId: null } }),
    // 문의의 세션 참조를 표시번호로 바꾸는 데 쓴다 — 아래 qaNumbering 참고.
    prisma.webinarSession.findMany({ where: { webinarId: id }, select: { number: true, type: true } }),
  ]);

  // 어드민 파일은 수집된 답을 다 보여줘야 한다 — 보관(retired) 문항을 빼면 그 열이 사라져
  // 이미 받은 답변이 파일에서 조용히 없어진다.
  const surveyCols = surveys.map((s) => ({
    id: s.id,
    title: s.title,
    questions: normalizeSurveyQuestions(s.questions, { includeHidden: true }),
  }));

  const answersByReg = new Map<string, Map<string, SurveyAnswers>>();
  for (const r of surveyResponses) {
    if (!r.registrationId) continue;
    let per = answersByReg.get(r.registrationId);
    if (!per) { per = new Map(); answersByReg.set(r.registrationId, per); }
    per.set(r.surveyId, (r.answers ?? {}) as SurveyAnswers);
  }

  /* 문의의 sessionNumber 는 진행 순서 참조 키다 — 파일에 찍는 "세션 n" 은 표시번호여야 한다.
     오프닝·휴식·클로징을 가리키면 null 이 되어 세션 표기 없이 나간다(resolveSessionRef). */
  const qaNumbering = buildSessionNumbering(qaSessions);
  const qaByReg = new Map<string, CsvQAItem[]>();
  for (const q of qaItems) {
    if (!q.registrationId) continue;
    const item: CsvQAItem = {
      question: q.question,
      status: q.status,
      sessionNo: resolveSessionRef(qaNumbering, q.sessionNumber),
      createdAt: q.createdAt,
    };
    const list = qaByReg.get(q.registrationId);
    if (list) list.push(item);
    else qaByReg.set(q.registrationId, [item]);
  }

  // 커스텀 필드 컬럼 — 등록폼 정의 순서(시스템 필드 제외) 그대로 헤더에 편입
  const customFieldDefs = normalizeRegistrationForm(webinar.config, { includeDisabled: true }).fields
    .filter((f) => !f.system);

  const csv = serializeCsv(
    buildRegistrantCsvTable({
      registrants: registrations,
      customFields: customFieldDefs,
      surveys: surveyCols,
      answersByRegistrant: answersByReg,
      qaByRegistrant: qaByReg,
      engagementByRegistrant: scoreMap,
    }),
  );

  await logActivity({
    workspaceId: webinar.workspaceId,
    userId: user.id,
    action: "webinar.registrations.exported",
    meta: { webinarId: id, webinarSlug: webinar.slug, format: "csv", recordCount: registrations.length },
  });

  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrations-${webinar.slug}.csv"`,
      /* 등록자와 연결되지 않은 응답 수 — 화면이 이걸 읽어 안내를 띄운다. 헤더로 보내는 이유:
         본문은 표(1행=1명)여야 하는데, 파일 끝에 열 수가 다른 블록을 붙이면 피벗이 깨진다.
         명단은 fetch 로 받아 blob 으로 내려주므로(handleExport) 헤더가 화면에 닿는다. */
      "X-Mach-Unlinked-Surveys": String(unlinkedSurveyCount),
      "X-Mach-Unlinked-Qa": String(unlinkedQaCount),
    },
  });
}
