"use client";

/**
 * 빌더형 수집 소스의 폼 편집 화면 — 왼쪽 편집, 오른쪽 미리보기(설계 §16).
 *
 * 편집 영역이므로 **값은 항상 보이고 그 자리에서 고쳐진다**(AGENTS.md §2). 접기·모달 뒤로
 * 넣지 않는다. 자동저장 + 인접 실시간 미리보기가 같은 절의 요구다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EditableList, withRowKeys, ROW_KEY } from "@/components/ui/editable-list";
import { useAutosave, useExternalSync } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { btnCls, R, FINISH } from "@/components/ui/primitives";
import { CollectFieldCard, keyFromLabel } from "@/components/form-builder/CollectFieldCard";
import {
  CollectBranchEditor,
  branchOptionValues,
  reconcileBranchGroups,
} from "@/components/form-builder/CollectBranchEditor";
import { CollectFormRuntime } from "@/components/form-builder/CollectFormRuntime";
import { CollectFormSections } from "@/components/form-builder/CollectFormSections";
import {
  DEFAULT_LOCALE,
  normalizeCollectForm,
  toLocalized,
  type CollectField,
  type CollectFormConfig,
  type RegistrationStatus,
} from "@/lib/collect-form-config";
import { getPublicAppOrigin } from "@/lib/app-url";

const PREVIEW_STATES: Array<{ id: RegistrationStatus | "auto"; label: string }> = [
  { id: "auto", label: "지금 상태" },
  { id: "before", label: "접수 전" },
  { id: "open", label: "접수 중" },
  { id: "closed", label: "마감" },
];

export default function FormBuilderTab({
  sourceId,
  initialConfig,
  previewToken,
  workspaceId,
  onSaved,
}: {
  sourceId: string;
  initialConfig: unknown;
  /** /p/{token} 미리보기 링크. 빌더형이면 항상 있지만, 예전 소스는 null 일 수 있다. */
  previewToken: string | null;
  /** 법률 문구 생성기가 워크스페이스 조직 정보를 읽어올 때만 쓴다 — 없으면 그 패널만 비활성. */
  workspaceId?: string;
  /**
   * 저장 성공한 설정을 상위(페이지의 source 상태)에 알린다.
   *
   * 이게 없으면 탭을 오갈 때마다 이 컴포넌트가 **페이지를 처음 열 때 받은 낡은 formConfig** 로 다시
   * 그려진다 — 운영자에게는 "자동저장이 안 됐다" 로 보이고, 그 화면에서 하나라도 고치면 낡은 설정 +
   * 그 수정이 저장돼 **앞서 저장한 변경이 지워진다**(2026-10-02 현장). InfoTab 이 같은 이유로 이미 한다.
   */
  onSaved?: (config: CollectFormConfig) => void;
}) {
  // 저장된 값은 어떤 모양이든 올 수 있다 — 화면은 정규화된 것만 본다.
  const [config, setConfig] = useState<CollectFormConfig>(() => normalizeCollectForm(initialConfig));
  const [previewState, setPreviewState] = useState<RegistrationStatus | "auto">("auto");

  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const save = useCallback(async (next: CollectFormConfig) => {
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formConfig: next }),
      });
      if (res.ok) {
        onSavedRef.current?.(next);
        // Email 칸을 이메일 유형으로 고친 직후: 그 전에 들어온 등록 중 이미 같은 이메일이 두 번 들어온 건이 있으면 알린다
        const data = (await res.json().catch(() => null)) as { emailBackfill?: { filled: number; duplicates: number } } | null;
        if (data?.emailBackfill?.duplicates) {
          toast.warning(`같은 이메일로 이미 중복 등록된 건이 ${data.emailBackfill.duplicates}건 있어요. 수집 데이터에서 확인해 정리해 주세요.`);
        }
      }
      return res.ok;
    } catch { return false; }
  }, [sourceId]);

  const { state: saveState, retry, dirty } = useAutosave(config, save);

  // 탭을 떠나며 보낸 저장이 돌아오기 전에 다시 이 탭을 열면, 처음엔 그 직전 값으로 그려진다.
  // 저장이 끝나 상위 값이 바뀌면 따라간다 — 단, 편집 중이면 덮지 않는다(useExternalSync 규칙).
  const incoming = useMemo(() => normalizeCollectForm(initialConfig), [initialConfig]);
  useExternalSync(incoming, setConfig, dirty);
  // 표시는 껍데기 한 곳에서 그린다(화면당 1개) — 저장 경로는 각자.
  useReportAutosave(saveState, retry);

  const patch = (next: Partial<CollectFormConfig>) => setConfig((c) => ({ ...c, ...next }));
  const setFields = (updater: CollectField[] | ((prev: CollectField[]) => CollectField[])) =>
    setConfig((c) => {
      const fields = typeof updater === "function" ? updater(c.fields) : updater;
      if (!c.branch.enabled) return { ...c, fields };

      const before = c.fields.find((field) => field.key === c.branch.fieldKey);
      const after = fields.find((field) => field.id === before?.id || field.key === c.branch.fieldKey);
      if (!before || !after) return { ...c, fields };
      const previousValues = branchOptionValues(before);
      const nextValues = branchOptionValues(after);
      return {
        ...c,
        fields,
        branch: {
          ...c.branch,
          fieldKey: after.key,
          groups: reconcileBranchGroups(c.branch, previousValues, nextValues),
        },
      };
    });

  const rows = useMemo(() => withRowKeys(config.fields), [config.fields]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">등록 항목</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">끌어서 순서를 바꿀 수 있어요. 저장 키는 한 번 정하면 바꾸지 마세요 — 이미 모인 데이터와 어긋납니다.</p>
          </div>
        </div>

        <EditableList<CollectField & { [ROW_KEY]?: string }>
          listId={`cfield:${sourceId}`}
          itemNoun="항목"
          items={rows}
          onChange={(next) => setFields(next)}
          rowKey={(f) => f.id}
          reorderable
          emptyState={
            <p className="rounded-xl bg-secondary/40 p-6 text-center text-xs text-muted-foreground">
              아직 항목이 없어요. 이름·이메일부터 추가해 보세요.
            </p>
          }
          renderAdd={({ add }) => (
            <button
              type="button"
              onClick={() => {
                const taken = new Set(config.fields.map((f) => f.key));
                const key = keyFromLabel("", taken);
                add({ id: crypto.randomUUID(), key, label: toLocalized(""), type: "text", placeholder: {}, required: false, enabled: true, options: [] });
              }}
              className={`${btnCls("ghost")} w-full justify-center`}
            >
              <Plus className="h-3.5 w-3.5" />항목 추가
            </button>
          )}
          autoFocusNewRow
          renderRow={({ item, handle, removeButton }) => {
            const isBranchKey = config.branch.enabled && config.branch.fieldKey === item.key;
            return (
              <div className="space-y-2">
                <CollectFieldCard
                  field={item}
                  setFields={setFields}
                  handle={handle}
                  removeButton={removeButton}
                  isBranchKey={isBranchKey}
                  onMakeBranch={item.type === "select" || item.type === "radio"
                    ? (on) => patch({
                        branch: on
                          ? {
                              enabled: true,
                              fieldKey: item.key,
                              groups: reconcileBranchGroups(
                                {
                                  enabled: true,
                                  fieldKey: item.key,
                                  groups: config.branch.fieldKey === item.key ? config.branch.groups : [],
                                },
                                config.branch.fieldKey === item.key ? branchOptionValues(item) : [],
                                branchOptionValues(item),
                              ),
                            }
                          : { ...config.branch, enabled: false },
                      })
                    : null}
                  // 자기 자신은 빼고 본다 — 안 그러면 모든 항목이 "중복" 이라고 나온다.
                  takenKeys={new Set(config.fields.filter((f) => f.id !== item.id).map((f) => f.key))}
                />
                {isBranchKey && (
                  <CollectBranchEditor
                    trigger={item}
                    branch={config.branch}
                    allFields={config.fields}
                    onChange={(branch) => patch({ branch })}
                  />
                )}
              </div>
            );
          }}
        />

        {/* 항목 아래에 나머지 설정 — 순서가 곧 폼이 그려지는 순서다(개요 → 항목 → 안내 → 동의). */}
        <CollectFormSections config={config} patch={patch} workspaceId={workspaceId} />
      </div>

      {/* 미리보기는 임베드와 같은 모델·가시성 규칙을 읽는다 — 각자 그리면 반드시 갈라진다. */}
      <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center gap-1">
          {PREVIEW_STATES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPreviewState(s.id)}
              className={`rounded-lg px-2 py-1 text-[11px] transition-shadow ${previewState === s.id ? `bg-violet-500/12 ${FINISH.s2Key}` : "hover:bg-secondary"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className={`${R.surface} bg-background p-4 ${FINISH.s2}`}>
          <CollectFormRuntime
            config={config}
            sourceId={sourceId}
            forceStatus={previewState === "auto" ? undefined : previewState}
          />
        </div>
        <p className="px-1 text-[11px] leading-snug text-muted-foreground/70">
          마감 화면은 마감 당일에 처음 보면 늦어요 — 상태를 바꿔 미리 확인하세요.
        </p>

        <PreviewLinkRow sourceId={sourceId} initialToken={previewToken} />
        <EmbedSnippetRow sourceId={sourceId} lookupEnabled={config.lookup.enabled} />
      </aside>
    </div>
  );
}

/**
 * 미리보기 링크 — 로그인 없이 열리는 /p/{token}.
 *
 * 옆칸 미리보기가 있는데도 링크가 필요한 이유: 확인해 줄 사람(전시 주최·법무·번역 담당)이
 * 워크스페이스 멤버가 아니다. 그래서 **끊을 수단**이 같은 자리에 붙어 있어야 한다 — 링크는
 * 메신저로 흘러가면 회수가 안 되고, 재발급만이 유일한 회수 방법이다.
 */
function PreviewLinkRow({ sourceId, initialToken }: { sourceId: string; initialToken: string | null }) {
  const confirm = useConfirm();
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // 공개 링크는 현재 preview/localhost host가 아니라 설정된 서비스 주소로 고정한다.
  const origin = getPublicAppOrigin();
  const url = token && origin ? `${origin}/p/${token}` : "";

  const regenerate = async () => {
    const ok = await confirm({
      title: "미리보기 링크를 새로 발급할까요?",
      description: "지금 링크는 즉시 열리지 않게 됩니다. 이미 보낸 사람에게는 새 링크를 다시 보내야 해요.",
      confirmLabel: "새로 발급",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/regenerate-preview-token`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "재발급하지 못했어요"); return; }
      setToken(data.previewToken);
      toast.success("새 미리보기 링크를 발급했어요");
    } catch {
      toast.error("재발급하지 못했어요");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className={`${R.surface} bg-secondary/40 p-3 ${FINISH.s2}`}>
        <p className="text-[11px] leading-snug text-muted-foreground">
          이 소스에는 아직 미리보기 링크가 없어요.
        </p>
        <button type="button" onClick={regenerate} disabled={busy} className={`${btnCls("ghost")} mt-2 w-full justify-center`}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />링크 발급
        </button>
      </div>
    );
  }

  return (
    <div className={`${R.surface} bg-secondary/40 p-3 ${FINISH.s2}`}>
      <p className="text-[11px] font-semibold">미리보기 링크</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        로그인 없이 열려요. 링크를 받은 사람도 상태·언어를 바꿔 볼 수 있고, 제출해도 저장되지 않습니다.
      </p>
      {origin ? (
        <p className="mt-2 break-all rounded-lg bg-background px-2 py-1.5 font-mono text-[10px] leading-relaxed shadow-sm">{url}</p>
      ) : (
        <p role="alert" className="mt-2 rounded-lg bg-secondary/60 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          공개 배포 주소가 설정되지 않아 링크를 복사할 수 없어요. NEXT_PUBLIC_CANONICAL_APP_URL을 설정하세요.
        </p>
      )}
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          disabled={!url}
          className={`${btnCls("ghost")} flex-1 justify-center`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "복사됨" : "링크 복사"}
        </button>
        {/* 현재 앱에서 여는 상대 미리보기는 canonical 복사 주소와 별개로 계속 쓸 수 있다. */}
        <a href={`/p/${token}`} target="_blank" rel="noopener noreferrer" className={`${btnCls("ghost")} justify-center`}>
          <ExternalLink className="h-3.5 w-3.5" />열기
        </a>
        {/* 등록 확인은 별도 화면이라 별도 링크다 — 같은 토큰을 쓴다(§16.1). */}
        <a href={`/p/${token}/check`} target="_blank" rel="noopener noreferrer"
           title="등록 확인 미리보기" aria-label="등록 확인 미리보기 열기"
           className={`${btnCls("ghost")} justify-center`}>
          <Search className="h-3.5 w-3.5" />
        </a>
        <button type="button" onClick={regenerate} disabled={busy} title="새로 발급" aria-label="미리보기 링크 새로 발급" className={`${btnCls("ghost")} justify-center`}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}

/**
 * 아임웹에 붙일 스니펫 (설계 §17).
 *
 * 여기 두는 이유: 폼을 다 만든 사람의 **다음 행동이 "이걸 어디에 붙이지"** 다. 배포 탭까지
 * 찾아가게 하면 그 사이에 한 번 이탈하고, 아임웹 편집기에서 손으로 옮겨 적다 오타가 난다.
 */
function EmbedSnippetRow({ sourceId, lookupEnabled }: { sourceId: string; lookupEnabled: boolean }) {
  const [copied, setCopied] = useState<"form" | "check" | null>(null);
  const origin = getPublicAppOrigin();

  if (!origin) {
    return (
      <div role="alert" className={`${R.surface} bg-secondary/40 p-3 text-[11px] leading-snug text-muted-foreground ${FINISH.s2}`}>
        공개 배포 주소가 설정되지 않아 설치 코드를 복사할 수 없어요. NEXT_PUBLIC_CANONICAL_APP_URL을 설정하세요.
      </div>
    );
  }

  const formSnippet = `<script async src="${origin}/f/${sourceId}"></script>\n<div data-mach-form></div>`;
  const checkSnippet = `<script async src="${origin}/f/${sourceId}/check"></script>\n<div data-mach-form-check></div>`;

  const copy = (which: "form" | "check", text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const block = (which: "form" | "check", title: string, desc: string, snippet: string) => (
    <div>
      <p className="text-[11px] font-semibold">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre rounded-lg bg-background px-2 py-1.5 font-mono text-[10px] leading-relaxed shadow-sm">{snippet}</pre>
      <button type="button" onClick={() => copy(which, snippet)} className={`${btnCls("ghost")} mt-1.5 w-full justify-center`}>
        {copied === which ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === which ? "복사됨" : "코드 복사"}
      </button>
    </div>
  );

  return (
    <div className={`${R.surface} space-y-3 bg-secondary/40 p-3 ${FINISH.s2}`}>
      {block("form", "등록 폼 붙이기", "아임웹 코드블럭에 그대로 넣으세요. 마운트 <div> 를 빠뜨려도 스크립트 자리에 그려집니다.", formSnippet)}
      {/* 등록 확인은 켠 경우에만 보여 준다 — 꺼진 기능의 코드를 주면 붙여 놓고 안 나온다고 묻는다. */}
      {lookupEnabled
        ? block("check", "등록 확인 붙이기", "Registration Check 탭 등 별도 코드블럭에 넣으세요.", checkSnippet)
        : (
          <p className="text-[11px] leading-snug text-muted-foreground">
            등록 확인은 꺼져 있어요 — 아래 <b className="font-semibold text-foreground/80">등록 확인</b> 에서 켜면
            붙일 코드가 여기에 나타납니다.
          </p>
        )}
    </div>
  );
}

export { DEFAULT_LOCALE };
