"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CreatorPortalView } from "@/lib/creator/types";
import { webUrl, type HistoryEntry } from "@/lib/creator/model";
import { button, primary, Field, Text, input, Empty, dateTime, statusNames, feeNames } from "./ui";

const card = "min-w-0 rounded-2xl bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-7";
const keyButton = primary + " bg-[var(--key)] text-[var(--on-key)] hover:bg-[var(--key)] hover:shadow-md";

export function History({ history, proofBase, uploads }: { history: unknown; proofBase: string; uploads: { id: string; name: string }[] }) {
  if (!Array.isArray(history) || !history.length) return null;
  return <ol className="space-y-2">
    {[...history as HistoryEntry[]].reverse().map((entry, index) => (
      <li key={index} className="min-w-0 rounded-xl bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong>{entry.stage === "draft" ? "초안" : "최종"} · {entry.kind === "approved" ? "승인" : entry.kind === "revision" ? "수정 요청" : "제출"}</strong>
          <time className="text-xs text-muted-foreground" dateTime={entry.at}>{dateTime(entry.at)}</time>
        </div>
        {entry.kind === "submission" ? (
          <div className="mt-2 grid gap-1">
            <span>{entry.platform}</span>
            {entry.links.map((link) => <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{link}</a>)}
            {entry.files.map((file) => <a key={file} href={proofBase + file} className="break-all underline underline-offset-2">{uploads.find(({ id }) => id === file)?.name || "증빙 다운로드"}</a>)}
            {entry.note && <p className="whitespace-pre-wrap break-words">{entry.note}</p>}
          </div>
        ) : entry.feedback && <p className="mt-2 whitespace-pre-wrap break-words">{entry.feedback}</p>}
      </li>
    ))}
  </ol>;
}

async function portalAction(base: string, action: Record<string, unknown>) {
  const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "저장하지 못했어요.");
  return result;
}

function MissionForm({ assignment, api }: { assignment: CreatorPortalView["assignments"][number]; api: string }) {
  const router = useRouter();
  const [linkValues, setLinks] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { mission } = assignment;
  const draft = assignment.stage === "draft";
  const count = draft ? 1 : mission.linkCount;
  const canAttach = draft || mission.proof !== "off";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const links = linkValues.map((link) => link.trim()).filter(Boolean);
    const validation: Record<string, string> = {};
    if (links.some((link) => !webUrl.safeParse(link).success)) validation.links = "http 또는 https 주소를 입력해 주세요.";
    if (!draft && new Set(links).size < count) validation.links = "서로 다른 링크 " + count + "개를 입력해 주세요.";
    if (draft && !links.length && !files.length) validation.files = "초안 링크나 파일을 추가해 주세요.";
    if (!draft && mission.proof === "required" && !files.length) validation.files = "증빙 파일을 첨부해 주세요.";
    if (files.length > 5 || files.some((file) => file.size > 50 * 1024 * 1024 || !file.size)) validation.files = "파일은 각 50MB 이하, 최대 5개까지 올릴 수 있어요.";
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setBusy(true);
    try {
      const storage = createClient().storage.from("creator-proof");
      const uploads = await Promise.all(files.map(async (file) => {
        const signed = await portalAction(api, { action: "upload", assignmentId: assignment.id, name: file.name, type: file.type, size: file.size });
        const result = await storage.uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
        if (result.error) throw new Error("파일을 올리지 못했어요. 잠시 후 다시 시도해 주세요.");
        return signed.id;
      }));
      await portalAction(api, { action: "submit", assignmentId: assignment.id, submission: {
        version: assignment.version, platform: fields.get("platform"), links, files: uploads, note: fields.get("note"),
      } });
      router.refresh();
    } catch (error) {
      setErrors({ submit: error instanceof Error ? error.message : "저장하지 못했어요." });
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="grid gap-3">
    <Field label="게시 채널"><select name="platform" required className={input}>{mission.platforms.map((platform) => <option key={platform}>{platform}</option>)}</select></Field>
    {Array.from({ length: count }, (_, index) => (
      <Field key={index} label={(draft ? "초안 링크" : "게시 링크") + (count > 1 ? " " + (index + 1) : "")}>
        <Text type="url" value={linkValues[index] ?? ""} onChange={(event) => {
          const next = [...linkValues];
          next[index] = event.target.value;
          setLinks(next);
        }} placeholder="https://" />
        {index === count - 1 && errors.links && <span role="alert" className="text-destructive">{errors.links}</span>}
      </Field>
    ))}
    {canAttach && <Field label={draft ? "초안 파일 · 최대 5개, 각 50MB" : (mission.proof === "required" ? "증빙 파일 필수" : "증빙 파일") + " · 최대 5개, 각 50MB"}>
      <Text type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf"
        onChange={(event) => setFiles([...(event.target.files ?? [])])} />
      {errors.files && <span role="alert" className="text-destructive">{errors.files}</span>}
    </Field>}
    <Field label="메모"><textarea className={input} name="note" rows={2} maxLength={10000} /></Field>
    {errors.submit && <p role="alert" className="text-sm text-destructive">{errors.submit}</p>}
    <button className={keyButton + " justify-self-start"} disabled={busy}>{busy ? "저장 중…" : draft ? "초안 제출" : "최종 제출"}</button>
  </form>;
}

export function CreatorPortal({ token, data, origin, preview }: { token: string; data: CreatorPortalView; origin: string; preview: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const api = "/api/public/creator/" + token;
  const completed = data.assignments.filter(({ status }) => status === "done").length;
  const activeRegistrations = data.program.registrationSource?.isActive && !data.program.registrationSource.deletedAt;
  const links = data.links.filter(({ platform }) => Boolean((data.channels as Record<string, string>)[platform]));

  async function confirm() {
    setBusy(true);
    try { await portalAction(api, { action: "confirm" }); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "저장하지 못했어요."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto grid max-w-3xl gap-5">
    <header className={card}>
      <p className="text-sm font-medium text-[var(--muted)]">{data.program.name}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.name}님의 활동</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">미션 완료 {completed}/{data.assignments.length} · 활동비 {feeNames[data.feeStatus]}{data.paidOn && " · " + data.paidOn}</p>
      {!data.confirmed && !preview && <button className={keyButton + " mt-4"} disabled={busy} onClick={() => void confirm()}>{busy ? "저장 중…" : "참여 확정하기"}</button>}
      {message && <p aria-live="polite" className="mt-3 break-words text-sm">{message}</p>}
    </header>
    {activeRegistrations && links.length > 0 && <section className={card}>
      <h2 className="mb-3 text-lg font-semibold">내 등록 홍보 링크</h2>
      <ul className="grid gap-3">{links.map((link) => {
        const url = origin + "/creator-go/" + link.code;
        return <li key={link.code} className="grid min-w-0 gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <span className="text-sm font-semibold">{link.platform}</span>
          <span className="break-all text-sm">{url}</span>
          {!preview && origin && <button type="button" className={button} onClick={() => void navigator.clipboard.writeText(url).then(() => setMessage("홍보 링크를 복사했어요.")).catch(() => setMessage("주소를 직접 복사해 주세요."))}>복사</button>}
        </li>;
      })}</ul>
    </section>}
    {data.assignments.map((assignment) => {
      const { mission } = assignment;
      const waitingForStart = assignment.stage === "final" && mission.startsAt && new Date(mission.startsAt).getTime() > data.serverNow;
      return <section key={assignment.id} className={card + " grid gap-4"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="break-words text-lg font-semibold">{mission.title}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{mission.startsAt ? dateTime(mission.startsAt) + "부터 · " : ""}마감 {dateTime(mission.dueAt)} (KST)</p></div>
          <span className="rounded-full bg-[var(--key-dim)] px-3 py-1 text-xs font-semibold">{assignment.stage === "draft" ? "초안" : "최종"} · {statusNames[assignment.status]}</span>
        </div>
        {mission.guide && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{mission.guide}</p>}
        <History history={assignment.history} proofBase={api + "/proof/"} uploads={assignment.uploads} />
        {data.confirmed && !preview && ["todo", "revision"].includes(assignment.status) && (
          waitingForStart ? <Empty>게시 기간이 시작되면 최종 제출할 수 있어요.</Empty> : <MissionForm key={assignment.stage + assignment.version} assignment={assignment} api={api} />
        )}
      </section>;
    })}
    {!data.assignments.length && <Empty>배정된 미션이 생기면 여기에 표시돼요.</Empty>}
  </div>;
}
