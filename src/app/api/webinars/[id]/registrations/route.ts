import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { normalizeSurveyQuestions } from "@/lib/webinar-survey";
import { assembleWebinarEngagement } from "@/lib/webinar-scoring";
import { resolveWebinarStatus } from "@/lib/webinar-status";
import { buildMemo, parseMemo } from "@/lib/webinar-memo";
import { buildSessionNumbering, resolveSessionRef } from "@/lib/webinar-sessions";

type DuplicateMode = "skip" | "include" | "update";

interface RegistrationInput {
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

/** 세그먼트 필터 값 — 참여 점수에서 파생되므로 SQL 이 아니라 JS 에서 좁힌다(아래 주석 참고). */
const SEGMENT_FILTERS = ["hot", "warm", "cold", "noShow"] as const;
type SegmentFilter = (typeof SEGMENT_FILTERS)[number];

const sortMap = {
  name: "name",
  phone: "phone",
  email: "email",
  company: "company",
  department: "department",
  jobTitle: "jobTitle",
  industry: "industry",
  agreeMarketing: "agreeMarketing",
  enteredAt: "enteredAt",
  lastPingAt: "lastPingAt",
  stayMinutes: "connectedSeconds", // "체류" 정렬 = 접속 시간 기준
  submittedAt: "submittedAt",
  isActive: "isActive",
} as const;

async function authorize(webinarId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, webinar: null, error: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };

  const webinar = await prisma.webinar.findUnique({ where: { id: webinarId } });
  if (!webinar) return { user, webinar: null, error: NextResponse.json({ error: "없는 웨비나예요" }, { status: 404 }) };

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: webinar.workspaceId } },
  });
  if (!membership) return { user, webinar, error: NextResponse.json({ error: "접근 권한 없음" }, { status: 403 }) };

  return { user, webinar, error: null };
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

function normalizeInput(input: RegistrationInput) {
  return {
    name: String(input.name ?? "").trim(),
    phone: normalizePhone(input.phone),
    email: normalizeEmail(input.email),
    company: clean(input.company),
    department: clean(input.department),
    jobTitle: clean(input.jobTitle),
    industry: clean(input.industry),
    agreeMarketing: Boolean(input.agreeMarketing),
    agreePrivacy: input.agreePrivacy !== false,
    agreeThirdParty: Boolean(input.agreeThirdParty),
    memo: clean(input.memo),
  };
}

async function findDuplicate(webinarId: string, phone: string | null, email: string | null) {
  if (!phone && !email) return null;
  return prisma.webinarRegistration.findFirst({
    where: {
      webinarId,
      OR: [
        ...(phone ? [{ phone }] : []),
        // 공개 등록 경로와 동일하게, 과거 대문자 포함 이메일도 중복으로 취급한다.
        ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: { submittedAt: "asc" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(200, Math.max(10, parseInt(searchParams.get("pageSize") ?? "50", 10)));
  const q = searchParams.get("q") ?? "";
  const sortByRaw = searchParams.get("sortBy");
  const sortBy = sortByRaw as keyof typeof sortMap | null;
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const sortColumn = sortBy && sortMap[sortBy] ? sortMap[sortBy] : "submittedAt";

  /* 참여 점수·세그먼트로 걸러고 정렬한다 — 리드 스코어링이 분석 탭과 CSV 에만 있어서,
     정작 팔로업하는 화면(등록자 명단)에서는 누구부터 연락할지 정할 수 없었다.
     점수는 체류·인터랙션을 JS 에서 합성하므로 SQL ORDER BY / WHERE 로 표현할 수 없다 →
     검색 조건이 걸린 후보 id 만 먼저 뽑고, 점수로 좁혀 정렬한 뒤 그 페이지만 본문을 읽는다. */
  const segmentParam = searchParams.get("segment");
  const segmentFilter = (SEGMENT_FILTERS as readonly string[]).includes(segmentParam ?? "")
    ? (segmentParam as SegmentFilter)
    : null;
  const sortByScore = sortByRaw === "score";

  const where = {
    webinarId: id,
    ...(q ? {
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { phone: { contains: q, mode: "insensitive" as const } },
        { email: { contains: q, mode: "insensitive" as const } },
        { company: { contains: q, mode: "insensitive" as const } },
        { department: { contains: q, mode: "insensitive" as const } },
        { jobTitle: { contains: q, mode: "insensitive" as const } },
        { industry: { contains: q, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  // "현재 시청" 판정 창 — isActive 는 heartbeat 가 세운 뒤 leave 이벤트가 안 오면(탭 강제종료 등)
  // 방송이 끝난 뒤에도 영원히 true 로 남는다. live-state 라우트(공개 뷰어 카운트)가 이미 같은
  // 함정을 피하려고 쓰는 최근성 창(presencePingAt/lastPingAt 이 최근 5분 안)을 여기서도 쓴다 —
  // 어드민 요약 카드와 상태 열이 서로 다른 "현재 시청" 숫자를 보여주면 안 된다.
  const PRESENCE_WINDOW_MS = 5 * 60_000;
  const presenceSince = new Date(Date.now() - PRESENCE_WINDOW_MS);

  const webinar = auth.webinar!;
  const engagement = await assembleWebinarEngagement(id, webinar);
  const scoreMap = new Map(engagement.rows.map((r) => [r.registrationId, r]));
  const status = resolveWebinarStatus(webinar).status;
  const phase: "before" | "live" | "ended" = status === "ended" ? "ended" : status === "live" ? "live" : "before";

  /* 세그먼트 분포 — 필터 칩에 개수를 함께 보여준다. 점수를 이미 조립했으니 추가 쿼리는 없다. */
  const segmentCounts = { hot: 0, warm: 0, cold: 0, noShow: 0 };
  for (const r of engagement.rows) {
    if (!r.entered) segmentCounts.noShow += 1;
    else segmentCounts[r.segment] += 1;
  }

  /* 점수 기반 필터·정렬이 걸렸을 때만 id 스코프를 계산한다(평소 경로는 그대로 SQL 페이징).
     후보는 id·submittedAt 만 읽어 전송량을 묶는다 — 본문은 잘라낸 페이지만 읽는다. */
  let scopedIds: string[] | null = null;
  if (segmentFilter || sortByScore) {
    const candidates = await prisma.webinarRegistration.findMany({ where, select: { id: true, submittedAt: true } });
    const picked = candidates.filter((c) => {
      if (!segmentFilter) return true;
      const s = scoreMap.get(c.id);
      if (!s) return false;
      return segmentFilter === "noShow" ? !s.entered : s.entered && s.segment === segmentFilter;
    });
    if (sortByScore) {
      const dir = sortDir === "asc" ? 1 : -1;
      // 동점은 최신 등록 우선 — 순서가 흔들리면 페이지를 넘길 때 같은 사람이 두 번 보인다.
      picked.sort((a, b) => {
        const diff = ((scoreMap.get(a.id)?.score ?? -1) - (scoreMap.get(b.id)?.score ?? -1)) * dir;
        return diff !== 0 ? diff : b.submittedAt.getTime() - a.submittedAt.getTime();
      });
    } else {
      picked.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    }
    scopedIds = picked.map((c) => c.id);
  }
  const pageIds = scopedIds ? scopedIds.slice((page - 1) * pageSize, page * pageSize) : null;

  const [registrations, total, registered, entered, active, surveys, surveyParticipants] = await Promise.all([
    prisma.webinarRegistration.findMany({
      // 점수 스코프가 있으면 그 페이지 id 만 읽고 순서는 아래에서 되돌린다(IN 은 순서를 보장하지 않는다).
      where: pageIds ? { webinarId: id, id: { in: pageIds } } : where,
      ...(pageIds
        ? {}
        : { orderBy: [{ [sortColumn]: sortDir }, { submittedAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      // UI(RegistrantsTab)가 쓰는 필드만 — journey JSON·userAgent·UTM 12컬럼 등 미사용 컬럼 전송 방지(페이지당 최대 200행).
      select: {
        id: true, name: true, phone: true, email: true, company: true, department: true,
        jobTitle: true, industry: true, agreeMarketing: true, agreePrivacy: true, agreeThirdParty: true, memo: true,
        connectedSeconds: true, focusSeconds: true, stayMinutes: true,
        isActive: true, submittedAt: true, enteredAt: true, lastPingAt: true, presencePingAt: true,
        // 유입 경로 — 상세 패널이 "이 리드가 어디서 왔나" 를 보여준다(저장만 하고 화면엔 없던 값).
        utmSource: true, utmMedium: true, utmCampaign: true,
        firstUtmSource: true, firstUtmMedium: true, firstUtmCampaign: true, referrer: true,
      },
    }),
    // 점수 스코프가 있으면 페이지네이션 총계도 그 개수여야 한다(SQL count 는 세그먼트를 모른다).
    scopedIds ? Promise.resolve(scopedIds.length) : prisma.webinarRegistration.count({ where }),
    prisma.webinarRegistration.count({ where: { webinarId: id } }),
    prisma.webinarRegistration.count({ where: { webinarId: id, enteredAt: { not: null } } }),
    prisma.webinarRegistration.count({
      where: {
        webinarId: id,
        isActive: true,
        OR: [{ presencePingAt: { gte: presenceSince } }, { lastPingAt: { gte: presenceSince } }],
      },
    }),
    // 목록에는 설문별 참여 현황과 답변 라벨이 필요하다. 응답은 현재 페이지 등록자만 뒤에서
    // 가져와 페이징당 전송량을 제한하고, 설문 정의는 작으므로 한 번에 함께 보낸다.
    prisma.webinarSurvey.findMany({
      where: { webinarId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, questions: true },
    }),
    prisma.webinarSurveyResponse.groupBy({
      by: ["registrationId"],
      where: { webinarId: id, registrationId: { not: null } },
    }),
  ]);

  // IN 절은 순서를 보장하지 않는다 — 점수 정렬로 잘라낸 페이지는 그 순서를 그대로 되돌린다.
  const ordered = pageIds
    ? pageIds.map((pid) => registrations.find((r) => r.id === pid)).filter((r): r is (typeof registrations)[number] => !!r)
    : registrations;

  // 상태 열도 같은 최근성 기준을 쓰도록 행마다 isLive 를 함께 내려준다 — isActive 원본값만 보면
  // 방송이 끝난 뒤에도 계속 "시청 중"으로 표시된다(위 active 집계와 같은 함정).
  // 참여 점수·세그먼트·근거도 행에 붙인다 — 명단에서 바로 팔로업 순서를 정할 수 있게.
  const registrationsWithLiveFlag = ordered.map((r) => {
    const s = scoreMap.get(r.id);
    return {
      ...r,
      isLive: r.isActive && (
        (r.presencePingAt !== null && r.presencePingAt >= presenceSince) ||
        (r.lastPingAt !== null && r.lastPingAt >= presenceSince)
      ),
      score: s?.score ?? 0,
      segment: s ? (s.entered ? s.segment : "noShow") : "noShow",
      scoreBreakdown: s?.breakdown ?? null,
    };
  });

  const registrationIds = registrations.map((registration) => registration.id);
  /* 설문 응답과 문의를 같은 방식으로 붙인다 — 현재 페이지 등록자분만. 문의는 1인 N건이라
     전량을 실으면 페이지당 전송량이 등록자 수와 무관하게 커진다.
     정렬은 오래된 순: 상세 패널이 "무엇을 먼저 물었나" 순서로 읽히게. */
  const [surveyResponses, qaRows, qaSessions] = registrationIds.length
    ? await Promise.all([
        prisma.webinarSurveyResponse.findMany({
          where: { webinarId: id, registrationId: { in: registrationIds } },
          orderBy: { submittedAt: "desc" },
          select: { surveyId: true, registrationId: true, answers: true, source: true, submittedAt: true },
        }),
        prisma.webinarQA.findMany({
          where: { webinarId: id, registrationId: { in: registrationIds } },
          orderBy: { createdAt: "asc" },
          select: { id: true, registrationId: true, question: true, status: true, sessionNumber: true, voteCount: true, createdAt: true },
        }),
        prisma.webinarSession.findMany({ where: { webinarId: id }, select: { number: true, type: true } }),
      ])
    : [[], [], []];

  /* 문의의 sessionNumber 는 진행 순서 참조 키다 — 상세 패널이 "세션 n" 으로 읽을 수 있게
     표시번호로 바꿔 내려준다(오프닝·휴식·클로징이면 null → 배지 없음). 원본은 싣지 않는다. */
  const qaNumbering = buildSessionNumbering(qaSessions);
  const qaItems = qaRows.map(({ sessionNumber, ...rest }) => ({
    ...rest,
    sessionNo: resolveSessionRef(qaNumbering, sessionNumber),
  }));

  // stats 는 검색 필터와 무관한 전체 집계(요약 카드용). total 은 검색 반영 페이지네이션용.
  return NextResponse.json({
    registrations: registrationsWithLiveFlag,
    total,
    stats: { registered, entered, active, surveyResponded: surveyParticipants.length, segments: segmentCounts },
    /* 방송 전에는 전원이 노쇼로 잡히므로 화면이 점수 열·필터를 숨긴다(분석 탭과 같은 규칙).
       liveMinutes 는 점수 분모로 실제 쓴 방송 경과 분 — 툴팁이 "체류 40/47분" 을 검산할 수 있게. */
    scoring: { phase, liveMinutes: engagement.liveMinutes, scheduledMinutes: engagement.scheduledMinutes },
    surveys: surveys.map((survey) => ({
      ...survey,
      // 어드민 명단은 수집된 답변을 다 보여줘야 한다 — 제목이 비거나 선택지가 지워진
      // 문항을 정의에서 빼면 그 답변이 화면에서 조용히 사라진다.
      questions: normalizeSurveyQuestions(survey.questions, { includeHidden: true }),
    })),
    surveyResponses,
    qaItems,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const body = await request.json();
  const duplicateMode = (body.duplicateMode === "include" || body.duplicateMode === "update" ? body.duplicateMode : "skip") as DuplicateMode;
  const rows: RegistrationInput[] = Array.isArray(body.registrations)
    ? body.registrations
    : body.registration
      ? [body.registration]
      : [];

  // 중복=업데이트 모드에서 "무엇을 갱신할지" — CSV 에 실제로 있던 열 목록.
  // normalizeInput 은 항상 10개 키를 다 채워 돌려주므로(없는 값은 null/false), 그걸 그대로
  // update 에 넘기면 CSV 에 없던 열이 기존 값을 **지운다**. 특히 agreeMarketing 이 false 로,
  // agreePrivacy 는 반대로 true 로 강제돼 동의 상태가 뒤바뀐다.
  // null = 목록 없음 → 전체 덮어쓰기(수동 입력 폼. 모든 칸이 화면에 보이니 입력값이 곧 진실).
  const providedFields: Set<string> | null = Array.isArray(body.providedFields)
    ? new Set((body.providedFields as unknown[]).filter((f): f is string => typeof f === "string"))
    : null;

  if (!rows.length) {
    return NextResponse.json({ error: "등록할 데이터가 없습니다." }, { status: 400 });
  }
  // 행 상한 — 초대형 임포트가 서버리스 타임아웃으로 부분 커밋되어 재시도 시 중복 생성되는 것을 방지.
  if (rows.length > 5000) {
    return NextResponse.json({ error: "한 번에 최대 5,000행까지 등록할 수 있어요. 파일을 나눠서 올려주세요." }, { status: 400 });
  }

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [] as { index: number; message: string }[],
  };
  const seenKeys = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const data = normalizeInput(rows[index]);
    if (!data.name) {
      result.errors.push({ index, message: "이름이 없습니다." });
      continue;
    }
    if (!data.phone && !data.email) {
      result.errors.push({ index, message: "연락처 또는 이메일이 필요합니다." });
      continue;
    }

    const key = data.phone ? `p:${data.phone}` : `e:${data.email}`;

    try {
      const duplicate = duplicateMode === "include" ? null : await findDuplicate(id, data.phone, data.email);
      const batchDuplicate = duplicateMode !== "include" && seenKeys.has(key);

      if ((duplicate || batchDuplicate) && duplicateMode === "skip") {
        result.skipped += 1;
        continue;
      }

      if (duplicate && duplicateMode === "update") {
        const updateData: Record<string, unknown> = providedFields
          ? Object.fromEntries(Object.entries(data).filter(([k]) => providedFields.has(k)))
          : { ...data };
        // memo 컬럼은 평문이 아니라 { memo, customFields } JSON 이다(webinar-memo.ts). data.memo 는
        // normalizeInput 이 만든 평문 노트뿐이라, 그대로 update 에 실으면 이 등록자가 등록 폼에서
        // 제출한 customFields 가 영구히 지워진다(단건 PATCH 가 이미 겪었던 문제와 같음). 단건 PATCH
        // 와 같은 방식으로 기존 memo 에서 customFields 만 꺼내 새 note 와 재조립한다 — providedFields
        // 가 null(수동 등록 폼)이라 모든 칸을 덮어쓰는 경우도 이 규칙은 그대로 적용한다.
        if ("memo" in updateData) {
          updateData.memo = buildMemo(data.memo ?? "", parseMemo(duplicate.memo).customFields);
        }
        await prisma.webinarRegistration.update({
          where: { id: duplicate.id },
          data: updateData,
        });
        result.updated += 1;
        seenKeys.add(key);
        continue;
      }

      await prisma.webinarRegistration.create({
        data: {
          webinarId: id,
          ...data,
        },
      });
      result.created += 1;
      seenKeys.add(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      result.errors.push({ index, message: `${data.name || data.email || data.phone || "행"}: ${message}` });
      continue;
    }
  }

  return NextResponse.json(result, { status: result.created || result.updated || result.skipped ? 200 : 400 });
}
