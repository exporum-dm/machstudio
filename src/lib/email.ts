// 이메일 발송 추상화 — Resend HTTP API(의존성 없이 fetch).
// RESEND_API_KEY 가 없으면 안전하게 skip 한다(개발/미설정 환경에서 오류 없이 no-op).
// 실제 발송하려면: Resend 계정 → 발송 도메인 인증 → RESEND_API_KEY(+선택 EMAIL_FROM) 환경변수 설정.

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  idempotencyKey?: string;
  attachments?: Array<{
    content: string;
    filename: string;
    contentId?: string;
  }>;
}

export type SendResult = { sent: boolean; skipped?: boolean; error?: string };

/**
 * Resend 호출 — 429(초당 한도, 기본 2건/초)·5xx 는 잠깐 기다렸다 다시 보낸다(최대 4번).
 * 행사 당일 입구에서 여럿이 동시에 등록하면 확인 메일이 한꺼번에 몰려 429 가 난다 — 예전엔 그대로 실패로 끝났다(2026-10-21).
 * 발송은 응답 뒤(after)에서 돌아 기다려도 등록 화면은 느려지지 않는다. Idempotency-Key 가 있으면 중복 발송도 없다.
 */
async function resendFetch(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let res: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (i === attempts - 1) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 600 * (i + 1) + Math.floor(Math.random() * 400);
    await new Promise((r) => setTimeout(r, wait));
  }
  return res!;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail({ to, subject, html, from, replyTo, idempotencyKey, attachments }: SendArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, skipped: true };

  const sender = from || process.env.EMAIL_FROM || "webinar@mach.studio";
  try {
    const res = await resendFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: sender,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments?.length ? {
          attachments: attachments.map((attachment) => ({
            content: attachment.content,
            filename: attachment.filename,
            ...(attachment.contentId ? { content_id: attachment.contentId } : {}),
          })),
        } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, error: `resend ${res.status} ${detail.slice(0, 120)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

// 배치 발송 — Resend /emails/batch(요청당 최대 100건)로 여러 수신자를 한 번에.
// 각 메시지는 to:[단일주소] 라 수신자끼리 노출되지 않는다. 키 미설정 시 전부 skip.
export async function sendEmailBatch(
  messages: SendArgs[],
): Promise<{ sent: number; skipped: number; failed: number }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: 0, skipped: messages.length, failed: 0 };
  const defaultSender = process.env.EMAIL_FROM || "webinar@mach.studio";
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await resendFetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((m) => ({ from: m.from || defaultSender, to: [m.to], subject: m.subject, html: m.html }))),
      });
      if (res.ok) sent += chunk.length;
      else failed += chunk.length;
    } catch {
      failed += chunk.length;
    }
  }
  return { sent, skipped: 0, failed };
}

// 알림 메일 버튼 URL 정규화 — 스킴을 빼먹고 입력한 값("example.com")이 조용히 버튼째 사라지지 않도록
// https:// 를 붙여 재시도한다. 그래도 http(s) 로 파싱되지 않으면(공백·잘못된 호스트 등) null —
// 호출부가 null 을 "버튼 없음"이 아니라 "입력값이 틀렸다"로 다뤄야 대량 발송 중 조용한 유실을 막는다.
export function normalizeReminderUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

// 간단한 알림 이메일 HTML — 제목/본문/버튼(선택).
export function reminderEmailHtml(opts: { title: string; body: string; url?: string; buttonLabel?: string }): string {
  const { title, body, url, buttonLabel } = opts;
  // 속성 컨텍스트까지 안전하게 — 따옴표도 이스케이프
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  // http(s) 링크만 허용 (javascript:/data: 등 차단) — 스킴 누락은 normalizeReminderUrl 이 보정
  const safeUrl = url ? normalizeReminderUrl(url) ?? "" : "";
  const button = safeUrl
    ? `<a href="${esc(safeUrl)}" style="display:inline-block;margin-top:20px;padding:12px 22px;border-radius:10px;background:#5b5bd6;color:#fff;text-decoration:none;font-weight:700;font-size:14px;">${esc(buttonLabel || "바로가기")}</a>`
    : "";
  return `<div style="font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#16161a;">
    <h1 style="font-size:20px;font-weight:800;margin:0 0 12px;">${esc(title)}</h1>
    <p style="font-size:15px;line-height:1.7;color:#44454f;white-space:pre-wrap;margin:0;">${esc(body)}</p>
    ${button}
  </div>`;
}
