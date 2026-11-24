import { reminderEmailHtml } from "@/lib/email";

/**
 * 선발 크리에이터 안내 메일.
 *
 * 선발 축하도, 새 미션 안내도 같은 길을 쓴다 — 미션을 만들면 개인 페이지에 배정만 되고 알림은
 * 가지 않기 때문에, 운영자가 여기서 문구를 쓰고 개인 페이지 링크를 함께 보낸다.
 *
 * 받는 주소는 **운영 연락처가 이메일이면 그것을, 아니면 신청서 이메일**을 쓴다. 운영 연락처에는
 * DM URL 도 들어가므로 이메일인지 가려야 한다.
 */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function recipientEmail(contact: string, applicationEmail: string | null): string {
  const direct = contact.trim();
  if (EMAIL.test(direct)) return direct.toLowerCase();
  const fallback = (applicationEmail ?? "").trim();
  return EMAIL.test(fallback) ? fallback.toLowerCase() : "";
}

/** 본문의 {{이름}} 을 사람 이름으로 바꾼다. 다른 중괄호는 건드리지 않는다. */
export function personalize(body: string, name: string): string {
  return body.replace(/\{\{\s*이름\s*\}\}/g, name);
}

export function creatorEmailHtml(opts: { subject: string; body: string; name: string; portalUrl?: string; buttonLabel?: string }): string {
  const { subject, body, name, portalUrl, buttonLabel } = opts;
  return reminderEmailHtml({
    title: subject,
    body: personalize(body, name),
    url: portalUrl || undefined,
    buttonLabel: buttonLabel || "내 활동 페이지 열기",
  });
}
