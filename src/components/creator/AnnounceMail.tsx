"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { CreatorProgramView } from "@/lib/creator/types";
import { button, primary, input, Field, Text } from "./ui";

type Audience = "all" | "confirmed" | "unconfirmed";

type Preview = {
  total: number; sendable: number; missing: string[];
  emailConfigured: boolean; portalMissing: boolean;
  sample: { to: string; subject: string; html: string } | null;
};

const audiences: { id: Audience; label: string }[] = [
  { id: "all", label: "선발자 전체" },
  { id: "unconfirmed", label: "참여 확인 전" },
  { id: "confirmed", label: "참여 확정" },
];

/**
 * 선발 크리에이터 안내 메일.
 *
 * 선발 축하도, 새 미션 안내도 여기서 보낸다 — 미션을 만들면 개인 페이지에 배정만 되고 알림은
 * 가지 않기 때문이다. 개인 페이지 링크는 사람마다 달라 한 통씩 따로 만들어 보낸다.
 *
 * 밖으로 나가는 대량 발송이라 **미리보기 → 확인 → 발송** 세 단계를 둔다(Product UI Principles:
 * 위험한 저빈도 액션은 확인 단계 뒤에).
 */
export function AnnounceMail({ program, programId }: { program: CreatorProgramView; programId: string }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>("all");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includePortalLink, setIncludePortalLink] = useState(true);
  const [buttonLabel, setButtonLabel] = useState("내 활동 페이지 열기");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const api = "/api/creators/" + programId + "/email";
  const payload = { subject, message, audience, includePortalLink, buttonLabel };
  const ready = Boolean(subject.trim() && message.trim());

  async function call(body: Record<string, unknown>) {
    const response = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "처리하지 못했어요.");
    return result;
  }

  async function check() {
    setBusy(true);
    try { setPreview(await call({ ...payload, preview: true })); }
    catch (error) { toast.error(error instanceof Error ? error.message : "미리보기를 만들지 못했어요."); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!preview?.sendable) return;
    const ok = await confirm({
      title: `${preview.sendable}명에게 메일을 보낼까요?`,
      description: "보낸 메일은 되돌릴 수 없어요. 제목과 내용을 한 번 더 확인해 주세요.",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await call(payload);
      if (result.emailConfigured === false) toast.error("메일 발송이 설정돼 있지 않아 아무것도 보내지 않았어요.");
      else {
        toast.success(`${result.sent}명에게 보냈어요.${result.failed ? ` ${result.failed}건 실패.` : ""}`);
        setPreview(null);
        setSubject("");
        setMessage("");
        setOpen(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "보내지 못했어요.");
    } finally { setBusy(false); }
  }

  if (!program.participants.length) return null;

  return <section className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-semibold">안내 메일</h3>
        <p className="text-sm text-muted-foreground">선발 축하, 새 미션 안내를 선발자에게 한 번에 보내요.</p>
      </div>
      <button className={button} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "닫기" : "메일 쓰기"}</button>
    </div>

    {open && <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <Field label="받는 사람">
          <select className={input} value={audience} onChange={(event) => { setAudience(event.target.value as Audience); setPreview(null); }}>
            {audiences.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <Field label="제목">
          <Text maxLength={150} value={subject} placeholder="2027 대한민국 교육박람회 크리에이터로 선발되셨습니다"
            onChange={(event) => { setSubject(event.target.value); setPreview(null); }} />
        </Field>
      </div>
      <Field label="내용 — {{이름}} 을 쓰면 각자 이름으로 바뀌어요">
        <textarea className={input} rows={8} maxLength={4000} value={message}
          placeholder={"{{이름}} 님, 안녕하세요.\n\n2027 대한민국 교육박람회 크리에이터로 선발되셨습니다. 축하드립니다!\n아래 버튼을 눌러 활동 페이지에서 미션과 제출 방법을 확인해 주세요."}
          onChange={(event) => { setMessage(event.target.value); setPreview(null); }} />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includePortalLink} onChange={(event) => { setIncludePortalLink(event.target.checked); setPreview(null); }} />
          개인 활동 페이지 링크 버튼 넣기
        </label>
        {includePortalLink && <Field label="버튼 문구">
          <Text maxLength={40} value={buttonLabel} onChange={(event) => { setButtonLabel(event.target.value); setPreview(null); }} />
        </Field>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={!ready || busy} onClick={() => void check()}>{busy ? "확인 중…" : "받는 사람·내용 확인"}</button>
        <button className={primary} disabled={!preview?.sendable || busy} onClick={() => void send()}>
          {preview?.sendable ? `${preview.sendable}명에게 보내기` : "보내기"}
        </button>
      </div>

      {preview && <div className="grid gap-2 rounded-xl bg-muted/30 p-3 text-sm">
        <p><strong>{preview.sendable}명</strong>에게 보낼 수 있어요{preview.total !== preview.sendable ? ` (대상 ${preview.total}명)` : ""}.</p>
        {preview.missing.length > 0 && <p className="text-muted-foreground">
          이메일이 없어 제외: {preview.missing.join(", ")} — 선발자 탭의 “운영 연락처”에 이메일을 넣거나 신청서 이메일이 있어야 보낼 수 있어요.
        </p>}
        {!preview.emailConfigured && <p role="alert" className="text-destructive">메일 발송이 설정돼 있지 않아요(RESEND_API_KEY). 지금 보내면 아무것도 나가지 않아요.</p>}
        {preview.portalMissing && <p role="alert" className="text-destructive">공개 주소가 없어 개인 페이지 링크를 넣을 수 없어요.</p>}
        {preview.sample && <details>
          <summary className="cursor-pointer font-medium">{preview.sample.to} 에게 갈 메일 미리보기</summary>
          <div className="mt-2 overflow-hidden rounded-lg bg-background p-2">
            <iframe title="메일 미리보기" className="h-72 w-full border-0" sandbox="" srcDoc={preview.sample.html} />
          </div>
        </details>}
      </div>}
    </div>}
  </section>;
}
