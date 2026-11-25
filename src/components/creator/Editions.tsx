"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-layout";
import { button, primary, panel, input, dateTime, Empty, Field, Text } from "./ui";

export type Edition = {
  id: string; name: string; createdAt: string;
  applicationSourceId: string | null; registrationSourceId: string | null;
  participants: number;
  _count: { candidates: number; missions: number };
};

/**
 * 한 전시의 **회차 목록**. 전시는 매년 열리니 회차가 쌓인다 — 등록 메뉴가 폼 목록을 보여 주는 자리와 같다.
 * 여기서 고른 회차의 id 가 `/creators/[id]` 의 자원이다(프로젝트가 아니라 회차).
 */
export function Editions({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [editions, setEditions] = useState<Edition[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/creators?projectId=" + encodeURIComponent(projectId), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "불러오지 못했어요.");
      setEditions(result.programs);
    } catch (error) {
      setError(error instanceof Error ? error.message : "불러오지 못했어요.");
    }
  }, [projectId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/creators", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name, copyFrom: copyFrom || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "만들지 못했어요.");
      toast.success(result.copiedMissions ? `'${result.name}' 회차를 만들었어요. 미션 ${result.copiedMissions}개를 가져왔어요.` : `'${result.name}' 회차를 만들었어요.`);
      router.push("/creators/" + result.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "만들지 못했어요.");
    } finally { setBusy(false); }
  }

  const year = new Date().getFullYear();

  return <div className="mx-auto grid w-full min-w-0 max-w-5xl gap-5 p-4 sm:p-8">
    <PageHeader
      title="크리에이터 관리"
      context={projectName}
      description="전시 회차마다 모집·선발·미션 운영을 따로 관리해요."
    />
    {error && <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

    <section className={panel + " grid gap-3"}>
      <div>
        <h2 className="font-semibold">새 회차</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          지난 회차를 고르면 <strong className="font-medium text-foreground">표 열 구성·UTM 규칙·미션</strong>을 그대로 가져와요.
          후보와 선발자는 새 회차에서 새로 쌓이고, 모집·등록 폼은 올해 폼으로 다시 고릅니다.
        </p>
      </div>
      <form className="grid items-end gap-2 sm:grid-cols-[1fr_minmax(0,14rem)_auto]" onSubmit={create}>
        <Field label="회차 이름">
          <Text required maxLength={160} value={name} placeholder={`${projectName} ${year + 1}`}
            onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="가져올 회차">
          <select className={input} value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
            <option value="">가져오지 않음</option>
            {(editions ?? []).map((edition) => <option key={edition.id} value={edition.id}>{edition.name}</option>)}
          </select>
        </Field>
        <button className={primary} disabled={busy || !name.trim()}>{busy ? "만드는 중…" : "회차 만들기"}</button>
      </form>
    </section>

    {editions === null ? <Empty>회차를 불러오는 중이에요.</Empty>
      : editions.length === 0 ? <Empty>아직 회차가 없어요. 위에서 첫 회차를 만들어 주세요.</Empty>
        : <ul className="grid gap-3">
          {editions.map((edition) => <li key={edition.id}>
            <EditionCard edition={edition} onChanged={load} />
          </li>)}
        </ul>}
  </div>;
}

function EditionCard({ edition, onChanged }: { edition: Edition; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/creators/" + edition.id, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "지우지 못했어요.");
      toast.success(`'${edition.name}' 회차를 목록에서 내렸어요.`);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "지우지 못했어요.");
    } finally { setBusy(false); setConfirming(false); }
  }

  return <article className={panel + " grid gap-3"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="break-words text-lg font-semibold">{edition.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          후보 {edition._count.candidates.toLocaleString()} · 선발 {edition.participants.toLocaleString()} · 미션 {edition._count.missions}
          {" · "}{dateTime(edition.createdAt)} 시작
        </p>
        {!edition.applicationSourceId && <p className="mt-1 text-xs text-muted-foreground">모집 폼이 아직 연결되지 않았어요.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={"/creators/" + edition.id} className={primary}>열기<span className="sr-only"> {edition.name}</span></Link>
        {confirming
          ? <>
            <button className={button + " text-destructive"} disabled={busy} onClick={remove}>{busy ? "내리는 중…" : "정말 내리기"}</button>
            <button className={button} disabled={busy} onClick={() => setConfirming(false)}>취소</button>
          </>
          : <button className={button + " text-muted-foreground"} onClick={() => setConfirming(true)}>회차 내리기</button>}
      </div>
    </div>
    {confirming && <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      목록에서만 감춰요. 후보·선발자·제출 이력은 지워지지 않고, 발급된 홍보 링크도 그대로 둡니다.
    </p>}
  </article>;
}
