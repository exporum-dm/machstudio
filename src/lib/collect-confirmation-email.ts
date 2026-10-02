import { visitorBadgePalette } from "@/lib/collect-badge";
import { DEFAULT_EMAIL_CALLOUT, localize, type CollectFormConfig } from "@/lib/collect-form-config";
import { buildTicketView } from "@/lib/collect-lookup";

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const lines = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");

/**
 * accent 를 흰색 쪽으로 옅게 섞는다 — 강조 박스 배경색으로 쓴다.
 * `color-mix()` 는 아웃룩 데스크톱(워드 렌더러)이 못 읽어 배경이 통째로 안 칠해진다.
 * 채널별로 직접 섞어 고정 hex 를 내면 이메일 클라이언트 전반에서 안전하다.
 */
function tint(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff7ed";
  const num = parseInt(m[1], 16);
  const mix = (shift: number) => Math.round(255 * (1 - amount) + ((num >> shift) & 255) * amount);
  return `#${[mix(16), mix(8), mix(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function eventRows(config: CollectFormConfig, locale: string) {
  if (!config.confirmationEmail.includeEventInfo) return [];
  const rows: Array<[string, string]> = [];
  if (config.eventInfo.eventDates.length) rows.push(["Date", config.eventInfo.eventDates.join(" · ")]);
  const venue = localize(config.eventInfo.venue, locale);
  if (venue) rows.push(["Venue", venue]);
  if (config.eventInfo.openingHours.length) {
    rows.push(["Opening hours", config.eventInfo.openingHours.map((item) => {
      const hours = [item.open, item.close].filter(Boolean).join(" – ");
      const last = item.lastEntrance ? ` (Last entrance ${item.lastEntrance})` : "";
      return `${item.date}${hours ? ` ${hours}` : ""}${last}`;
    }).join("\n")]);
  }
  for (const row of config.eventInfo.extraRows) {
    const label = localize(row.label, locale);
    const value = localize(row.value, locale);
    if (label && value) rows.push([label, value]);
  }
  return rows;
}

/** 숫자 사이에 &zwnj;(보이지 않는 글자)를 끼워 메일 앱이 날짜·시각·전화로 인식해 링크로 바꾸지 못하게 한다. */
export function noAutoLink(html: string): string {
  // &#39; 같은 HTML 엔티티 안의 숫자는 건드리지 않는다(깨진다) — 엔티티는 통째로 지나간다
  return html.replace(/&#?\w+;|\d{2,}/g, (m) => (m.startsWith("&") ? m : m.split("").join("&zwnj;")));
}

export function buildCollectConfirmationEmail({
  config,
  sourceName,
  locale,
  registrationNo,
  data,
}: {
  config: CollectFormConfig;
  sourceName: string;
  locale: string;
  registrationNo: string;
  data: unknown;
}) {
  const email = config.confirmationEmail;
  const eventName = config.legal.eventName || sourceName;
  const ticket = buildTicketView(config, { registrationNo, data });
  const subject = localize(email.subject, locale) || `Registration confirmed — ${eventName}`;
  const heading = localize(email.heading, locale) || "You're registered";
  const body = localize(email.body, locale)
    || "Your pre-registration is complete. Please show this QR code at the venue.";
  const accent = config.theme.accentColor || "#F28C18";
  const qrContentId = "registration-qr";
  const details = eventRows(config, locale);
  const emailNotices = config.notices.filter((notice) => notice.enabled && notice.placement === "email");

  const detailHtml = details.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-collapse:collapse;">${details.map(([label, value]) => `
      <tr>
        <td style="width:118px;padding:10px 0;border-bottom:1px solid #e8e8e8;color:#777;font-size:13px;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#222;font-size:13px;font-weight:600;line-height:1.55;">${lines(value)}</td>
      </tr>`).join("")}</table>`
    : "";

  // Phone/E-mail 과 운영자가 showOnTicket 을 켠 항목(예: 동반 인원 수)을 같은 줄 목록으로 이어 붙인다
  // — 티켓 화면·완료 화면과 같은 규칙(collect-lookup.buildTicketView 의 extras).
  const contactRows: Array<[string, string]> = [];
  if (ticket?.maskedPhone) contactRows.push(["Phone", ticket.maskedPhone]);
  if (ticket?.maskedEmail) contactRows.push(["E-mail", ticket.maskedEmail]);
  if (ticket) for (const extra of ticket.extras) contactRows.push([extra.label, extra.value]);

  const contactHtml = contactRows.length
    ? `<div style="margin:18px auto 0;max-width:320px;padding:12px 16px;border-radius:12px;background:#ffffff;text-align:left;font-size:12px;line-height:1.8;color:#555;">
        ${contactRows.map(([label, value]) => `<div><strong style="display:inline-block;min-width:80px;color:#333;">${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`).join("")}
      </div>`
    : "";

  /**
   * QR 블록 — 이미지를 **흰 칸에 넣어서** 보낸다.
   *
   * QR 이 얹히는 패널은 #f4f5f7 인데, 다크모드를 적용하는 메일 클라이언트(아웃룩닷컴 등)는
   * 밝은 배경을 뒤집는다. 그러면 이미지 안의 4모듈이 흰색의 **전부**가 되고, 220px 표시에서
   * 그건 약 30px 이다 — 클라이언트가 이미지를 줄이기라도 하면 3mm 밑으로 떨어진다.
   * td 에 흰색을 못 박아 여백을 한 겹 더 깐다(패딩 20px = collect-qr.ts 의 QR_WHITE_PAD_PX).
   *
   * div 가 아니라 table 인 이유: 아웃룩 데스크톱(워드 렌더러)은 div 의 padding·background 를
   * 무시하지만 td 의 bgcolor·padding 은 지킨다. line-height:0/font-size:0 은 이미지 아래
   * 생기는 인라인 여백(그만큼 흰 칸이 비뚤어진다)을 없앤다.
   */
  const qrBlockHtml = `<table role="presentation" align="center" cellspacing="0" cellpadding="0" style="margin:18px auto 12px;border-collapse:collapse;">
        <tr><td bgcolor="#ffffff" style="padding:20px;background:#ffffff;border-radius:16px;line-height:0;font-size:0;">
          <img src="cid:${qrContentId}" width="220" height="220" alt="Registration QR code" style="display:block;width:220px;height:220px;background:#ffffff;" />
        </td></tr>
      </table>`;

  // 등록 데스크에서 QR 을 보여 달라는 요청이 문의로 자주 들어와, 본문 안내 문구와 별개로
  // 눈에 띄는 강조 박스를 하나 더 둔다(완료 화면·티켓 페이지와 같은 문구·같은 강조 방식).
  // 문구는 행사마다 다르다(입구 접수대 / 메인 스테이지 접수대 …) — 비우면 기본 문구.
  const calloutTitle = localize(email.calloutTitle, locale) || DEFAULT_EMAIL_CALLOUT.title;
  const calloutBody = localize(email.calloutBody, locale) || DEFAULT_EMAIL_CALLOUT.body;
  const checkinCalloutHtml = email.showQr
    ? `<div style="margin:20px 0 0;padding:16px 18px;border-radius:14px;border-left:4px solid ${accent};background:${tint(accent, 0.16)};">
        <div style="font-size:14px;font-weight:800;color:${accent};line-height:1.5;">${escapeHtml(calloutTitle)}</div>
        ${calloutBody ? `<div style="margin-top:2px;font-size:13px;color:#555;line-height:1.5;">${lines(calloutBody)}</div>` : ""}
      </div>`
    : "";

  const socialLinks: Array<[string, string]> = [
    ...(email.instagramUrl ? [["Instagram", email.instagramUrl] as [string, string]] : []),
    ...(email.tiktokUrl ? [["TikTok", email.tiktokUrl] as [string, string]] : []),
  ];
  const socialHtml = socialLinks.length
    ? `<div style="margin-top:22px;padding-top:18px;border-top:1px solid #e8e8e8;text-align:center;">
        <div style="font-size:11px;color:#999;margin-bottom:8px;">Follow us for event updates</div>
        <div style="font-size:13px;font-weight:700;">
          ${socialLinks.map(([label, url]) => `<a href="${escapeHtml(url)}" style="color:${accent};text-decoration:none;">${escapeHtml(label)}</a>`).join('<span style="color:#ccc;padding:0 8px;">·</span>')}
        </div>
      </div>`
    : "";

  const noticesHtml = emailNotices.map((notice) => {
    const title = localize(notice.title, locale);
    const noticeBody = localize(notice.body, locale);
    if (!title && !noticeBody) return "";
    return `<div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:#f7f7f7;color:#555;font-size:12px;line-height:1.65;">
      ${title ? `<strong style="display:block;margin-bottom:4px;color:#222;">${escapeHtml(title)}</strong>` : ""}
      ${noticeBody ? lines(noticeBody) : ""}
    </div>`;
  }).join("");

  /*
   * 메일 앱의 자동 링크 막기 — 아이폰 메일·아웃룩 모바일은 "2026" 같은 숫자를 날짜·시각으로, 주소처럼 보이는
   * 글자를 지도 링크로 **멋대로 파란 밑줄 링크**로 바꾼다(2026-10 확인 메일의 "2026 Korea" 가 파랗게 보인 원인).
   *  · format-detection 메타: iOS 가 전화·날짜·주소·이메일을 링크로 만들지 않게
   *  · a[x-apple-data-detectors] 스타일: 그래도 만들어진 링크는 원래 글자 모양 그대로
   *  · 행사명 숫자 사이에 보이지 않는 글자(&zwnj;)를 끼워 날짜 인식 자체를 끊는다(아웃룩은 메타를 안 본다)
   */
  const headHtml = `<head><meta charset="utf-8"><meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no"><meta name="x-apple-disable-message-reformatting"><style>a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;}u+#body a{color:inherit;text-decoration:none;}</style></head>`;
  const html = `<!doctype html><html>${headHtml}<body id="body" style="margin:0;padding:0;background:#f4f5f7;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
        <tr><td style="height:8px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:34px 34px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#171717;">
          <div style="font-size:13px;font-weight:700;color:${accent};letter-spacing:.04em;">${noAutoLink(escapeHtml(eventName))}</div>
          <h1 style="margin:10px 0 12px;font-size:26px;line-height:1.25;">${escapeHtml(heading)}</h1>
          <p style="margin:0;color:#555;font-size:14px;line-height:1.75;">${lines(body)}</p>
          ${checkinCalloutHtml}
          ${detailHtml}
        </td></tr>
        <tr><td style="padding:6px 24px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
          <div style="padding:26px 18px;border-radius:16px;background:#f4f5f7;text-align:center;">
            ${ticket?.visitorType ? `<span style="display:inline-block;padding:7px 14px;border-radius:999px;background:${visitorBadgePalette(ticket.visitorType, config.badgeRules).background};color:${visitorBadgePalette(ticket.visitorType, config.badgeRules).foreground};font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(ticket.visitorType)}</span>` : ""}
            ${ticket?.name ? `<div style="margin-top:12px;font-size:18px;font-weight:800;color:#171717;">${escapeHtml(ticket.name)}</div>` : ""}
            ${email.showQr ? qrBlockHtml : ""}
            ${contactHtml}
            <div style="margin-top:18px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:17px;font-weight:800;letter-spacing:.18em;color:#171717;">${escapeHtml(registrationNo)}</div>
            <div style="margin-top:6px;color:#777;font-size:11px;">Show this at the venue</div>
          </div>
          ${noticesHtml}
          ${socialHtml}
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  return { subject, html, qrContentId };
}
