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
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 720;
export const columnSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,64}$/), label, type, hidden: z.boolean().optional(),
  options: z.array(label).max(50).optional(),
  /** 표에서 이 열이 차지할 픽셀 너비. 지정하지 않으면 내용에 맞춘다. */
  width: z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH).optional(),
});
export type Column = z.infer<typeof columnSchema>;
export type Cells = z.infer<typeof cells>;

/**
 * 선발자·신청서 표의 **열 배치**. 발굴 후보 표와 달리 열 자체는 코드가 정한 고정 항목이라
 * (이름·연락처·참여 확정 …) 사용자가 정하는 건 순서·숨김·너비뿐이다.
 */
export const gridLayoutSchema = z.array(z.object({
  key: z.string().min(1).max(64),
  hidden: z.boolean().optional(),
  width: z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH).optional(),
})).max(80);
export type GridLayout = z.infer<typeof gridLayoutSchema>;
export const gridTables = ["people", "applicants"] as const;
export type GridTable = (typeof gridTables)[number];

/**
 * 코드가 정의한 열에 저장된 배치를 입힌다. 저장에 없는 열은 **뒤에 붙여** 새로 생긴 항목이
 * 조용히 사라지지 않게 하고, 저장에만 있는(코드에서 없어진) 열은 버린다.
 */
export function applyGridLayout<T extends { key: string; hidden?: boolean; width?: number }>(
  defined: readonly T[], raw: unknown,
): T[] {
  const parsed = gridLayoutSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.length) return [...defined];
  const byKey = new Map(defined.map((column) => [column.key, column]));
  const ordered: T[] = [];
  for (const saved of parsed.data) {
    const column = byKey.get(saved.key);
    if (!column) continue;
    byKey.delete(saved.key);
    ordered.push({ ...column, hidden: saved.hidden ?? false, width: saved.width });
  }
  return [...ordered, ...byKey.values()];
}

export function creatorGridLayout(raw: unknown, table: GridTable): unknown {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[table] : undefined;
}

/**
 * 연락 상태 기본 보기 — 한 사람이 거쳐 가는 단계 순서대로.
 *
 * 예전 보기(미연락·DM 발송·답변 대기·참여 의향 있음·참여 의향 없음)는 "무엇을 했나"와
 * "상대가 어떻게 답했나"가 섞여 있어 고를 때마다 헷갈렸다. 지금은 **지금 어디까지 왔나** 하나로
 * 읽는다. 회차마다 열 설정에서 보기를 바꿀 수 있다.
 */
export const contactStages = ["연락 전", "소통 중", "신청 링크 발송", "연락 완료", "연락 끊김"] as const;
/** 운영 흐름에서 "신청 링크를 보낼 때가 된" 단계. 표의 발송 기록 버튼이 이때 나온다. */
export const CONTACT_TALKING = contactStages[1];
export const CONTACT_LINK_SENT = contactStages[2];

export const baseColumns: Column[] = [
  { key: "name", label: "이름", type: "text" },
  { key: "platform", label: "SNS", type: "text" },
  { key: "handle", label: "계정", type: "text" },
  { key: "profileUrl", label: "프로필 링크", type: "url" },
  { key: "followers", label: "팔로워", type: "number" },
  { key: "avgViews", label: "평균 조회수", type: "number" },
  { key: "dmOn", label: "DM 발송일", type: "date" },
  { key: "interest", label: "연락 상태", type: "select", options: [...contactStages] },
  { key: "owner", label: "담당자", type: "text" },
  { key: "rank", label: "우선순위", type: "text" },
  { key: "memo", label: "메모", type: "text" },
];

/**
 * 저장된 열 구성을 그대로 쓴다. 한 번 저장하고 나면 **기본 열도 지우고 이름을 바꿀 수 있다** —
 * 예전에는 저장 목록에 없는 기본 열을 뒤에 다시 붙여서, 지워도 되살아났다.
 *
 * 아직 한 번도 저장하지 않았으면(빈 배열·형식 오류) 기본 열로 시작한다.
 * 열을 지워도 `cells` 의 값은 남아 있어, 같은 key 로 열을 다시 만들면 값이 그대로 보인다.
 */
export function creatorColumns(raw: unknown): Column[] {
  const stored = z.array(columnSchema).safeParse(raw);
  return stored.success && stored.data.length ? stored.data : baseColumns;
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
const publicationFields = z.array(z.string().min(1).max(200)).max(100);
const publicAnswer = z.object({ label: z.string().max(500), value: details });
export const publicationSchema = themeSchema.extend({
  applicationFields: publicationFields.optional(),
  entries: z.array(profileSchema.extend({
    name: label, award: z.string().max(160).optional(), participantId: id.optional(), answers: z.array(publicAnswer).optional(),
  })),
});
export type Publication = z.infer<typeof publicationSchema>;
export const creatorAccessEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const creatorDriveFolder = webUrl.refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && url.hostname === "drive.google.com" && /^\/(?:drive\/(?:u\/\d+\/)?)?folders\/[\w-]+\/?$/.test(url.pathname);
}, "Google Drive 폴더 주소를 입력해 주세요.");
export const creatorDriveFile = webUrl.refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && url.hostname === "drive.google.com" && (/^\/file\/d\/[\w-]+(?:\/|$)/.test(url.pathname) ||
    (["/open", "/uc"].includes(url.pathname) && /^[\w-]+$/.test(url.searchParams.get("id") ?? "")));
}, "Google Drive에 올린 영상의 파일 링크를 입력해 주세요.");

export const missionSchema = z.object({
  title: label, guide: details, startsAt: z.iso.datetime().nullable(), dueAt: z.iso.datetime().nullable(),
  published: z.boolean().default(true), driveProof: z.enum(["off", "optional", "required"]).default("off"),
  platforms: z.array(platform).min(1).max(platforms.length), linkCount: z.number().int().min(0).max(10),
  proof: z.enum(["off", "optional", "required"]), draft: z.boolean(),
}).refine((mission) => !mission.startsAt || !mission.dueAt || mission.startsAt < mission.dueAt,
  { path: ["dueAt"], message: "마감은 게시 시작 이후로 설정해 주세요." })
  .refine((mission) => mission.draft || mission.linkCount > 0 || mission.proof === "required" || mission.driveProof === "required",
    { path: ["linkCount"], message: "게시 링크, 원본 링크, 증빙 파일 중 필수 항목을 하나 이상 설정해 주세요." })
  .refine((mission) => !mission.draft || mission.linkCount > 0,
    { path: ["linkCount"], message: "초안 검수를 사용하는 미션은 최종 게시 링크를 하나 이상 받아야 해요." });

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createApplicationForm") }),
  z.object({ action: z.literal("settings"), name: label, applicationSourceId: id.nullable(), registrationSourceId: id.nullable(), utm: utmSchema }),
  z.object({ action: z.literal("columns"), columns: z.array(columnSchema).max(80) }),
  z.object({ action: z.literal("candidateAdd"), rows: z.array(cells).min(1).max(250) }),
  z.object({ action: z.literal("candidateEdit"), id, key: z.string(), value: cell }),
  z.object({ action: z.literal("candidateDelete"), id }),
  z.object({ action: z.literal("candidateReorder"), ids: z.array(id).min(1).max(2000) }),
  z.object({ action: z.literal("gridLayout"), table: z.enum(gridTables), layout: gridLayoutSchema }),
  z.object({ action: z.literal("select"), applicationId: id, name: label, channels: z.partialRecord(platform, z.string().trim().max(160)) }),
  z.object({ action: z.literal("participant"), id, patch: z.object({
    name: label.optional(), confirmed: z.boolean().optional(), channels: z.partialRecord(platform, z.string().trim().max(160)).optional(),
    completed: z.boolean().optional(), awardSelected: z.boolean().optional(),
    profile: profileSchema.optional(), feeStatus: z.enum(["unpaid", "scheduled", "paid"]).optional(), paidOn: date.nullable().optional(),
    owner: z.string().trim().max(160).optional(), contact: z.string().trim().max(400).optional(),
    accessEmail: creatorAccessEmail.nullable().optional(), driveFolder: creatorDriveFolder.nullable().optional(),
    award: z.string().trim().max(160).optional(), awardOrder: z.number().int().min(0).max(10000).optional(),
  }) }),
  z.object({ action: z.literal("rotateAccess"), id }),
  z.object({ action: z.literal("unselect"), id, token: z.string().regex(/^cp_[A-Za-z0-9_-]{32}$/) }),
  z.object({ action: z.literal("mission"), id: id.optional(), mission: missionSchema }),
  z.object({ action: z.literal("archiveMission"), id, archived: z.boolean() }),
  z.object({ action: z.literal("review"), id, version: z.number().int(), approved: z.boolean(), feedback: details }),
  z.object({ action: z.literal("contact"), id, channel: z.string().trim().min(1).max(50) }),
  z.object({ action: z.literal("publish"), kind: z.enum(["roster", "awards"]), theme: themeSchema.nullable(), applicationFields: publicationFields.optional() }),
]);
export type CreatorAction = z.infer<typeof actionSchema>;

export const submissionSchema = z.object({
  version: z.number().int(), platform, links: z.array(webUrl).max(10), driveUrl: creatorDriveFile.optional(), files: z.array(id).max(5), note: details,
});

export function missionSubmissionFields(stage: string, mission: {
  draft: boolean; linkCount: number; proof: string; driveProof: string;
}, history?: unknown) {
  if (stage === "draft") return { linkCount: 0, drive: "required", proof: "off", note: "caption" };
  const approvedDraft = Array.isArray(history) && (history as HistoryEntry[])
    .some(({ kind, stage }) => kind === "approved" && stage === "draft");
  if (mission.draft || approvedDraft) return { linkCount: Math.max(1, mission.linkCount), drive: "off", proof: "off", note: "off" };
  return { linkCount: mission.linkCount, drive: mission.driveProof, proof: mission.proof, note: "optional" };
}

export function validateMissionSubmission(fields: ReturnType<typeof missionSubmissionFields>, submission: {
  platform: string; links: string[]; driveUrl?: string; files: unknown[]; note: string;
}) {
  const wrongInstagramLink = fields.note === "off" && submission.platform === "instagram" &&
    submission.links.some((link) => !webUrl.safeParse(link).success || !/(^|\.)instagram\.com$/i.test(new URL(link).hostname));
  return {
    ...(new Set(submission.links).size < fields.linkCount ? { links: "서로 다른 게시 링크 " + fields.linkCount + "개를 입력해 주세요." } :
      fields.linkCount === 0 && submission.links.length ? { links: "이 단계는 게시 링크를 받지 않아요." } :
      wrongInstagramLink ? { links: "인스타그램에서 복사한 게시 링크를 입력해 주세요." } : {}),
    ...(fields.drive === "required" && !submission.driveUrl ? { drive: "Drive 원본 영상 링크를 입력해 주세요." } :
      fields.drive === "off" && submission.driveUrl ? { drive: "이 단계는 Drive 원본 영상 링크를 받지 않아요." } : {}),
    ...(fields.proof === "required" && !submission.files.length ? { files: "증빙 파일을 첨부해 주세요." } :
      fields.proof === "off" && submission.files.length ? { files: "이 단계는 증빙 파일 첨부를 받지 않아요." } : {}),
    ...(fields.note === "caption" && !submission.note.trim() ? { note: "게시물에 사용할 캡션을 입력해 주세요." } :
      fields.note === "off" && submission.note.trim() ? { note: "이 단계는 게시 링크만 받아요." } : {}),
  };
}

export type HistoryEntry =
  | { kind: "submission"; stage: string; at: string; platform: string; links: string[]; driveUrl?: string; files: string[]; note: string }
  | { kind: "approved" | "revision" | "withdrawn"; stage: string; at: string; feedback: string };

export function reviewState(assignment: { stage: string; status: string }, approved: boolean) {
  if (assignment.status !== "review") return null;
  if (!approved) return { stage: assignment.stage, status: "revision" };
  return assignment.stage === "draft" ? { stage: "final", status: "todo" } : { stage: "final", status: "done" };
}

export function workQueue(assignment: { status: string; mission: { dueAt: string | Date | null } }, now: number) {
  if (assignment.status === "review") return "review";
  if (assignment.status === "done") return null;
  const remaining = assignment.mission.dueAt === null ? Infinity : new Date(assignment.mission.dueAt).getTime() - now;
  if (remaining < 0) return "overdue";
  if (assignment.status === "revision") return "revision";
  return remaining <= 86400000 ? "soon" : null;
}

export function isCreatorAwarded(person: { award: string; awardSelected?: boolean | null }) {
  // Existing awards used the presence of an award title as the selection flag.
  return person.awardSelected ?? Boolean(person.award.trim());
}

export function buildPublication(kind: "roster" | "awards", theme: z.infer<typeof themeSchema>, people: {
  id?: string; name: string; award: string; awardSelected?: boolean | null; awardOrder: number; profile: unknown;
  applicationId?: string | null; applicationData?: unknown;
}[], selected: string[] = [], labels: Record<string, string> = {}): Publication {
  const applicationFields = [...new Set(selected)].filter((key) => !key.startsWith("__") && Object.hasOwn(labels, key));
  const entries = people.filter((person) => kind === "roster" || isCreatorAwarded(person))
    .sort((a, b) => (kind === "awards" ? a.awardOrder - b.awardOrder : 0) || a.name.localeCompare(b.name, "ko"))
    .map((person) => {
      const data = person.applicationData as Record<string, unknown> | undefined;
      const answers = applicationFields.flatMap((key) => {
        if (!data || !Object.hasOwn(data, key)) return [];
        const raw = data[key];
        const parts = Array.isArray(raw) ? raw : [raw];
        const value = parts.filter((item) => ["string", "number", "boolean"].includes(typeof item)).join(", ").trim();
        return value ? [{ label: labels[key].slice(0, 500), value: value.slice(0, 10000) }] : [];
      });
      return {
        ...(person.applicationId ? { answers } : profileSchema.parse(person.profile)),
        name: person.name,
        ...(kind === "awards" ? { award: person.award.trim() || "우수자" } : {}),
        ...(person.id ? { participantId: person.id } : {}),
      };
    });
  return { ...theme, applicationFields, entries };
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
