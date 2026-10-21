import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../email";

const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.EMAIL_FROM;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  if (originalFrom === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalFrom;
});

describe("sendEmail", () => {
  it("API 키가 없으면 외부 요청 없이 건너뛴다", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail({ to: "guest@example.com", subject: "Hi", html: "<p>Hi</p>" }))
      .resolves.toEqual({ sent: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Reply-To와 중복 방지 키를 Resend 요청에 전달한다", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Korea Expo LA <notifications@en.usa.k-expo.org>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail({
      to: "guest@example.com",
      subject: "Registration confirmed",
      html: "<p>Done</p>",
      replyTo: "help@k-expo.org",
      idempotencyKey: "collect-confirmation/record_1",
      attachments: [{
        content: "cG5n",
        filename: "ticket.png",
        contentId: "registration-qr",
      }],
    })).resolves.toEqual({ sent: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("collect-confirmation/record_1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: "Korea Expo LA <notifications@en.usa.k-expo.org>",
      to: ["guest@example.com"],
      reply_to: "help@k-expo.org",
      attachments: [{ content: "cG5n", filename: "ticket.png", content_id: "registration-qr" }],
    });
  });
});

describe("sendEmail — 초당 한도(429) 재시도", () => {
  it("429 면 기다렸다 다시 보내 성공한다", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "0.01" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "email_2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail({ to: "guest@example.com", subject: "Hi", html: "<p>Hi</p>", idempotencyKey: "k1" })).resolves.toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("422 같은 요청 오류는 다시 보내지 않는다", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad to", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendEmail({ to: "bad", subject: "Hi", html: "<p>Hi</p>" });
    expect(r.sent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
