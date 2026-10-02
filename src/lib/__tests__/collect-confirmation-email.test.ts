import { describe, expect, it } from "vitest";
import { buildCollectConfirmationEmail, noAutoLink } from "../collect-confirmation-email";
import { normalizeCollectForm } from "../collect-form-config";

describe("buildCollectConfirmationEmail", () => {
  it("등록자 티켓·유형·행사 정보와 공개 주소를 메일에 넣는다", () => {
    const config = normalizeCollectForm({
      fields: [
        { key: "full_name", label: "Full name", type: "text", enabled: true },
        { key: "email", label: "Email", type: "email", enabled: true },
        { key: "phone", label: "Phone", type: "tel", enabled: true },
        { key: "visitor_type", label: "Visitor type", type: "select", enabled: true, options: ["General", "Buyer"] },
      ],
      branch: { enabled: true, fieldKey: "visitor_type", groups: [{ value: "Buyer", fields: [] }] },
      eventInfo: { enabled: true, eventDates: ["2026-10-22"], venue: "Magic Box, LA" },
      legal: { eventName: "Korea Expo LA 2026" },
      confirmationEmail: { enabled: true, subject: "Your ticket", body: "Line one\nLine two" },
    });

    const result = buildCollectConfirmationEmail({
      config,
      sourceName: "LA preregistration",
      locale: "en",
      registrationNo: "1234567890123",
      data: {
        full_name: "Alex Kim",
        email: "alex@example.com",
        phone: "+12025550147",
        visitor_type: "Buyer",
      },
    });

    expect(result.subject).toBe("Your ticket");
    expect(result.qrContentId).toBe("registration-qr");
    expect(result.html).toContain("Alex Kim");
    expect(result.html).toContain("Buyer");
    expect(result.html).toContain("Magic Box, LA");
    expect(result.html).toContain("Line one<br>Line two");
    expect(result.html).not.toContain("alex@example.com");
    expect(result.html).toContain('src="cid:registration-qr"');
    expect(result.html).toContain('bgcolor="#ffffff"');
    expect(result.html).toContain('background:#ffffff');
    expect(result.html).not.toContain("Save the attached");
    expect(result.html).not.toContain("href=");
    expect(result.html).not.toContain("app.example.com");
  });

  /**
   * showOnTicket 을 켠 항목(예: 동반 인원 수)이 확인 메일에도 티켓 화면·완료 화면과 같이
   * 뜬다 — 세 자리 중 하나만 반영되면 "QR 은 봤는데 메일엔 없다"가 생긴다.
   */
  it("showOnTicket 을 켠 항목의 값을 Phone/E-mail 과 같은 자리에 넣는다", () => {
    const config = normalizeCollectForm({
      fields: [
        { key: "companions", label: "Companions", type: "number", enabled: true, showOnTicket: true },
        { key: "notes", label: "Notes", type: "text", enabled: true, showOnTicket: true },
      ],
      confirmationEmail: { enabled: true },
    });
    const result = buildCollectConfirmationEmail({
      config,
      sourceName: "Expo",
      locale: "en",
      registrationNo: "1234567890123",
      data: { companions: "2", notes: "should stay private" },
    });
    expect(result.html).toContain("Companions</strong>2");
    // 값이 비어 있으면(§공통 "빈 껍데기 노출 금지") 라벨도 같이 안 나간다.
    expect(result.html).not.toContain("Notes");
    expect(result.html).not.toContain("should stay private");
  });

  it("행사 개요 공개 표시가 꺼져 있어도 이메일 토글이 켜져 있으면 일정·장소를 표시한다", () => {
    const config = normalizeCollectForm({
      eventInfo: { enabled: false, eventDates: ["2026-10-22"], venue: "Magic Box, LA" },
      confirmationEmail: { enabled: true, includeEventInfo: true },
    });
    const result = buildCollectConfirmationEmail({
      config,
      sourceName: "Expo",
      locale: "en",
      registrationNo: "1234567890123",
      data: {},
    });
    expect(result.html).toContain("2026-10-22");
    expect(result.html).toContain("Magic Box, LA");
  });

  it("사용자 문구를 HTML로 실행하지 않고 외부 링크를 삽입하지 않는다", () => {
    const config = normalizeCollectForm({
      confirmationEmail: { enabled: true, heading: "<script>alert(1)</script>", showQr: true },
    });
    const result = buildCollectConfirmationEmail({
      config,
      sourceName: "Expo",
      locale: "en",
      registrationNo: "1234567890123",
      data: {},
    });
    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("href=");
  });
});

describe("QR 안내 박스 문구 · 자동 링크 막기", () => {
  const base = {
    fields: [{ key: "email", label: "Email", type: "email", enabled: true }],
    legal: { eventName: "2026 Korea Expo LA Oneday Class" },
  };
  const build = (confirmationEmail: Record<string, unknown>) =>
    buildCollectConfirmationEmail({
      config: normalizeCollectForm({ ...base, confirmationEmail: { enabled: true, ...confirmationEmail } }),
      sourceName: "x",
      locale: "en",
      registrationNo: "1234567890128",
      data: { email: "a@b.co" },
    }).html;

  it("비우면 기본 문구", () => {
    const html = build({});
    expect(html).toContain("Show this QR code at the registration desk");
    expect(html).toContain("to check in and enter the event.");
  });

  /** 메인 스테이지 프로그램은 입구가 아니라 무대 앞 접수대에서 한 번 더 확인한다 — 행사마다 문구가 다르다. */
  it("운영자가 정한 문구로 바꾼다", () => {
    const html = build({ calloutTitle: "Show this QR code at the Main Stage desk", calloutBody: "Check in again at the stage\nbefore the class." });
    expect(html).toContain("Show this QR code at the Main Stage desk");
    expect(html).toContain("Check in again at the stage<br>before the class.");
    expect(html).not.toContain("registration desk");
  });

  /** 아이폰 메일·아웃룩 모바일이 "2026 Korea" 를 날짜로 보고 파란 밑줄 링크로 바꾼 사례. */
  it("메일 앱의 자동 링크를 막는다 — 메타·스타일·행사명 숫자 끊기", () => {
    const html = build({});
    expect(html).toContain('name="format-detection"');
    expect(html).toContain("a[x-apple-data-detectors]");
    expect(html).toContain("2&zwnj;0&zwnj;2&zwnj;6 Korea Expo LA Oneday Class");
  });
});

describe("noAutoLink", () => {
  it("HTML 엔티티 속 숫자는 건드리지 않는다", () => {
    expect(noAutoLink("Rock &#39;n&#39; Roll 2026")).toBe("Rock &#39;n&#39; Roll 2&zwnj;0&zwnj;2&zwnj;6");
    expect(noAutoLink("Day 1")).toBe("Day 1");
  });
});
