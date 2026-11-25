"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CreatorPortalView } from "@/lib/creator/types";
import { creatorDriveFile, webUrl, type HistoryEntry } from "@/lib/creator/model";
import { button, primary, Field, Text, input, Empty, dateTime, statusNames, feeNames } from "./ui";

const card = "min-w-0 rounded-2xl bg-[var(--card)] p-5 shadow-[var(--card-shadow)] sm:p-7";
const subscribeToHydration = () => () => {};
const keyButton = primary + " bg-[var(--key)] text-[var(--on-key)] hover:bg-[var(--key)] hover:shadow-md";

export function History({ history, proofBase, uploads }: { history: unknown; proofBase: string; uploads: { id: string; name: string }[] }) {
  if (!Array.isArray(history) || !history.length) return null;
  return <ol className="space-y-2">
    {[...history as HistoryEntry[]].reverse().map((entry, index) => (
      <li key={index} className="min-w-0 rounded-xl bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <strong>{entry.stage === "draft" ? "초안" : "최종"} · {entry.kind === "approved" ? "승인" : entry.kind === "revision" ? "수정 요청" : entry.kind === "withdrawn" ? "제출 취소" : "제출"}</strong>
          <time className="text-xs text-muted-foreground" dateTime={entry.at}>{dateTime(entry.at)}</time>
        </div>
        {entry.kind === "submission" ? (
          <div className="mt-2 grid gap-1">
            <span>{entry.platform}</span>
            {entry.links.map((link) => <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{link}</a>)}
            {entry.driveUrl && <a href={entry.driveUrl} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">Drive 원본 영상 보기</a>}
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

function MissionForm({ assignment, api, driveFolder, preview }: {
  assignment: CreatorPortalView["assignments"][number]; api: string; driveFolder: string | null; preview: boolean;
}) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const history = Array.isArray(assignment.history) ? assignment.history as HistoryEntry[] : [];
  const previous = history.findLast((entry) => entry.kind === "submission" && entry.stage === assignment.stage);
  const submission = previous?.kind === "submission" ? previous : undefined;
  const [linkValues, setLinks] = useState<string[]>(submission?.links ?? []);
  const [previewMessage, setPreviewMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { mission } = assignment;
  const draft = assignment.stage === "draft";
  const count = draft ? 1 : mission.linkCount;
  const canAttach = draft || mission.proof !== "off";
  const driveRequired = !draft && mission.driveProof === "required";
  const showDrive = mission.driveProof !== "off";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const links = linkValues.slice(0, count).map((link) => link.trim()).filter(Boolean);
    const driveUrl = String(fields.get("driveUrl") ?? "").trim();
    const validation: Record<string, string> = {};
    if (links.some((link) => !webUrl.safeParse(link).success)) validation.links = "http 또는 https 주소를 입력해 주세요.";
    if (!draft && new Set(links).size < count) validation.links = "서로 다른 링크 " + count + "개를 입력해 주세요.";
    if (driveUrl && !creatorDriveFile.safeParse(driveUrl).success) validation.drive = "Drive 폴더가 아닌 영상 파일 링크를 입력해 주세요.";
    if (driveRequired && !driveUrl) validation.drive = "Drive 원본 영상 링크를 입력해 주세요.";
    if (draft && !links.length && !files.length && !driveUrl) validation.files = "초안 링크나 파일을 추가해 주세요.";
    if (!draft && mission.proof === "required" && !files.length) validation.files = "증빙 파일을 첨부해 주세요.";
    if (files.length > 5 || files.some((file) => file.size > 50 * 1024 * 1024 || !file.size)) validation.files = "파일은 각 50MB 이하, 최대 5개까지 올릴 수 있어요.";
    setErrors(validation);
    if (Object.keys(validation).length) return;
    if (preview) { setPreviewMessage("테스트 제출을 확인했어요. 실제 제출 내역에는 기록되지 않아요."); return; }
    setBusy(true);
    try {
      const uploads = await Promise.all(files.map(async (file) => {
        const storage = createClient().storage.from("creator-proof");
        const signed = await portalAction(api, { action: "upload", assignmentId: assignment.id, name: file.name, type: file.type, size: file.size });
        const result = await storage.uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
        if (result.error) throw new Error("파일을 올리지 못했어요. 잠시 후 다시 시도해 주세요.");
        return signed.id;
      }));
      await portalAction(api, { action: "submit", assignmentId: assignment.id, submission: {
        version: assignment.version, platform: fields.get("platform"), links, driveUrl: driveUrl || undefined, files: uploads, note: fields.get("note"),
      } });
      router.refresh();
    } catch (error) {
      setErrors({ submit: error instanceof Error ? error.message : "저장하지 못했어요." });
    } finally { setBusy(false); }
  }

  return <form method="post" onSubmit={submit} className="grid gap-3">
    <Field label="게시 채널"><select name="platform" required className={input} defaultValue={submission?.platform}>{mission.platforms.map((platform) => <option key={platform}>{platform}</option>)}</select></Field>
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
    {showDrive && <Field label={driveRequired ? "Drive 원본 영상 파일 링크 (필수)" : "Drive 원본 영상 파일 링크"}>
      {driveFolder ? <a href={driveFolder} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline underline-offset-4">내 업로드 폴더 열기</a> :
        <span>운영자에게 내 업로드 폴더를 요청해 주세요.</span>}
      <Text name="driveUrl" type="url" placeholder="https://drive.google.com/file/d/…" defaultValue={submission?.driveUrl} disabled={!driveFolder && !preview} />
      {errors.drive && <span role="alert" className="text-destructive">{errors.drive}</span>}
    </Field>}
    {canAttach && <Field label={draft ? "초안 파일 · 최대 5개, 각 50MB" : (mission.proof === "required" ? "증빙 파일 필수" : "증빙 파일") + " · 최대 5개, 각 50MB"}>
      <Text type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf"
        onChange={(event) => setFiles([...(event.target.files ?? [])])} />
      {errors.files && <span role="alert" className="text-destructive">{errors.files}</span>}
    </Field>}
    <Field label="메모"><textarea className={input} name="note" rows={2} maxLength={10000} defaultValue={submission?.note} /></Field>
    {errors.submit && <p role="alert" className="text-sm text-destructive">{errors.submit}</p>}
    <button className={keyButton + " justify-self-start"} disabled={!hydrated || busy || (driveRequired && !driveFolder && !preview)}>{busy ? "저장 중…" : draft ? "초안 제출" : "최종 제출"}</button>
    {previewMessage && <p role="status" className="text-sm">{previewMessage}</p>}
  </form>;
}

export function CreatorPortal({ token, data, origin, preview }: { token: string; data: CreatorPortalView; origin: string; preview: boolean }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [openAssignment, setOpenAssignment] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const api = "/api/public/creator/" + token;
  const counts = Object.fromEntries(Object.keys(statusNames).map((status) => [status, data.assignments.filter((assignment) => assignment.status === status).length]));
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
      <p className="mt-3 text-sm leading-relaxed">미션 가이드를 확인하고 제출해 주세요. 원본 영상이 필요한 미션은 내 Drive 폴더에 영상을 올린 뒤 파일 링크를 제출하면 됩니다. 검수 상태와 수정 요청은 이 페이지에서 확인할 수 있어요.</p>
      {data.driveFolder && <a href={data.driveFolder} target="_blank" rel="noopener noreferrer" className={button + " mt-3"}>내 Drive 업로드 폴더 열기</a>}
      {preview && <p className="mt-3 text-sm font-medium text-[var(--muted)]">미리보기 · 테스트 제출은 저장되지 않아요.</p>}
      {!data.confirmed && !preview && <button className={keyButton + " mt-4"} disabled={busy} onClick={() => void confirm()}>{busy ? "저장 중…" : "참여 확정하기"}</button>}
      {message && <p aria-live="polite" className="mt-3 break-words text-sm">{message}</p>}
    </header>
    <section className={card} aria-label="미션 현황">
      <h2 className="mb-3 text-lg font-semibold">미션 현황</h2>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(statusNames).map(([key, label]) => <div key={key} className="rounded-xl bg-[var(--card-2)] px-3 py-2.5">
          <dt className="text-xs text-[var(--muted)]">{label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{counts[key]}</dd>
        </div>)}
      </dl>
      <p className="mt-3 text-sm text-[var(--muted)]">활동비 {feeNames[data.feeStatus]}{data.paidOn && " · " + data.paidOn}</p>
    </section>
    {data.assignments.map((assignment) => {
      const { mission } = assignment;
      const formKey = `${assignment.id}:${assignment.version}`;
      const isOpen = openAssignment === formKey;
      const waitingForStart = assignment.stage === "final" && mission.startsAt && new Date(mission.startsAt).getTime() > data.serverNow;
      return <section key={assignment.id} className={card + " grid gap-4"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="break-words text-lg font-semibold">{mission.title}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{mission.startsAt ? dateTime(mission.startsAt) + "부터 · " : ""}{mission.dueAt ? "마감 " + dateTime(mission.dueAt) + " (KST)" : "마감일 미정"}</p></div>
          <span className="rounded-full bg-[var(--key-dim)] px-3 py-1 text-xs font-semibold">{assignment.stage === "draft" ? "초안" : "최종"} · {statusNames[assignment.status]}</span>
        </div>
        {mission.guide && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{mission.guide}</p>}
        <History history={assignment.history} proofBase={api + "/proof/"} uploads={assignment.uploads} />
        {(data.confirmed || preview) && ["todo", "revision"].includes(assignment.status) && (
          waitingForStart && !preview ? <Empty>게시 기간이 시작되면 최종 제출할 수 있어요.</Empty> :
            <div>
              <button type="button" className={keyButton} aria-expanded={isOpen} disabled={!hydrated} onClick={() => setOpenAssignment(isOpen ? "" : formKey)}>
                {assignment.status === "revision" ? "수정해서 제출하기" : "제출하기"}
              </button>
              {isOpen && <div className="mt-4"><MissionForm key={formKey} assignment={assignment} api={api} driveFolder={data.driveFolder} preview={preview} /></div>}
            </div>
        )}
        {!preview && assignment.status === "review" && <button type="button" className={button + " justify-self-start text-muted-foreground"} disabled={busy} onClick={async () => {
          setBusy(true);
          setMessage("");
          try { await portalAction(api, { action: "withdraw", assignmentId: assignment.id, version: assignment.version }); router.refresh(); }
          catch (error) { setMessage(error instanceof Error ? error.message : "처리하지 못했어요."); }
          finally { setBusy(false); }
        }}>제출 취소</button>}
      </section>;
    })}
    {!data.assignments.length && <Empty>배정된 미션이 생기면 여기에 표시돼요.</Empty>}
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
  </div>;
}
