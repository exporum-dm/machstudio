import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { collectColumnsFor } from "@/lib/collect-columns";
import { logActivity } from "@/lib/activity";
import { normalizeCollectForm } from "@/lib/collect-form-config";

/**
 * 화면에 돌려주는 소스 한 벌.
 *
 * **GET 과 PATCH 가 반드시 같은 모양이어야 한다** — 화면은 저장 성공 시 응답으로 상태를
 * 통째로 갈아끼운다. 두 곳에서 따로 조립하면 저장 직후에만 화면이 달라지는, 재현하기
 * 어려운 종류의 어긋남이 생긴다.
 */
function sourcePayload<T extends Parameters<typeof collectColumnsFor>[0]>(source: T) {
  // 체크인 PIN 해시는 화면으로 내보내지 않는다 — 설정됐는지만 알면 된다(체크인 탭은 자기 API 로 읽는다).
  const { checkinPinHash, ...rest } = source as T & { checkinPinHash?: string | null };
  return { ...rest, checkinPinSet: Boolean(checkinPinHash), fieldMappings: collectColumnsFor(source) };
}

function normalizeOriginInput(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function getSourceWithAuth(id: string, userId: string, requireAdmin = false) {
  const source = await prisma.collectSource.findUnique({ where: { id } });
  if (!source) return { error: "소스를 찾을 수 없어요", status: 404 };

  const membership = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: source.workspaceId } },
  });
  if (!membership) return { error: "접근 권한 없음", status: 403 };
  if (requireAdmin && membership.role === "MEMBER") return { error: "권한 없음", status: 403 };

  return { source, membership };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const result = await getSourceWithAuth(id, user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const source = await prisma.collectSource.findUnique({
    where: { id },
    include: {
      fieldMappings: { orderBy: { sortOrder: "asc" } },
      _count: { select: { records: true } },
    },
  });
  if (!source) return NextResponse.json({ error: "소스를 찾을 수 없어요" }, { status: 404 });

  /**
   * **빌더형은 열을 formConfig 에서 파생해 실어 보낸다.**
   *
   * 표 헤더·셀·CSV·상세 패널이 전부 `source.fieldMappings` 를 읽는데, 그 테이블은 연동형
   * 전용이다(운영자가 '필드' 탭에서 채우는데 빌더형에는 그 탭이 없다). 그대로 두면 빌더형
   * 소스는 등록이 아무리 쌓여도 표에 '시간'과 UTM 열만 보인다.
   *
   * 파생값을 같은 자리에 실으면 **소비처를 한 곳도 안 고치고** 동작한다. 연동형은 저장된
   * 값을 그대로 통과시키므로 기존 화면(레코드 52,000건)은 한 글자도 바뀌지 않는다.
   */
  return NextResponse.json({ source: sourcePayload(source) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const result = await getSourceWithAuth(id, user.id, true);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const body = await request.json();
  const {
    name, description, siteUrl, successTrigger, redirectUrl, isActive,
    webhookUrl, notifyOnSubmit, allowedOrigins, formPagePatterns, dedupKeyFields, fieldGroupSelector,
  } = body;

  /**
   * "기본 정보" 탭(일자·장소·관람시간·키컬러·하이라이트 영상·포스터) — venueConfig 는
   * 원래 "개최일·게이트·배지 등 현장 운영 설정"용으로 만들어 둔 자유 JSON 이라 스키마
   * 마이그레이션 없이 여기 담는다. 알려진 키만 골라 트림/길이 제한한다 — 운영자가 콘솔에서
   * 임의 JSON 을 넣어도 레코드 조회 API 응답이 커지거나 이상한 키가 영구히 남지 않게.
   */
  let normalizedVenueConfig: Record<string, string> | undefined;
  if (body.venueConfig !== undefined) {
    const v = (body.venueConfig ?? {}) as Record<string, unknown>;
    const pick = (key: string, max = 300) => {
      const raw = v[key];
      if (typeof raw !== "string") return undefined;
      const trimmed = raw.trim().slice(0, max);
      return trimmed || undefined;
    };
    normalizedVenueConfig = {
      ...(pick("eventStart", 10) && { eventStart: pick("eventStart", 10)! }),
      ...(pick("eventEnd", 10) && { eventEnd: pick("eventEnd", 10)! }),
      ...(pick("venue") && { venue: pick("venue")! }),
      ...(pick("visitingHours") && { visitingHours: pick("visitingHours")! }),
      ...(pick("accentColor", 20) && { accentColor: pick("accentColor", 20)! }),
      ...(pick("highlightVideoUrl", 500) && { highlightVideoUrl: pick("highlightVideoUrl", 500)! }),
      ...(pick("posterUrl", 500) && { posterUrl: pick("posterUrl", 500)! }),
    };
  }

  // 필드 감지 선택자 — 비거나 형식이 아니면 기본값(아임웹 관례)으로 되돌린다. 조용히 빈 채로
  // 저장하면 연동형 스크립트가 아무 필드도 못 찾는 채로 조용히 배포된다.
  const normalizedFieldGroupSelector: string | undefined =
    fieldGroupSelector !== undefined
      ? (typeof fieldGroupSelector === "string" && fieldGroupSelector.trim() ? fieldGroupSelector.trim().slice(0, 200) : ".form-group")
      : undefined;

  let normalizedAllowed: string[] | undefined;
  if (Array.isArray(allowedOrigins)) {
    normalizedAllowed = allowedOrigins
      .map((o) => normalizeOriginInput(o))
      .filter((o): o is string => !!o);
    // 중복 제거
    normalizedAllowed = Array.from(new Set(normalizedAllowed));
  }

  // formPagePatterns: 빈 배열도 valid (= "모든 페이지" 의미).
  // 각 항목은 trim + 200자 제한, 최대 20개.
  let normalizedFormPagePatterns: string[] | undefined;
  if (Array.isArray(formPagePatterns)) {
    normalizedFormPagePatterns = formPagePatterns
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.length <= 200);
    normalizedFormPagePatterns = Array.from(new Set(normalizedFormPagePatterns)).slice(0, 20);
  }

  // dedupKeyFields: 가져오기 중복 판정용 우선순위 필드 key 목록. 빈 배열 = 전체 시그니처 fallback.
  // trim + 빈값 제거 + 중복 제거, 최대 10개.
  let normalizedDedupKeyFields: string[] | undefined;
  if (Array.isArray(dedupKeyFields)) {
    normalizedDedupKeyFields = dedupKeyFields
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    normalizedDedupKeyFields = Array.from(new Set(normalizedDedupKeyFields)).slice(0, 10);
  }

  /**
   * 방식 전환은 **레코드가 0건일 때만** 허용한다(설계 §3.1).
   *
   * 연동형은 외부 폼의 필드명을, 빌더형은 빌더에서 정한 key 를 저장한다. 데이터가 쌓인 뒤
   * 바꾸면 한 소스 안에 두 체계의 레코드가 섞여 표·CSV·분석이 전부 어긋난다. 되돌릴 방법도 없다.
   * 막는 대신 새 소스를 만들도록 안내한다.
   */
  let nextMode: string | undefined;
  if (body.mode !== undefined) {
    /**
     * 아는 값이 아니면 **400 으로 거절**한다. 예전엔 `=== "builder" ? … : "capture"` 로 뭉갰는데,
     * 그러면 설정 폼이 상태를 통째로 되돌려 보내며 넣은 `mode: null` 같은 값이 "capture 로
     * 바꿔 달라" 는 요청이 돼 버린다 — 레코드가 없으면 빌더 소스가 조용히 강등되고(폼 정의가
     * 고아가 된다), 있으면 아래 409 가 나면서 **같은 PATCH 의 이름·오리진 수정까지 통째로
     * 버려진다.** 웨비나 statusOverride 도 같은 이유로 값을 검사하고 400 을 낸다.
     */
    if (body.mode !== "builder" && body.mode !== "capture") {
      return NextResponse.json({ error: "알 수 없는 수집 방식이에요" }, { status: 400 });
    }
    const requested = body.mode;
    if (requested !== result.source.mode) {
      const recordCount = await prisma.collectRecord.count({ where: { sourceId: id } });
      if (recordCount > 0) {
        return NextResponse.json(
          { error: `이미 ${recordCount.toLocaleString()}건이 수집돼 방식을 바꿀 수 없어요. 새 수집 소스를 만들어 주세요` },
          { status: 409 },
        );
      }
      nextMode = requested;
    }
  }

  const source = await prisma.collectSource.update({
    where: { id },
    data: {
      ...(nextMode !== undefined && {
        mode: nextMode,
        // 빌더형이 되는데 토큰이 없으면 지금 발급한다(연동형으로 만들어진 소스를 전환한 경우).
        ...(nextMode === "builder" && !result.source.previewToken && { previewToken: randomBytes(24).toString("base64url") }),
        // 연동형으로 돌아가면 미리보기 링크를 **끊는다.** 남겨 두면 빌더가 아닌 소스의 /p/{token}
        // 이 계속 살아 있고, 나중에 다시 빌더로 바꿔도 옛 토큰이 재사용돼 "재발급으로 링크를
        // 끊는다"(§16.1)는 토큰의 존재 이유가 무너진다.
        ...(nextMode === "capture" && { previewToken: null }),
      }),
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(siteUrl !== undefined && { siteUrl: siteUrl || null }),
      ...(successTrigger !== undefined && { successTrigger }),
      ...(redirectUrl !== undefined && { redirectUrl: redirectUrl || null }),
      ...(isActive !== undefined && { isActive }),
      ...(webhookUrl !== undefined && { webhookUrl: webhookUrl || null }),
      ...(notifyOnSubmit !== undefined && { notifyOnSubmit: !!notifyOnSubmit }),
      ...(normalizedAllowed !== undefined && { allowedOrigins: normalizedAllowed }),
      ...(normalizedFormPagePatterns !== undefined && { formPagePatterns: normalizedFormPagePatterns }),
      ...(normalizedDedupKeyFields !== undefined && { dedupKeyFields: normalizedDedupKeyFields }),
      ...(normalizedVenueConfig !== undefined && { venueConfig: normalizedVenueConfig as unknown as object }),
      ...(normalizedFieldGroupSelector !== undefined && { fieldGroupSelector: normalizedFieldGroupSelector }),
      /**
       * 폼 정의는 **정규화해서 저장한다.**
       *
       * 읽는 쪽도 정규화하지만(JSONB 라 어떤 값이든 들어올 수 있다), 쓸 때 한 번 걸러 두면
       * 저장된 것 자체가 항상 같은 모양이 된다 — 빌더 자동저장의 중간 상태나 손으로 고친 값이
       * DB 에 그대로 남지 않는다. 공개 폼은 매 요청 이걸 읽으므로 읽기 비용도 줄어든다.
       */
      ...(body.formConfig !== undefined && { formConfig: normalizeCollectForm(body.formConfig) as unknown as object }),
    },
    include: { fieldMappings: { orderBy: { sortOrder: "asc" } } },
  });

  await logActivity({
    workspaceId: source.workspaceId,
    sourceId: source.id,
    userId: user.id,
    action: "source.updated",
    meta: { fields: Object.keys(body) },
  });

  /**
   * **GET 과 같은 계약으로 돌려준다.** 화면은 저장 성공 시 상태를 통째로 교체하는데
   * (collect/[id]/page.tsx 의 setSource), 원본 매핑을 그대로 주면 빌더형은 그 값이
   * 항상 [] 라 방금까지 보이던 문항 열이 화면에서 사라진다 — 새로고침해야 돌아온다.
   * 운영자에게는 "저장했더니 데이터가 날아갔다" 로 보인다.
   */
  return NextResponse.json({ source: sourcePayload(source) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const result = await getSourceWithAuth(id, user.id, true);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const wsId = result.source.workspaceId;
  const srcName = result.source.name;
  // Soft delete: 30일 동안 복구 가능, 그 후 cron 으로 영구 제거
  await prisma.collectSource.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await logActivity({
    workspaceId: wsId,
    sourceId: null,
    userId: user.id,
    action: "source.deleted",
    meta: { name: srcName, sourceId: id, softDelete: true },
  });

  return NextResponse.json({ ok: true, softDeleted: true });
}
