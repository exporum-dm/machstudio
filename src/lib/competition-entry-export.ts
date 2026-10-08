/**
 * 대회 참가작 내보내기 표 — 엑셀(.xlsx)·CSV 가 **같은 표**를 쓴다.
 *
 * 열 순서는 운영자가 보는 그대로: 참가번호·접수 시각·상태 → 신청 폼 항목(폼에 둔 순서) →
 * 반복 항목(팀원 등) → 사진·영상 링크 → 동의 → 라운드별 투표 수.
 * 신청 폼 항목은 참가작 상세(EntryDetailModal)와 같은 기준으로 고른다 — 화면과 파일이 갈리면
 * "상세에는 있는데 엑셀엔 없다" 가 된다.
 */
import { normalizeMedia, type CompetitionFormField } from "@/lib/competition-config";
import { formatKstDateTime } from "@/lib/datetime";

export interface ExportEntry {
  id: string;
  entryNo: string;
  title: string;
  teamName: string | null;
  summary: string | null;
  data: unknown;
  media: unknown;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  isPublished: boolean;
  advanced: boolean;
  agreePrivacy: boolean;
  agreeMarketing: boolean;
  agreeThirdParty: boolean;
  submittedAt: Date | string;
}

export interface ExportRound {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<string, string> = { submitted: "접수", approved: "승인", rejected: "반려" };

function valueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 참가번호를 숫자처럼 정렬한다 — "10" 이 "2" 앞에 오면 현장 명단 대조가 어렵다. */
function compareEntryNo(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "ko");
}

export function buildEntryExportTable(input: {
  fields: CompetitionFormField[];
  entries: ExportEntry[];
  rounds: ExportRound[];
  /** `${roundId}:${entryId}` → 표 수 */
  votes: Map<string, number>;
}): string[][] {
  const { fields, rounds, votes } = input;
  const answerFields = fields.filter((f) => f.enabled && f.type !== "image" && f.type !== "youtube" && f.type !== "repeater");
  const repeaterFields = fields.filter((f) => f.enabled && f.type === "repeater");

  const header = [
    "참가번호",
    "접수 시각 (KST)",
    "상태",
    "투표 노출",
    "본선 진출",
    "제목",
    "팀명",
    ...answerFields.map((f) => f.label || f.key),
    ...repeaterFields.flatMap((f) => [`${f.label || f.key} 인원`, `${f.label || f.key} 명단`]),
    "사진",
    "유튜브",
    "개인정보 수집·이용 동의",
    "마케팅 수신 동의",
    "제3자 제공 동의",
    ...rounds.map((r) => `투표 수 (${r.name})`),
  ];

  const rows = [...input.entries]
    .sort((a, b) => compareEntryNo(a.entryNo, b.entryNo))
    .map((entry) => {
      const data = (entry.data && typeof entry.data === "object" ? entry.data : {}) as Record<string, unknown>;
      const media = normalizeMedia(entry.media);
      const images = media.flatMap((m) => (m.kind === "image" ? [m.role === "logo" ? `${m.url} (로고)` : m.url] : []));
      const videos = media.flatMap((m) => (m.kind === "youtube" ? [`https://youtu.be/${m.videoId}`] : []));
      return [
        entry.entryNo,
        formatKstDateTime(entry.submittedAt),
        STATUS_LABEL[entry.status] ?? entry.status,
        entry.isPublished ? "O" : "X",
        entry.advanced ? "O" : "X",
        entry.title,
        entry.teamName ?? "",
        ...answerFields.map((f) => valueText(data[f.key])),
        ...repeaterFields.flatMap((f) => {
          const items = Array.isArray(data[f.key]) ? (data[f.key] as Record<string, unknown>[]) : [];
          const subs = f.subFields ?? [];
          // 한 칸에 한 사람씩 줄을 바꿔 적는다 — 엑셀에서 셀 안 줄바꿈으로 보인다.
          const list = items
            .map((row) => subs.map((sf) => valueText(row?.[sf.key])).filter(Boolean).join(" / "))
            .filter(Boolean)
            .join("\n");
          return [String(items.length), list];
        }),
        images.join("\n"),
        videos.join("\n"),
        entry.agreePrivacy ? "O" : "X",
        entry.agreeMarketing ? "O" : "X",
        entry.agreeThirdParty ? "O" : "X",
        ...rounds.map((r) => String(votes.get(`${r.id}:${entry.id}`) ?? 0)),
      ];
    });

  return [header, ...rows];
}
