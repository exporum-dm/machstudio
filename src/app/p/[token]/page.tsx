/**
 * 빌더형 등록 폼 **미리보기 링크** — /p/{previewToken} (설계 §16.1).
 *
 * 공개 폼이 아직 서기 전에도 운영자가 링크 하나로 "이렇게 보인다" 를 공유하려고 만든 자리다.
 * 그래서 두 가지가 동시에 참이어야 한다:
 *  1. **로그인 없이 열린다** — 검토자는 워크스페이스 멤버가 아닌 경우가 대부분이다.
 *  2. **아무 부작용도 없다** — 저장·이메일·추적이 전부 없다. 렌더러에 onSubmit 을 넘기지
 *     않는 것이 그 장치이고(제출 버튼은 검증만 한다), 이 페이지는 조회 외의 쿼리를 하지 않는다.
 *
 * 토큰은 24바이트 난수라 추측할 수 없다. 그래도 **검색엔진에는 올리지 않는다** — 아래 robots.
 * 유출되면 재발급으로 끊는다(설정 탭의 "미리보기 링크 새로 발급").
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import {
  REGISTRATION_STATUSES,
  collectFormLocales,
  normalizeCollectForm,
  resolveCollectFormConfigOrgTokens,
  type RegistrationStatus,
} from "@/lib/collect-form-config";
import { resolveOrgProfile, type WorkspaceLegalProfile } from "@/lib/legal-templates";
import { CollectFormRuntime } from "@/components/form-builder/CollectFormRuntime";
import { PreviewSwitcher } from "./PreviewSwitcher";

// 운영자가 빌더에서 고치는 즉시 이 링크에 반영돼야 한다 — 캐시하면 "안 바뀌는데요" 가 된다.
export const dynamic = "force-dynamic";

/** 미리보기 링크가 검색 결과에 뜨면 준비 중인 폼이 공개된 것과 같다. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Params = Promise<{ token: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** 쿼리는 배열로도 올 수 있다(?lang=a&lang=b) — 첫 값만 본다. */
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}


export default async function CollectFormPreviewPage({
  params, searchParams,
}: { params: Params; searchParams: Search }) {
  const { token } = await params;
  const sp = await searchParams;

  /**
   * 인증 없이 DB 를 때리는 경로다 — 토큰을 난사해도 매 요청이 쿼리 한 번이 된다.
   * 이 저장소는 커넥션 풀 고갈로 실제 장애를 겪었으므로(웨비나 /live-state), 공개 경로에
   * 새 구멍을 열 때는 한도부터 건다. 정상 사용(링크 열고 상태 몇 번 눌러 보기)에는 닿지 않는 값.
   */
  const h = await headers();
  const ip = getClientIp(new Request("https://x", { headers: h }));
  const { allowed } = await rateLimitAsync(`collect-preview:${ip}`, { limit: 60, windowMs: 60_000 });
  /**
   * 한도에 걸렸을 때 404 를 주면 안 된다 — 받은 사람은 "링크가 죽었다" 로 읽고 운영자에게
   * 새 링크를 요청하며, 재발급은 **이미 나간 다른 링크까지 끊는다.** 사실대로 적는다.
   */
  if (!allowed) {
    return (
      <div className="grid min-h-dvh place-items-center bg-secondary/30 p-6">
        <div className="max-w-xs rounded-2xl bg-background p-6 text-center shadow-sm">
          <p className="text-sm font-semibold">잠시 후 다시 열어 주세요</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            짧은 시간에 너무 많이 열었어요. 링크는 그대로 살아 있습니다.
          </p>
        </div>
      </div>
    );
  }

  // 토큰 하나로만 찾는다 — 워크스페이스·레코드는 읽지 않는다(미리보기가 볼 이유가 없다).
  const source = token
    ? await prisma.collectSource.findUnique({
        where: { previewToken: token },
        select: {
          id: true, name: true, mode: true, formConfig: true, deletedAt: true,
          workspace: { select: { legalProfile: true } },
        },
      })
    : null;

  /**
   * 연동형에는 그릴 폼이 없고, **삭제된 소스는 미리보기도 함께 끊긴다**(§17 "소스 삭제 → 404").
   * 셋 다 없는 것과 같이 다룬다 — 존재 여부를 알려 줄 이유가 없다. 이 검사가 빠지면
   * 임베드(/f/{id})와 등록 확인 미리보기는 404 인데 이 화면만 살아 있어, 링크를 받은
   * 검토자가 "폼은 되는데 확인만 죽었다" 로 잘못 읽는다.
   */
  if (!source || source.mode !== "builder" || source.deletedAt) notFound();

  const normalizedConfig = normalizeCollectForm(source.formConfig);
  const org = resolveOrgProfile(source.workspace.legalProfile as WorkspaceLegalProfile | null, normalizedConfig.legal.country);
  const config = resolveCollectFormConfigOrgTokens(normalizedConfig, org);

  const statusParam = one(sp.status);
  const langParam = one(sp.lang);
  /**
   * `?type=buyer` — 특정 유형 문항이 펼쳐진 상태로 연다(설계 §16.1).
   * 분기 선택지에 실제로 있는 값만 받는다. 아무 문자열이나 받으면 분기가 안 맞아
   * "유형을 지정했는데 아무것도 안 펼쳐진다" 가 되고, 그게 설정 오류처럼 보인다.
   */
  const typeParam = one(sp.type);

  const forceStatus = REGISTRATION_STATUSES.includes(statusParam as RegistrationStatus)
    ? (statusParam as RegistrationStatus)
    : undefined;
  const lang = langParam || config.defaultLocale;

  const branchValues = config.branch.enabled ? config.branch.groups.map((g) => g.value) : [];
  const forceType = branchValues.includes(typeParam) ? typeParam : undefined;

  // 실제로 번역이 들어 있는 로케일만 고를 수 있게 — 빈 언어를 고르면 폴백 때문에
  // 아무것도 안 바뀐 것처럼 보인다. 판정은 임베드 런타임이 쓰는 것과 **같은 함수**다
  // (여기서만 따로 세면 미리보기에 뜨는 언어와 실제로 나가는 언어가 갈린다).
  const locales = collectFormLocales(config);

  return (
    <div className="min-h-dvh bg-secondary/30">
      <header className="border-b border-black/5 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5">
          <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold text-violet-600">미리보기</span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{source.name}</span>
        </div>
        <PreviewSwitcher status={forceStatus} type={forceType} types={branchValues} lang={lang} locales={locales} />
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        <div className="rounded-2xl bg-background p-5 shadow-sm">
          <CollectFormRuntime
            config={config}
            sourceId={source.id}
            locale={lang}
            forceStatus={forceStatus}
            forceType={forceType}
            serverNow={new Date().toISOString()}
          />
        </div>
        <p className="mt-3 px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          실제 등록 화면과 같은 폼입니다. 여기서 제출해도 저장되지 않아요.
        </p>
      </main>
    </div>
  );
}
