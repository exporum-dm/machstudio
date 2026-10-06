"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Code2, Copy, ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FINISH, R } from "@/components/ui/primitives";
import { InlineError } from "@/components/ui/inline-error";
import { getPublicAppOrigin } from "@/lib/app-url";
import { DEFAULT_COMPETITION_THEME } from "@/lib/competition-config";
import {
  detailPageNoticeCompetition,
  normalizeDetailPageSettings,
  type DetailPageSettings,
} from "@/lib/detail-page/config";
import { NoticeEditor, type NoticeEditorHost } from "@/app/(app)/competition/[slug]/NoticePageTab";

interface DetailPageDto {
  id: string;
  name: string;
  config: Record<string, unknown>;
  theme: Record<string, string>;
}

const TABS = [
  { id: "edit", label: "페이지 편집", icon: FileText },
  { id: "install", label: "설치 코드", icon: Code2 },
] as const;
type TabId = (typeof TABS)[number]["id"];

const spring = { type: "spring" as const, stiffness: 420, damping: 34 };

export default function DetailPageEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [page, setPage] = useState<DetailPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabId>("edit");

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/detail-pages/${encodeURIComponent(id)}`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setPage(data.page);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void Promise.resolve().then(fetchPage); }, [fetchPage]);

  const patch = useCallback(async (body: Record<string, unknown>, successMessage?: string) => {
    const res = await fetch(`/api/detail-pages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error ?? "저장하지 못했어요"); return false; }
    setPage((prev) => (prev ? { ...prev, ...data.page } : prev));
    if (successMessage) toast.success(successMessage);
    return true;
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !page) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <InlineError message="상세페이지를 불러오지 못했어요" onRetry={fetchPage} />
      </div>
    );
  }

  const enabled = (page.config.noticePage as { enabled?: unknown } | undefined)?.enabled === true;

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="min-w-0">
        <Link
          href="/detail-page"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          상세페이지 목록
        </Link>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <PageNameField name={page.name} onSave={(name) => patch({ name }, "이름을 바꿨어요")} />
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-secondary text-muted-foreground"
            }`}
          >
            {enabled ? "공개" : "비공개"}
          </span>
        </div>
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-background">
        {TABS.map(({ id: tabId, label, icon: Icon }) => {
          const active = tab === tabId;
          return (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                active ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {active && (
                <motion.span
                  layoutId="detail-page-tab"
                  transition={spring}
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-violet-500"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 편집 탭은 숨기기만 한다 — 설치 코드를 보러 갔다 와도 저장 안 한 편집이 날아가지 않게. */}
      <div hidden={tab !== "edit"}>
        <DetailPageEditor page={page} patch={patch} />
      </div>
      {tab === "install" && <InstallTab pageId={page.id} enabled={enabled} />}
    </div>
  );
}

/** 이름은 제목 자리에서 바로 고친다 — 바깥을 누르거나 Enter 면 저장. */
function PageNameField({ name, onSave }: { name: string; onSave: (name: string) => Promise<boolean> }) {
  const [value, setValue] = useState(name);
  const commit = async () => {
    const next = value.trim();
    if (!next) { setValue(name); return; }
    if (next === name) return;
    const ok = await onSave(next);
    if (!ok) setValue(name);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }}
      aria-label="페이지 이름"
      className="min-w-0 max-w-full flex-1 rounded-lg bg-transparent px-1 text-2xl font-semibold outline-none transition-colors hover:bg-secondary/60 focus:bg-secondary/60 sm:flex-none"
      size={Math.max(8, Math.min(40, value.length + 2))}
    />
  );
}

function DetailPageEditor({
  page,
  patch,
}: {
  page: DetailPageDto;
  patch: (body: Record<string, unknown>, successMessage?: string) => Promise<boolean>;
}) {
  // 편집기는 처음 연 값으로 상태를 잡는다. 저장 뒤 page 가 바뀌어도 편집 중인 값을 덮지 않게
  // host 의 config·theme 은 첫 렌더 값으로 고정한다(이름은 미리보기 폴백이라 따라가게 둔다).
  const [initial] = useState(() => ({
    config: page.config,
    theme: { accentColor: DEFAULT_COMPETITION_THEME.accentColor, ...page.theme },
    settings: normalizeDetailPageSettings(page.config),
  }));
  const { id, name } = page;

  const buildPreview = useCallback(
    (theme: Record<string, string>, settings: DetailPageSettings | null) =>
      detailPageNoticeCompetition({ id, name, theme, settings: settings ?? initial.settings }),
    [id, name, initial.settings],
  );

  const host: NoticeEditorHost = useMemo(
    () => ({
      kind: "page",
      config: initial.config,
      theme: initial.theme,
      uploadUrl: `/api/detail-pages/${id}/media`,
      rounds: null,
      status: null,
      fixedLanguageLabel: null,
      pageSettings: initial.settings,
      buildPreview,
      save: ({ config, theme }) => patch({ config, theme }, "상세페이지를 저장했어요"),
    }),
    [initial, id, buildPreview, patch],
  );

  return <NoticeEditor host={host} />;
}

function CopyRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              toast.success("복사했어요");
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("복사에 실패했어요 — 직접 선택해 복사해주세요");
            }
          }}
          className={`flex items-center gap-1 bg-secondary px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          복사
        </button>
      </div>
      <pre className={`mt-1.5 overflow-x-auto bg-secondary/40 p-3 text-[11px] leading-relaxed ${R.control}`}>
        <code>{value}</code>
      </pre>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function InstallTab({ pageId, enabled }: { pageId: string; enabled: boolean }) {
  const origin = getPublicAppOrigin();
  const snippet = origin ? `<script async src="${origin}/d/${pageId}"></script>\n<div data-mach-page="${pageId}"></div>` : null;
  const viewUrl = origin ? `${origin}/d/${pageId}/view` : null;

  return (
    <div className="max-w-3xl space-y-4">
      {!origin && (
        <p role="alert" className={`bg-secondary/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground ${R.control}`}>
          공개 배포 주소가 설정되지 않아 설치 코드를 복사할 수 없어요. NEXT_PUBLIC_CANONICAL_APP_URL을 설정하세요.
        </p>
      )}
      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">아임웹 설치 코드</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          아임웹 코드블럭에 이 두 줄을 넣으면 상세페이지가 그대로 나와요. 여기서 고치고 저장하면 최대 30초 안에 반영돼요.
        </p>
        {!enabled && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            지금은 <b>비공개</b>라 붙여 둔 곳에 “아직 공개되지 않은 페이지예요”만 보여요. 페이지 편집 탭에서 공개를 켜고 저장하세요.
          </p>
        )}
        {snippet && (
          <div className="mt-4">
            <CopyRow label="아임웹 코드블럭" value={snippet} hint="두 번째 줄(div)을 빠뜨려도 스크립트 자리에 자동으로 붙어요." />
          </div>
        )}
      </section>
      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">단독 보기 링크</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          붙이기 전에 실제 화면(휴대폰 포함)으로 확인하거나 팀원에게 공유할 때 쓰세요.
        </p>
        {viewUrl && (
          <div className="mt-4 space-y-3">
            <CopyRow label="링크" value={viewUrl} />
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 bg-violet-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 ${R.control}`}
            >
              <ExternalLink className="h-3 w-3" />새 탭에서 열기
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
