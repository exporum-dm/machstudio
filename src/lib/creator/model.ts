import { z } from "zod";

const label = z.string().trim().min(1).max(160);
const id = z.string().min(1).max(100);
const details = z.string().max(10000);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const date = z.iso.date();
export const webUrl = z.url({ protocol: /^https?$/ }).max(2048);
const urlOrEmpty = z.union([webUrl, z.literal("")]);
const cell = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]);
const cells = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,64}$/), cell);
const type = z.enum(["text", "number", "date", "select", "checkbox", "url"]);
export const columnSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,64}$/), label, type, hidden: z.boolean().optional(),
  options: z.array(label).max(50).optional(),
});
export type Column = z.infer<typeof columnSchema>;
export type Cells = z.infer<typeof cells>;

export const baseColumns: Column[] = [
  { key: "name", label: "이름", type: "text" },
  { key: "platform", label: "SNS", type: "text" },
  { key: "handle", label: "계정", type: "text" },
  { key: "profileUrl", label: "프로필 링크", type: "url" },
  { key: "followers", label: "팔로워", type: "number" },
  { key: "avgViews", label: "평균 조회수", type: "number" },
  { key: "dmOn", label: "DM 발송일", type: "date" },
  { key: "interest", label: "연락 상태", type: "select", options: ["미연락", "DM 발송", "답변 대기", "참여 의향 있음", "신청 링크 발송", "참여 의향 없음"] },
  { key: "owner", label: "담당자", type: "text" },
  { key: "rank", label: "우선순위", type: "text" },
  { key: "memo", label: "메모", type: "text" },
];

export function creatorColumns(raw: unknown): Column[] {
  const stored = z.array(columnSchema).safeParse(raw);
  if (!stored.success) return baseColumns;
  const columns = stored.data.map((column) => {
    const base = baseColumns.find(({ key }) => key === column.key);
    return base ? { ...base, hidden: column.hidden } : column;
  });
  return [...columns, ...baseColumns.filter(({ key }) => !columns.some((column) => column.key === key))];
}

export function normalizeCell(column: Column, value: unknown) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null;
  if (column.type === "number") {
    const numeric = typeof value === "number" ? value : Number(String(value).trim().replaceAll(",", ""));
    if (!Number.isFinite(numeric)) throw new Error(column.label + "에 숫자를 입력해 주세요.");
    return numeric;
  }
  if (column.type === "checkbox") return value === true || /^(true|1|yes|예|✓)$/i.test(String(value));
  const text = String(value).trim();
  if (column.type === "date" && !date.safeParse(text).success) throw new Error(column.label + "은 YYYY-MM-DD 형식으로 입력해 주세요.");
  if (column.type === "url" && !webUrl.safeParse(text).success) throw new Error(column.label + "에 http 또는 https 주소를 입력해 주세요.");
  if (column.type === "select" && !column.options?.includes(text)) throw new Error(column.label + "의 선택지를 확인해 주세요.");
  return text;
}

export const platforms = ["instagram", "tiktok", "youtube", "facebook", "x", "blog", "other"] as const;
const platform = z.enum(platforms);
export const mode = z.enum(["fixed", "platform", "handle", "creator", "program"]);
const utmField = z.object({ mode, value: z.string().trim().max(200) });
export const utmSchema = z.object({ source: utmField, medium: utmField, campaign: utmField, term: utmField, content: utmField });
export type Utm = z.infer<typeof utmSchema>;
export const defaultUtm: Utm = {
  source: { mode: "fixed", value: "ambassador" },
  medium: { mode: "platform", value: "" },
  campaign: { mode: "program", value: "" },
  term: { mode: "handle", value: "" },
  content: { mode: "fixed", value: "" },
};
export function creatorUtm(raw: unknown) {
  const validated = utmSchema.safeParse(raw);
  return validated.success ? validated.data : defaultUtm;
}
export function trackingUrl(destination: string, utm: Utm, link: { code: string; platform: string; handle: string; creator: string; program: string }) {
  const url = new URL(destination);
  const fields = ["source", "medium", "campaign", "term", "content"] as const;
  for (const field of fields) {
    const rule = utm[field];
    const value = rule.mode === "fixed" ? rule.value : link[rule.mode];
    if (value) url.searchParams.set("utm_" + field, value);
    else url.searchParams.delete("utm_" + field);
  }
  url.searchParams.set("utm_id", link.code);
  return url;
}

export const profileSchema = z.object({
  image: urlOrEmpty.optional(), bio: details.optional(), region: z.string().max(160).optional(),
  languages: z.string().max(240).optional(), interests: z.string().max(500).optional(),
  publicContact: z.string().max(240).optional(), social: urlOrEmpty.optional(),
});
export const themeSchema = z.object({ title: label, background: hex, accent: hex });
export const publicationSchema = themeSchema.extend({
  entries: z.array(profileSchema.extend({ name: label, award: z.string().max(160).optional(), participantId: id.optional() })),
});
export type Publication = z.infer<typeof publicationSchema>;
export const missionSchema = z.object({
  title: label, guide: details, startsAt: z.iso.datetime().nullable(), dueAt: z.iso.datetime(),
  platforms: z.array(platform).min(1).max(platforms.length), linkCount: z.number().int().min(0).max(10),
  proof: z.enum(["off", "optional", "required"]), draft: z.boolean(),
}).refine((mission) => (!mission.startsAt || mission.startsAt < mission.dueAt) && (mission.linkCount > 0 || mission.proof === "required"),
  "마감은 시작 이후여야 하며 제출 링크나 필수 증빙이 있어야 합니다.");

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createApplicationForm") }),
  z.object({ action: z.literal("settings"), name: label, applicationSourceId: id.nullable(), registrationSourceId: id.nullable(), utm: utmSchema }),
  z.object({ action: z.literal("columns"), columns: z.array(columnSchema).max(80) }),
  z.object({ action: z.literal("candidateAdd"), rows: z.array(cells).min(1).max(250) }),
  z.object({ action: z.literal("candidateEdit"), id, key: z.string(), value: cell }),
  z.object({ action: z.literal("candidateDelete"), id }),
  z.object({ action: z.literal("select"), applicationId: id, name: label, channels: z.partialRecord(platform, z.string().trim().max(160)) }),
  z.object({ action: z.literal("participant"), id, patch: z.object({
    name: label.optional(), confirmed: z.boolean().optional(), channels: z.partialRecord(platform, z.string().trim().max(160)).optional(),
    profile: profileSchema.optional(), feeStatus: z.enum(["unpaid", "scheduled", "paid"]).optional(), paidOn: date.nullable().optional(),
    owner: z.string().trim().max(160).optional(), contact: z.string().trim().max(400).optional(),
    award: z.string().trim().max(160).optional(), awardOrder: z.number().int().min(0).max(10000).optional(),
  }) }),
  z.object({ action: z.literal("rotateAccess"), id }),
  z.object({ action: z.literal("unselect"), id, token: z.string().regex(/^cp_[A-Za-z0-9_-]{32}$/) }),
  z.object({ action: z.literal("mission"), id: id.optional(), mission: missionSchema }),
  z.object({ action: z.literal("review"), id, version: z.number().int(), approved: z.boolean(), feedback: details }),
  z.object({ action: z.literal("contact"), id, channel: z.string().trim().min(1).max(50) }),
  z.object({ action: z.literal("publish"), kind: z.enum(["roster", "awards"]), theme: themeSchema.nullable() }),
]);
export type CreatorAction = z.infer<typeof actionSchema>;

export const submissionSchema = z.object({
  version: z.number().int(), platform, links: z.array(webUrl).max(10), files: z.array(id).max(5), note: details,
});

export type HistoryEntry =
  | { kind: "submission"; stage: string; at: string; platform: string; links: string[]; files: string[]; note: string }
  | { kind: "approved" | "revision"; stage: string; at: string; feedback: string };

export function reviewState(assignment: { stage: string; status: string }, approved: boolean) {
  if (assignment.status !== "review") return null;
  if (!approved) return { stage: assignment.stage, status: "revision" };
  return assignment.stage === "draft" ? { stage: "final", status: "todo" } : { stage: "final", status: "done" };
}

export function workQueue(assignment: { status: string; mission: { dueAt: string | Date } }, now: number) {
  if (assignment.status === "review") return "review";
  if (assignment.status === "done") return null;
  const remaining = new Date(assignment.mission.dueAt).getTime() - now;
  if (remaining < 0) return "overdue";
  if (assignment.status === "revision") return "revision";
  return remaining <= 86400000 ? "soon" : null;
}

export function buildPublication(kind: "roster" | "awards", theme: z.infer<typeof themeSchema>, people: {
  id?: string; name: string; award: string; awardOrder: number; profile: unknown;
}[]): Publication {
  const entries = people.filter((person) => kind === "roster" || person.award)
    .sort((a, b) => (kind === "awards" ? a.awardOrder - b.awardOrder : 0) || a.name.localeCompare(b.name, "ko"))
    .map((person) => ({
      ...profileSchema.parse(person.profile), name: person.name,
      ...(kind === "awards" ? { award: person.award } : {}),
      ...(person.id ? { participantId: person.id } : {}),
    }));
  return { ...theme, entries };
}

export function removePublishedCreator(raw: unknown, person: { id: string; name: string; profile: unknown; award: string }): Publication | undefined {
  const parsed = publicationSchema.safeParse(raw);
  if (!parsed.success) return;
  const { entries } = parsed.data;
  const tagged = entries.findIndex((entry) => entry.participantId === person.id);
  if (tagged >= 0) return { ...parsed.data, entries: entries.filter((_, index) => index !== tagged) };

  // Older snapshots can only be matched against the public name and profile.
  const profile = profileSchema.safeParse(person.profile);
  if (!profile.success) return;
  const matches = entries.flatMap((entry, index) => !entry.participantId && entry.name === person.name &&
    (!entry.award || entry.award === person.award) &&
    profileSchema.keyof().options.every((key) => (entry[key] ?? "") === (profile.data[key] ?? "")) ? [index] : []);
  if (matches.length === 1) return { ...parsed.data, entries: entries.filter((_, index) => index !== matches[0]) };
}
