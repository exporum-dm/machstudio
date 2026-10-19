/**
 * 만족도 조사 응답 티켓 — 이메일/전화로 본인 확인을 통과한 뒤 받는 짧은 서명 값.
 *
 * 제출은 이 티켓이 있어야 받는다. 티켓 없이 recordId 를 그대로 받으면 남의 등록번호로 대신 응답할 수 있다.
 * 등록 확인(Find My QR)과 같은 문턱(이메일 또는 전화를 아는 사람)이고, 수명은 2시간.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import "server-only";

const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function secret(surveyId: string): string {
  const base = process.env.SURVEY_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DATABASE_URL || "survey";
  return createHash("sha256").update(`${base}.${surveyId}`).digest("hex");
}

interface TicketBody { s: string; r: string; a: string; e: number }

export function createSurveyTicket(surveyId: string, recordId: string, audience: string): string {
  const body: TicketBody = { s: surveyId, r: recordId, a: audience, e: Date.now() + MAX_AGE_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret(surveyId)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySurveyTicket(ticket: unknown, surveyId: string): { recordId: string; audience: string } | null {
  if (typeof ticket !== "string" || !ticket.includes(".")) return null;
  const [payload, sig] = ticket.split(".");
  const expected = createHmac("sha256", secret(surveyId)).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as TicketBody;
    if (body.s !== surveyId || Date.now() > body.e || typeof body.r !== "string") return null;
    return { recordId: body.r, audience: typeof body.a === "string" ? body.a : "" };
  } catch {
    return null;
  }
}
