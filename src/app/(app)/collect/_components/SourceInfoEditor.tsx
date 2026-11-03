"use client";

/**
 * 등록 폼 기본 정보(이름·설명·사이트 주소) 고치기 — 목록의 연필, 상세 머리의 "정보 수정"이 같이 쓴다(2026-11-03).
 *
 * 왜: 만들 때 적은 설명·사이트 주소를 그 뒤로 고칠 곳이 없었다(목록 연필은 이름만 바꿨다).
 * 설명은 "어떤 자료인지" 메모로 길게 쓰므로 줄바꿈을 그대로 저장하고, 화면도 줄바꿈을 살려 보여 준다.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { UrlField } from "@/components/ui/primitives";

export interface SourceInfo {
  id: string;
  name: string;
  description: string | null;
  siteUrl: string | null;
}

const isHttpUrl = (v: string) => { try { const u = new URL(v.trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };

export function SourceInfoEditor({ source, onSaved, onCancel }: {
  source: SourceInfo;
  onSaved: (next: SourceInfo) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(source.name);
  const [description, setDescription] = useState(source.description ?? "");
  const [siteUrl, setSiteUrl] = useState(source.siteUrl ?? "");
  const [saving, setSaving] = useState(false);
  const urlInvalid = siteUrl.trim() !== "" && !isHttpUrl(siteUrl);
  const nameEmpty = !name.trim();

  const save = async () => {
    if (nameEmpty || urlInvalid || saving) return;
    const next = { name: name.trim(), description: description.trim() || null, siteUrl: siteUrl.trim() || null };
    if (next.name === source.name && next.description === source.description && next.siteUrl === source.siteUrl) { onCancel(); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/collect-sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next.name, description: next.description ?? "", siteUrl: next.siteUrl ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data?.error ?? "저장하지 못했어요"); return; }
      onSaved({ ...source, ...next });
      toast.success("저장했어요");
    } catch {
      toast.error("연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-violet-400 focus:outline-none";
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => { e.preventDefault(); void save(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
      onClick={(e) => e.stopPropagation()}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">이름</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-invalid={nameEmpty || undefined} className={fieldCls} />
        {nameEmpty && <p className="mt-1 text-[11px] text-red-500">이름을 적어 주세요</p>}
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">설명</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="어떤 자료인지, 기준일·건수·주의할 점 등"
          className={`${fieldCls} resize-y leading-relaxed`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }}
        />
      </label>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted-foreground">사이트 주소</span>
        <UrlField label="사이트 주소" value={siteUrl} onChange={setSiteUrl} placeholder="https://… (폼이 있는 페이지, 선택)" isValidHttpUrl={isHttpUrl} invalidMessage="https:// 로 시작하는 주소를 넣어주세요." />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">취소</button>
        <button
          type="submit"
          disabled={nameEmpty || urlInvalid || saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}저장
        </button>
      </div>
    </form>
  );
}
