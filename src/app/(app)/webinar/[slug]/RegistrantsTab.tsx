"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Edit3,
  FileText,
  Loader2,
  Plus,
  Save,
  MessageCircleQuestion,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { formatKst } from "@/lib/datetime";
import { parseMemo } from "@/lib/webinar-memo";
import { formatSurveyAnswer, isEmptySurveyAnswer, type SurveyQuestion } from "@/lib/webinar-survey";
import { qaStatusLabel } from "@/lib/webinar-qa";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

type SortKey =
  | "name"
  | "phone"
  | "email"
  | "company"
  | "department"
  | "jobTitle"
  | "industry"
  | "agreeMarketing"
  | "enteredAt"
  | "lastPingAt"
  | "stayMinutes"
  | "submittedAt"
  | "isActive"
  // 참여 점수 정렬 — DB 컬럼이 아니라 서버가 조립하는 값이다(라우트가 별도 경로로 처리).
  | "score";
type SortDir = "asc" | "desc";
type DuplicateMode = "skip" | "include" | "update";

/** 리드 세그먼트 — 참여 점수에서 파생. 명단에서 팔로업 대상을 좁히는 필터로 쓴다. */
type SegmentKey = "hot" | "warm" | "cold" | "noShow";
const SEGMENT_META: Record<SegmentKey, { label: string; cls: string; hint: string }> = {
  hot: { label: "핫", cls: "bg-green-500/10 text-green-600 dark:text-green-400", hint: "65점 이상 — 끝까지 보면서 행동이나 마케팅 동의가 있는 리드" },
  warm: { label: "웜", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400", hint: "30~64점 — 참석했지만 반응이 적거나 중간에 이탈" },
  cold: { label: "콜드", cls: "bg-secondary text-muted-foreground", hint: "30점 미만 — 잠깐 들렀다 나간 경우" },
  noShow: { label: "노쇼", cls: "bg-secondary text-muted-foreground", hint: "등록했지만 입장하지 않음" },
};

interface Registration {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  department: string | null;
  jobTitle: string | null;
  industry: string | null;
  agreeMarketing: boolean;
  agreePrivacy: boolean;
  agreeThirdParty: boolean;
  memo: string | null;
  stayMinutes: number;
  connectedSeconds: number;
  focusSeconds: number;
  isActive: boolean;
  // isActive 는 heartbeat 가 세운 뒤 leave 이벤트가 안 오면(탭 강제종료 등) 영원히 true 로 남는다
  // — 서버가 최근성(5분 창)까지 반영해 계산해 준 값. 상태 열은 이 값으로 그린다.
  isLive?: boolean;
  /** 참여 점수(0~100)와 세그먼트 — 서버가 조립해 행에 붙여 보낸다. */
  score?: number;
  segment?: SegmentKey;
  scoreBreakdown?: { attend: number; watch: number; interact: number; interactRaw: number; intent: number; evaluatedMinutes: number } | null;
  submittedAt: string;
  enteredAt: string | null;
  lastPingAt: string | null;
  // 유입 경로 — 상세 패널이 보여준다(저장은 하는데 화면 어디에도 안 나오던 값).
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  firstUtmSource?: string | null;
  firstUtmMedium?: string | null;
  firstUtmCampaign?: string | null;
  referrer?: string | null;
  surveyResponses: SurveyResponse[];
  qaItems: QAItem[];
}

interface Survey {
  id: string;
  title: string;
  questions: SurveyQuestion[];
}

/** 이 사람이 라이브 중 남긴 문의. 등록과 연결된 것만 온다(익명 문의는 운영 콘솔에서 본다). */
interface QAItem {
  id: string;
  registrationId: string;
  question: string;
  status: string;
  /** 표시번호(실제 세션만 1..N). 오프닝·휴식·클로징을 가리키거나 미지정이면 null — 라우트가 변환해 준다. */
  sessionNo: number | null;
  voteCount: number;
  createdAt: string;
}

interface SurveyResponse {
  surveyId: string;
  registrationId: string;
  answers: Record<string, unknown>;
  source: string | null;
  submittedAt: string;
}

interface RegistrationDraft {
  name: string;
  phone: string;
  email: string;
  company: string;
  department: string;
  jobTitle: string;
  industry: string;
  agreeMarketing: boolean;
  memo: string;
}

interface RegistrationDetailDraft extends RegistrationDraft {
  agreePrivacy: boolean;
  agreeThirdParty: boolean;
}

const emptyDraft: RegistrationDraft = {
  name: "",
  phone: "",
  email: "",
  company: "",
  department: "",
  jobTitle: "",
  industry: "",
  agreeMarketing: false,
  memo: "",
};

const sortLabels: Record<SortKey, string> = {
  name: "이름",
  phone: "연락처",
  email: "이메일",
  company: "회사",
  department: "부서",
  jobTitle: "직함",
  industry: "업종",
  agreeMarketing: "마케팅",
  enteredAt: "최초 입장",
  lastPingAt: "마지막 신호",
  stayMinutes: "접속",
  submittedAt: "등록일",
  isActive: "상태",
  score: "참여점수",
};

const headerAliases: Record<keyof RegistrationDraft, string[]> = {
  name: ["이름", "성함", "성명", "이름/성함", "참가자명", "고객명", "name", "fullname", "full name"],
  phone: ["연락처", "휴대폰", "핸드폰", "전화", "전화번호", "휴대전화", "phone", "mobile", "tel"],
  email: ["이메일", "이메일주소", "메일", "email", "e-mail", "mail"],
  company: ["회사", "소속", "기관", "회사명", "company"],
  department: ["부서", "department", "dept"],
  jobTitle: ["직함", "직책", "직급", "job", "position", "title"],
  industry: ["업종", "산업", "관심분야", "industry"],
  agreeMarketing: ["마케팅", "수신", "marketing", "agree"],
  memo: ["메모", "사전질문", "질문", "memo", "question"],
};

function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const normalized = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function cleanHeader(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, "").toLowerCase();
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  const clean = headers.map(cleanHeader);
  return clean.findIndex((header) => aliases.some((alias) => header.includes(cleanHeader(alias))));
}

// 마케팅 수신 동의 파싱 — 부분문자열 검사는 뜻을 뒤집는다.
// 예전 구현은 ["y","yes","true","1","동의","수신"].some(t => text.includes(t)) 였다. 그래서
//   '미동의'.includes('동의') → true,  '수신거부'.includes('수신') → true,  '동의하지 않음' → true
// 즉 **거부한 사람이 동의로 들어왔다**. 동의 여부는 되돌리기 어려운 법적 상태라
// (1) 부정 표현을 먼저 배제하고 (2) 긍정은 정확 일치로만 인정한다. 애매하면 false(미동의).
const NEGATIVE_CONSENT = /(미동의|비동의|동의하지|미수신|수신거부|거부|반대|아니|없음|no|false)/;
const POSITIVE_CONSENT = new Set([
  "y", "yes", "true", "1", "o", "ok",
  "동의", "수신동의", "동의함", "수신", "예", "네", "허용", "찬성",
]);
function parseBoolean(value: string) {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (NEGATIVE_CONSENT.test(text)) return false; // 부정이 먼저다 — '미동의' 가 '동의'로 읽히지 않게
  return POSITIVE_CONSENT.has(text.replace(/\s+/g, ""));
}

function rowsToDrafts(rows: string[]) {
  return {
    name: rows[0] ?? "",
    phone: rows[1] ?? "",
    email: rows[2] ?? "",
    company: rows[3] ?? "",
    department: rows[4] ?? "",
    jobTitle: rows[5] ?? "",
    industry: rows[6] ?? "",
    agreeMarketing: parseBoolean(rows[7] ?? ""),
    memo: rows[8] ?? "",
  };
}

// 헤더 없이 붙여넣을 때의 열 순서 — rowsToDrafts 와 같은 순서여야 한다.
const POSITIONAL_FIELDS = [
  "name", "phone", "email", "company", "department", "jobTitle", "industry", "agreeMarketing", "memo",
] as const;

/**
 * 붙여넣은 텍스트를 등록 초안으로 바꾼다.
 *
 * rows 만으로는 부족해서 providedFields 를 함께 돌려준다 — "CSV 에 그 열이 있었는가" 를 서버가
 * 알아야 하기 때문이다. 중복=업데이트 모드에서 초안 객체를 통째로 update 에 넘기면, CSV 에 없던
 * 열이 빈 문자열·false 로 채워져 **기존 값을 지운다**(특히 마케팅 수신 동의가 조용히 꺼진다).
 * 열이 있었던 필드만 서버가 갱신하도록 목록을 같이 보낸다.
 */
function parseBulkText(text: string): { rows: RegistrationDraft[]; providedFields: string[] } {
  const rows = parseCSV(text);
  if (!rows.length) return { rows: [], providedFields: [] };

  const headers = rows[0] ?? [];
  const nameIndex = findHeaderIndex(headers, headerAliases.name);
  const hasHeader = nameIndex > -1;

  if (!hasHeader) {
    // 위치 기반 — 실제로 붙여넣은 열 수까지만 "제공됨" 으로 본다.
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      rows: rows.map(rowsToDrafts).filter((row) => row.name.trim()),
      providedFields: POSITIONAL_FIELDS.slice(0, width) as unknown as string[],
    };
  }

  const indexes = {
    name: findHeaderIndex(headers, headerAliases.name),
    phone: findHeaderIndex(headers, headerAliases.phone),
    email: findHeaderIndex(headers, headerAliases.email),
    company: findHeaderIndex(headers, headerAliases.company),
    department: findHeaderIndex(headers, headerAliases.department),
    jobTitle: findHeaderIndex(headers, headerAliases.jobTitle),
    industry: findHeaderIndex(headers, headerAliases.industry),
    agreeMarketing: findHeaderIndex(headers, headerAliases.agreeMarketing),
    memo: findHeaderIndex(headers, headerAliases.memo),
  };

  return {
    providedFields: Object.entries(indexes).filter(([, i]) => i > -1).map(([k]) => k),
    rows: rows.slice(1).map((row) => ({
    name: indexes.name > -1 ? row[indexes.name] ?? "" : "",
    phone: indexes.phone > -1 ? row[indexes.phone] ?? "" : "",
    email: indexes.email > -1 ? row[indexes.email] ?? "" : "",
    company: indexes.company > -1 ? row[indexes.company] ?? "" : "",
    department: indexes.department > -1 ? row[indexes.department] ?? "" : "",
    jobTitle: indexes.jobTitle > -1 ? row[indexes.jobTitle] ?? "" : "",
    industry: indexes.industry > -1 ? row[indexes.industry] ?? "" : "",
    agreeMarketing: indexes.agreeMarketing > -1 ? parseBoolean(row[indexes.agreeMarketing] ?? "") : false,
    memo: indexes.memo > -1 ? row[indexes.memo] ?? "" : "",
    })).filter((row) => row.name.trim()),
  };
}

function formatDate(value: string | null) {
  if (!value) return "-";
  // KST 고정 — 관리자 브라우저 타임존과 무관하게 일관된 표시
  return formatKst(value, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(value: string | null) {
  if (!value) return "-";
  return formatKst(value, { month: "2-digit", day: "2-digit" });
}

// 접속 시간(분) — ping 간격 누적값이 단일 소스. 0 이면 이 컬럼 도입 전 데이터라 옛 스팬으로 폴백.
function connectedMin(r: { connectedSeconds?: number; stayMinutes: number }) {
  return (r.connectedSeconds ?? 0) > 0 ? Math.floor((r.connectedSeconds as number) / 60) : r.stayMinutes;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const stateLabel = active ? (dir === "asc" ? "오름차순 정렬됨" : "내림차순 정렬됨") : "정렬 안 됨";

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`${label}, ${stateLabel}. 눌러서 정렬`}
      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-violet-500" : ""}`}
      title={`${label} ${active && dir === "asc" ? "오름차순" : "내림차순"} 정렬`}
    >
      {label}
      <Icon className="w-3 h-3" />
    </button>
  );
}

export default function RegistrantsTab({ webinarId }: { webinarId: string }) {
  const confirm = useConfirm();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<{ registered: number; entered: number; active: number; surveyResponded: number; segments?: Record<SegmentKey, number> } | null>(null);
  /* 점수 열·세그먼트 필터는 방송 전에 숨긴다 — 그 시점엔 전원이 노쇼라 열이 의미가 없다
     (분석 탭 '확보한 리드' 와 같은 규칙). 서버가 phase 를 판정해 내려준다. */
  const [scoringMeta, setScoringMeta] = useState<{ phase: "before" | "live" | "ended"; liveMinutes: number; scheduledMinutes: number } | null>(null);
  const [segmentFilter, setSegmentFilter] = useState<SegmentKey | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("submittedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showManual, setShowManual] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [manual, setManual] = useState<RegistrationDraft>(emptyDraft);
  const [bulkText, setBulkText] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState<Registration | null>(null);
  const [detailDraft, setDetailDraft] = useState<RegistrationDetailDraft | null>(null);
  // 일괄등록 실패 행 — 개수만이 아니라 원인·행 번호를 모달에 남겨 수정 가능하게
  const [bulkErrors, setBulkErrors] = useState<{ index?: number; message: string }[]>([]);
  // 선택 등록자(체크박스) — 현재 보고 있는 목록 기준(뷰가 바뀌면 초기화)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const modalOpen = showManual || showBulk || Boolean(selectedRegistration);
  // 현재 열린 대화상자 컨테이너 — 포커스 트랩·초기 포커스 대상
  const dialogRef = useRef<HTMLElement | null>(null);

  const fetchRegistrations = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      });
      if (search) params.set("q", search);
      if (segmentFilter) params.set("segment", segmentFilter);
      const res = await fetch(`/api/webinars/${webinarId}/registrations?${params}`);
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      const responsesByRegistration = new Map<string, SurveyResponse[]>();
      for (const response of data.surveyResponses ?? []) {
        if (!response.registrationId) continue;
        const current = responsesByRegistration.get(response.registrationId) ?? [];
        current.push(response);
        responsesByRegistration.set(response.registrationId, current);
      }
      const qaByRegistration = new Map<string, QAItem[]>();
      for (const item of data.qaItems ?? []) {
        if (!item.registrationId) continue;
        const current = qaByRegistration.get(item.registrationId) ?? [];
        current.push(item);
        qaByRegistration.set(item.registrationId, current);
      }
      const rows: Registration[] = (data.registrations ?? []).map((registration: Omit<Registration, "surveyResponses" | "qaItems">) => ({
        ...registration,
        surveyResponses: responsesByRegistration.get(registration.id) ?? [],
        qaItems: qaByRegistration.get(registration.id) ?? [],
      }));
      setRegistrations(rows);
      setTotal(data.total ?? 0);
      if (data.stats) setStats(data.stats);
      if (data.scoring) setScoringMeta(data.scoring);
      setSurveys(data.surveys ?? []);
      // 선택은 항상 현재 보이는 목록으로 한정 — 새로고침으로 사라진(다른 페이지로 밀린/삭제된) 행은
      // 선택에서 자동 제거해, 보이지 않는 행이 선택된 채 일괄 삭제되는 일을 막는다.
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const visible = new Set(rows.map((r) => r.id));
        const next = new Set([...prev].filter((id) => visible.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch {
      // 로드 실패를 '등록자 없음'으로 위장하지 않음 — 재시도 경로 제공
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [webinarId, page, pageSize, search, sortBy, sortDir, segmentFilter]);

  // 일괄등록 모달을 닫으면 실패 행 목록 초기화 — 다음에 열 때 깨끗하게
  useEffect(() => { if (!showBulk) setBulkErrors([]); }, [showBulk]);

  useEffect(() => { void Promise.resolve().then(fetchRegistrations); }, [fetchRegistrations]);

  const allOnPageSelected = registrations.length > 0 && registrations.every((r) => selectedIds.has(r.id));
  const toggleAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) registrations.forEach((r) => next.delete(r.id));
      else registrations.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!(await confirm({ title: `선택한 ${ids.length}명을 삭제할까요?`, description: "삭제한 등록자는 되돌릴 수 없어요.", confirmLabel: "삭제", tone: "danger" }))) return;
    setIsBulkDeleting(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/registrations/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "삭제 실패"); return; }
      toast.success(`${data.deleted ?? ids.length}명을 삭제했어요`);
      setSelectedIds(new Set());
      if (selectedRegistration && ids.includes(selectedRegistration.id)) { setSelectedRegistration(null); setDetailDraft(null); }
      await fetchRegistrations();
    } finally {
      setIsBulkDeleting(false);
    }
  };

  /**
   * 명단 CSV 받기 — 전체·선택 두 버튼이 같은 일을 한다.
   *
   * 미연결 안내가 여기 있는 이유: 명단은 1행=1명 표라서, 등록과 연결되지 않은 설문 응답·문의
   * (공유 링크로 답한 사람, 미검증 시청자)는 붙일 행이 없다. 파일에서 조용히 빠지면
   * "설문 40건이라던데 파일엔 37명" 이 되어 숫자를 못 믿게 되므로, 서버가 헤더로 알려준
   * 개수를 그 자리에서 말한다(본문 끝에 열 수가 다른 블록을 붙이면 피벗이 깨진다).
   */
  const downloadRegistrantsCsv = async (query: string, filename: string) => {
    const res = await fetch(`/api/webinars/${webinarId}/registrations/export${query}`);
    // 403(권한 없음) 등 서버가 알려준 사유를 그대로 보여준다 — "실패"만 뜨면 원인을 알 수 없다.
    if (!res.ok) {
      const msg = await res.json().then((d) => d?.error).catch(() => null);
      toast.error(msg || "내보내기 실패");
      return;
    }
    const unlinkedSurveys = Number(res.headers.get("X-Mach-Unlinked-Surveys") ?? 0);
    const unlinkedQa = Number(res.headers.get("X-Mach-Unlinked-Qa") ?? 0);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    const unlinked = [
      unlinkedSurveys > 0 ? `설문 응답 ${unlinkedSurveys}건` : null,
      unlinkedQa > 0 ? `문의 ${unlinkedQa}건` : null,
    ].filter(Boolean);
    if (unlinked.length) {
      toast.info(`${unlinked.join(" · ")}은 등록자와 연결되지 않아 명단에 없어요`, {
        description: "공유 링크로 답하거나 미검증 상태로 남긴 것들이에요.",
      });
    }
  };

  const handleExportSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    await downloadRegistrantsCsv(
      `?ids=${encodeURIComponent(ids.join(","))}`,
      `registrations-${webinarId}-selected.csv`,
    );
  };

  useEffect(() => {
    if (!modalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 모달을 닫을 때 원래 위치로 포커스를 되돌리기 위해 저장
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = () => {
      const root = dialogRef.current;
      if (!root) return [] as HTMLElement[];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    // 모달이 열리면 첫 포커스를 대화상자 안(첫 입력 또는 닫기 버튼)으로 이동
    const focusTimer = window.setTimeout(() => {
      const focusables = getFocusable();
      (focusables[0] ?? dialogRef.current)?.focus();
    }, 0);

    const closeModal = () => {
      setShowManual(false);
      setShowBulk(false);
      setSelectedRegistration(null);
      setDetailDraft(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      // 중첩 대화상자(공용 confirm: role="dialog" aria-modal)가 열려 있으면 그쪽이 포커스를 관리 —
      // 이 문서 레벨 트랩이 confirm 의 포커스를 배경 드로어로 뺏지 않게 바로 양보.
      const activeEl = document.activeElement as HTMLElement | null;
      // 우리 모달(dialogRef 패널을 감싸는 오버레이)이 아닌 다른 모달(중첩 confirm)에 포커스가 있을 때만 양보.
      // dialogRef 는 내부 패널이고 role=dialog 는 오버레이라 단순 !== 비교는 우리 트랩까지 꺼버렸다.
      const nestedModal = activeEl?.closest('[role="dialog"],[role="alertdialog"],[aria-modal="true"]');
      if (nestedModal && dialogRef.current && !nestedModal.contains(dialogRef.current)) return;

      const focusables = getFocusable();
      if (!focusables.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // 포커스가 대화상자 밖에 있으면 다시 안으로 끌어온다
      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      // 처음/마지막에서 감싸도록(wrap-around) Tab 순환을 대화상자 안에 가둔다
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
      previouslyFocused?.focus?.();
    };
  }, [modalOpen]);

  // 상세 패널의 읽기 전용 커스텀 답변 — memo 컬럼에서 분해해 온다(편집 대상 아님).
  const detailCustomFields = useMemo(
    () => parseMemo(selectedRegistration?.memo ?? null).customFields,
    [selectedRegistration],
  );
  const bulkParsed = useMemo(() => parseBulkText(bulkText), [bulkText]);
  /* 이 페이지에 문의가 하나라도 있나 — 문의 열을 켤지 판단한다. 페이지 단위인 이유:
     목록 API 가 현재 페이지 등록자분만 문의를 내려주므로, 전체 기준으로 켜려면
     별도 집계가 필요하다. 문의가 있는 페이지에서만 열이 나타나는 건 명단이 넓어지지
     않는다는 이점이 더 크다고 봤다. */
  const hasAnyQa = useMemo(() => registrations.some((r) => r.qaItems.length > 0), [registrations]);
  const parsedBulk = bulkParsed.rows;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 마지막 페이지의 마지막 항목을 지우면 page 가 범위를 벗어나 가짜 '등록자 없음' 빈 화면에 갇힌다 — 범위 밖이면 마지막 페이지로 당김.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const handleSort = (key: SortKey) => {
    setPage(1);
    if (sortBy === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(["name", "phone", "email", "company", "department", "jobTitle", "industry"].includes(key) ? "asc" : "desc");
    }
  };

  const handleExport = () => downloadRegistrantsCsv("", `registrations-${webinarId}.csv`);

  const submitManual = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration: manual, duplicateMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? data.errors?.[0]?.message ?? "등록 실패");
        return;
      }
      toast.success(`등록 완료 · 신규 ${data.created}명, 갱신 ${data.updated}명, 제외 ${data.skipped}명`);
      setManual(emptyDraft);
      setShowManual(false);
      setPage(1);
      await fetchRegistrations();
    } finally {
      setIsSaving(false);
    }
  };

  const submitBulk = async () => {
    if (!parsedBulk.length) {
      toast.error("등록 가능한 데이터가 없어요");
      return;
    }

    setIsSaving(true);
    setBulkErrors([]);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // providedFields — CSV 에 실제로 있던 열만 서버가 갱신한다(중복=업데이트 모드에서
        // 없던 열이 빈 값으로 기존 데이터를 덮어쓰지 않게).
        body: JSON.stringify({ registrations: parsedBulk, duplicateMode, providedFields: bulkParsed.providedFields }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.created && !data.updated && !data.skipped) {
        toast.error(data.error ?? data.errors?.[0]?.message ?? "일괄등록 실패");
        if (Array.isArray(data.errors)) setBulkErrors(data.errors);
        return;
      }
      toast.success(`일괄등록 완료 · 신규 ${data.created}명, 갱신 ${data.updated}명, 제외 ${data.skipped}명`);
      setPage(1);
      await fetchRegistrations();
      if (Array.isArray(data.errors) && data.errors.length) {
        // 실패 행은 모달에 남겨 원인 확인 후 수정·재등록할 수 있게 (모달 유지)
        setBulkErrors(data.errors);
      } else {
        setBulkText("");
        setShowBulk(false);
      }
    } catch {
      toast.error("일괄등록에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRegistration = async (registration: Registration) => {
    if (!(await confirm({ title: "등록자를 삭제할까요?", description: `"${registration.name}"`, confirmLabel: "삭제", tone: "danger" }))) return;

    const res = await fetch(`/api/webinars/${webinarId}/registrations/${registration.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("삭제 실패");
      return;
    }
    toast.success("등록자를 삭제했어요");
    if (selectedRegistration?.id === registration.id) {
      setSelectedRegistration(null);
      setDetailDraft(null);
    }
    await fetchRegistrations();
  };

  const openRegistrationDetail = (registration: Registration) => {
    setSelectedRegistration(registration);
    setDetailDraft({
      name: registration.name,
      phone: registration.phone ?? "",
      email: registration.email ?? "",
      company: registration.company ?? "",
      department: registration.department ?? "",
      jobTitle: registration.jobTitle ?? "",
      industry: registration.industry ?? "",
      agreeMarketing: registration.agreeMarketing,
      agreePrivacy: registration.agreePrivacy,
      agreeThirdParty: registration.agreeThirdParty,
      // memo 컬럼은 { memo, customFields } JSON 이다 — 편집 칸에는 운영자 메모(note)만 넣는다.
      // 예전엔 JSON 원문이 그대로 들어가 저장 시 커스텀 답변까지 덮어썼다.
      memo: parseMemo(registration.memo).note,
    });
  };

  const closeRegistrationDetail = () => {
    setSelectedRegistration(null);
    setDetailDraft(null);
  };

  const saveRegistrationDetail = async () => {
    if (!selectedRegistration || !detailDraft) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/webinars/${webinarId}/registrations/${selectedRegistration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detailDraft),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "등록자 저장 실패");
        return;
      }
      toast.success("등록자 정보가 저장됐어요");
      // 등록 정보 PATCH 응답에는 설문 응답·문의를 싣지 않는다. 상세 패널을 열어 둔 채 저장해도
      // 이미 불러온 답변과 문의가 사라지지 않도록 그대로 보존한다.
      setSelectedRegistration((previous) =>
        previous
          ? { ...data.registration, surveyResponses: previous.surveyResponses, qaItems: previous.qaItems }
          : data.registration,
      );
      await fetchRegistrations();
    } finally {
      setIsSaving(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    // 한국 Excel 은 CSV 를 기본 CP949(EUC-KR)로 저장 — UTF-8 로 읽어 대체문자(�)가 나오면 EUC-KR 로 재디코딩.
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (text.includes("�")) {
      try { text = new TextDecoder("euc-kr").decode(buf); } catch { /* euc-kr 미지원 환경 — utf-8 결과 유지 */ }
    }
    setBulkText(text);
    setShowBulk(true);
  };

  const inputClass = "w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400";

  /* 방송 전에는 점수 열을 숨긴다 — 입장이 0 이라 전원 0점 노쇼가 되어 열이 오해만 만든다. */
  const showScore = scoringMeta ? scoringMeta.phase !== "before" : false;
  /** 점수 근거 툴팁 — 숫자만 보고 CSV 와 대조해야 했던 자리. */
  const scoreTitle = (r: Registration) => {
    const b = r.scoreBreakdown;
    if (!b) return "참여 점수";
    const capped = b.interactRaw > b.interact ? ` (원점수 ${b.interactRaw}, 30점에서 멈춤)` : "";
    const stay = Math.floor((r.connectedSeconds ?? 0) / 60);
    return `참석 ${b.attend} + 체류 ${b.watch} (${stay}/${b.evaluatedMinutes}분) + 행동 ${b.interact}${capped} + 인텐트 ${b.intent} = ${r.score ?? 0}점 · ${SEGMENT_META[r.segment ?? "noShow"].label}`;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div>
        <div>
          <h2 className="text-sm font-semibold">등록자 관리</h2>
          <p className="text-sm text-muted-foreground mt-1">
            총 {total.toLocaleString()}명 · {sortLabels[sortBy]} {sortDir === "asc" ? "오름차순" : "내림차순"}
          </p>
        </div>
      </div>

      {stats && (
        <div className={`grid grid-cols-2 gap-3 ${surveys.length ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground">사전 등록</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.registered.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground">입장</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.entered.toLocaleString()}</div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">입장률 {stats.registered > 0 ? Math.round((stats.entered / stats.registered) * 100) : 0}%</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground">현재 시청</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-green-600 dark:text-green-400">{stats.active.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground">미입장</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{Math.max(0, stats.registered - stats.entered).toLocaleString()}</div>
          </div>
          {surveys.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-[11px] text-muted-foreground">설문 참여</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-violet-600 dark:text-violet-400">{stats.surveyResponded.toLocaleString()}</div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">참여율 {stats.registered > 0 ? Math.round((stats.surveyResponded / stats.registered) * 100) : 0}%</div>
            </div>
          )}
        </div>
      )}

      {/* 세그먼트 필터 — 리드 스코어링이 분석 탭과 CSV 에만 있어서, 정작 팔로업하는 이 화면에서
          "핫 리드만 보기" 가 불가능했다. 방송 전에는 전원 노쇼라 필터가 무의미해 숨긴다. */}
      {scoringMeta && scoringMeta.phase !== "before" && stats?.segments && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] text-muted-foreground">리드 세그먼트</span>
          <motion.button
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => { setSegmentFilter(null); setPage(1); }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${segmentFilter === null ? "bg-foreground text-background" : "border border-border hover:bg-secondary"}`}
          >
            전체 {stats.registered.toLocaleString()}
          </motion.button>
          {(Object.keys(SEGMENT_META) as SegmentKey[]).map((key) => {
            const count = stats.segments![key] ?? 0;
            const on = segmentFilter === key;
            return (
              <motion.button
                key={key}
                whileTap={{ scale: 0.96 }}
                transition={spring}
                onClick={() => { setSegmentFilter(on ? null : key); setPage(1); }}
                title={SEGMENT_META[key].hint}
                disabled={count === 0 && !on}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${on ? "bg-foreground text-background" : "border border-border hover:bg-secondary"}`}
              >
                {SEGMENT_META[key].label} {count.toLocaleString()}
              </motion.button>
            );
          })}
          {segmentFilter && (
            <span className="text-[11px] text-muted-foreground">· {SEGMENT_META[segmentFilter].hint}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 flex-wrap">
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={() => { setShowManual(true); setShowBulk(false); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs hover:bg-secondary transition-colors"
        >
          <Database className="w-3.5 h-3.5" />등록자 직접 추가
        </motion.button>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={() => { setShowBulk(true); setShowManual(false); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs hover:bg-secondary transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />일괄등록
        </motion.button>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs hover:bg-secondary transition-colors"
        >
          <Download className="w-3.5 h-3.5" />CSV 내보내기
        </motion.button>
        <div data-focus-shell className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-background w-full sm:w-[360px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="이름, 연락처, 이메일, 회사, 업종 검색"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
            className="min-w-0 flex-1 text-sm bg-transparent focus:outline-none"
          />
        </div>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={() => { setSearch(searchInput); setPage(1); }}
          className="px-3 py-2 rounded-xl border border-border text-xs hover:bg-secondary transition-colors"
        >
          검색
        </motion.button>
        {search && (
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
            className="px-3 py-2 rounded-xl border border-border text-xs hover:bg-secondary transition-colors text-muted-foreground"
          >
            초기화
          </motion.button>
        )}
      </div>

      <AnimatePresence>
      {showManual && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-registration-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowManual(false);
          }}
        >
          <motion.section
            ref={dialogRef}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={spring}
            className="w-full max-w-3xl max-h-[calc(100vh-48px)] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
              <div>
                <h3 id="manual-registration-title" className="text-sm font-semibold">등록자 직접 추가</h3>
                <p className="text-xs text-muted-foreground mt-1">운영자가 직접 등록자를 추가합니다.</p>
              </div>
              <motion.button
                whileHover={{ rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                transition={spring}
                onClick={() => setShowManual(false)}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                aria-label="닫기"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </motion.button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input className={inputClass} placeholder="이름 *" value={manual.name} onChange={(e) => setManual((p) => ({ ...p, name: e.target.value }))} />
                <input className={inputClass} placeholder="연락처 또는 이메일 중 하나 필요" value={manual.phone} onChange={(e) => setManual((p) => ({ ...p, phone: e.target.value }))} />
                <input className={inputClass} placeholder="이메일" value={manual.email} onChange={(e) => setManual((p) => ({ ...p, email: e.target.value }))} />
                <input className={inputClass} placeholder="회사" value={manual.company} onChange={(e) => setManual((p) => ({ ...p, company: e.target.value }))} />
                <input className={inputClass} placeholder="부서" value={manual.department} onChange={(e) => setManual((p) => ({ ...p, department: e.target.value }))} />
                <input className={inputClass} placeholder="직함" value={manual.jobTitle} onChange={(e) => setManual((p) => ({ ...p, jobTitle: e.target.value }))} />
                <input className={inputClass} placeholder="업종" value={manual.industry} onChange={(e) => setManual((p) => ({ ...p, industry: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                  <input type="checkbox" checked={manual.agreeMarketing} onChange={(e) => setManual((p) => ({ ...p, agreeMarketing: e.target.checked }))} className="accent-violet-500" />
                  마케팅 수신 동의
                </label>
                <textarea className={`${inputClass} md:col-span-2 resize-none`} rows={3} placeholder="메모" value={manual.memo} onChange={(e) => setManual((p) => ({ ...p, memo: e.target.value }))} />
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-4">
                <select className={inputClass + " w-auto"} value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value as DuplicateMode)}>
                  <option value="skip">중복 제외 등록</option>
                  <option value="update">중복이면 기존 데이터 갱신</option>
                  <option value="include">중복 포함 등록</option>
                </select>
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  transition={spring}
                  onClick={submitManual}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />등록
                </motion.button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {showBulk && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-registration-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowBulk(false);
          }}
        >
          <motion.section
            ref={dialogRef}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={spring}
            className="w-full max-w-4xl max-h-[calc(100vh-48px)] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
              <div>
                <h3 id="bulk-registration-title" className="text-sm font-semibold">CSV / 텍스트 일괄등록</h3>
                <p className="text-xs text-muted-foreground mt-1">헤더가 있으면 자동 매핑하고, 없으면 이름, 연락처, 이메일, 회사 순서로 읽습니다.</p>
              </div>
              <motion.button
                whileHover={{ rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                transition={spring}
                onClick={() => setShowBulk(false)}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                aria-label="닫기"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </motion.button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs hover:bg-secondary transition-colors cursor-pointer">
                  <FileText className="w-3.5 h-3.5" />CSV 파일 선택
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                </label>
                <select className={inputClass + " w-auto"} value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value as DuplicateMode)}>
                  <option value="skip">중복 제외 등록</option>
                  <option value="update">중복이면 기존 데이터 갱신</option>
                  <option value="include">중복 포함 등록</option>
                </select>
                <span className="text-xs text-muted-foreground">등록 대상 {parsedBulk.length.toLocaleString()}명</span>
              </div>

              <textarea
                rows={12}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"이름,연락처,이메일,회사,부서,직함,업종,마케팅동의,메모\n홍길동,01012345678,hong@example.com,엑스포럼,마케팅팀,팀장,AI,Y,"}
                className={`${inputClass} font-mono text-xs resize-y`}
              />

              {parsedBulk.length > 0 && (
                <div className="rounded-2xl border border-border bg-secondary/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium">미리보기</p>
                    <p className="text-xs text-muted-foreground">상위 {Math.min(parsedBulk.length, 5)}명 표시</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="px-2 py-1 text-left font-medium">이름</th>
                          <th className="px-2 py-1 text-left font-medium">연락처</th>
                          <th className="px-2 py-1 text-left font-medium">이메일</th>
                          <th className="px-2 py-1 text-left font-medium">회사</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {parsedBulk.slice(0, 5).map((row, index) => (
                          <tr key={`${row.name}-${index}`}>
                            <td className="px-2 py-1.5">{row.name || "-"}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{row.phone || "-"}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{row.email || "-"}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{row.company || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {bulkErrors.length > 0 && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                  <p className="mb-2 text-xs font-medium text-red-500">
                    제외된 행 {bulkErrors.length}건 — 원인을 확인하고 수정해 다시 등록하세요
                  </p>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {bulkErrors.slice(0, 50).map((e, i) => (
                      <div key={i} className="flex gap-2 text-xs">
                        {typeof e.index === "number" && (
                          <span className="shrink-0 font-mono text-muted-foreground">{e.index + 1}행</span>
                        )}
                        <span className="text-muted-foreground">{e.message}</span>
                      </div>
                    ))}
                    {bulkErrors.length > 50 && (
                      <p className="text-[11px] text-muted-foreground">… 외 {bulkErrors.length - 50}건</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end border-t border-border pt-4">
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  transition={spring}
                  onClick={submitBulk}
                  disabled={isSaving || parsedBulk.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />{parsedBulk.length.toLocaleString()}명 일괄등록
                </motion.button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
      </AnimatePresence>

      <AnimatePresence>
      {selectedRegistration && detailDraft && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="registration-detail-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRegistrationDetail();
          }}
        >
          <motion.aside
            ref={dialogRef}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={spring}
            className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-background shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
              <div>
                <h3 id="registration-detail-title" className="text-sm font-semibold">등록자 상세</h3>
                <p className="text-xs text-muted-foreground mt-1">정보를 확인하고 바로 수정합니다.</p>
              </div>
              <motion.button
                whileHover={{ rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                transition={spring}
                onClick={closeRegistrationDetail}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                aria-label="닫기"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </motion.button>
            </div>

            <div className="p-5 space-y-5">
              <div className="space-y-3">
                <input className={inputClass} placeholder="이름 *" value={detailDraft.name} onChange={(e) => setDetailDraft((p) => p ? { ...p, name: e.target.value } : p)} />
                <input className={inputClass} placeholder="연락처" value={detailDraft.phone} onChange={(e) => setDetailDraft((p) => p ? { ...p, phone: e.target.value } : p)} />
                <input className={inputClass} placeholder="이메일" value={detailDraft.email} onChange={(e) => setDetailDraft((p) => p ? { ...p, email: e.target.value } : p)} />
                <input className={inputClass} placeholder="회사" value={detailDraft.company} onChange={(e) => setDetailDraft((p) => p ? { ...p, company: e.target.value } : p)} />
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputClass} placeholder="부서" value={detailDraft.department} onChange={(e) => setDetailDraft((p) => p ? { ...p, department: e.target.value } : p)} />
                  <input className={inputClass} placeholder="직함" value={detailDraft.jobTitle} onChange={(e) => setDetailDraft((p) => p ? { ...p, jobTitle: e.target.value } : p)} />
                </div>
                <input className={inputClass} placeholder="업종" value={detailDraft.industry} onChange={(e) => setDetailDraft((p) => p ? { ...p, industry: e.target.value } : p)} />
                <textarea className={`${inputClass} resize-none`} rows={4} placeholder="메모" value={detailDraft.memo} onChange={(e) => setDetailDraft((p) => p ? { ...p, memo: e.target.value } : p)} />

                {/* 등록 폼 커스텀 문항 답변 — 응답자가 제출한 값이라 여기서 고치지 않는다(읽기 전용).
                    같은 memo 컬럼에 저장되지만 위 메모 칸과 분리해 보여줘야 편집이 답변을 지우지 않는다. */}
                {Object.keys(detailCustomFields).length > 0 && (
                  <div className="rounded-2xl border border-border bg-secondary/20 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">등록 시 추가 응답</p>
                    <dl className="space-y-1.5">
                      {Object.entries(detailCustomFields).map(([label, value]) => (
                        <div key={label} className="flex gap-2 text-sm">
                          <dt className="shrink-0 text-muted-foreground">{label}</dt>
                          <dd className="whitespace-pre-wrap break-words text-foreground">
                            {typeof value === "string" ? value : JSON.stringify(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* 유입 경로 — utm 12컬럼·referrer 를 저장하는데 제품 UI 어디에도 안 보였다(파일로만
                    나갔다). "이 리드가 어디서 왔나" 는 명단을 볼 때 가장 먼저 묻는 질문이라 여기 둔다.
                    마지막 유입과 최초 유입이 다를 때만 둘 다 보여준다 — 같으면 한 줄로 충분하다. */}
                {(() => {
                  const r = selectedRegistration;
                  if (!r) return null;
                  const last = [r.utmSource, r.utmMedium, r.utmCampaign].filter(Boolean).join(" / ");
                  const first = [r.firstUtmSource, r.firstUtmMedium, r.firstUtmCampaign].filter(Boolean).join(" / ");
                  if (!last && !first && !r.referrer) return null;
                  return (
                    <div className="rounded-2xl border border-border bg-secondary/20 p-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">유입 경로</p>
                      <dl className="space-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="shrink-0 text-muted-foreground">{first && first !== last ? "마지막 유입" : "유입"}</dt>
                          <dd className="break-words text-foreground">{last || "직접 유입"}</dd>
                        </div>
                        {first && first !== last && (
                          <div className="flex gap-2">
                            <dt className="shrink-0 text-muted-foreground">최초 유입</dt>
                            <dd className="break-words text-foreground">{first}</dd>
                          </div>
                        )}
                        {r.referrer && (
                          <div className="flex gap-2">
                            <dt className="shrink-0 text-muted-foreground">referrer</dt>
                            <dd className="break-all text-xs text-muted-foreground">{r.referrer}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-2 rounded-2xl border border-border bg-secondary/20 p-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={detailDraft.agreeMarketing} onChange={(e) => setDetailDraft((p) => p ? { ...p, agreeMarketing: e.target.checked } : p)} className="accent-violet-500" />
                  마케팅 수신 동의
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={detailDraft.agreePrivacy} onChange={(e) => setDetailDraft((p) => p ? { ...p, agreePrivacy: e.target.checked } : p)} className="accent-violet-500" />
                  개인정보 수집 동의
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={detailDraft.agreeThirdParty} onChange={(e) => setDetailDraft((p) => p ? { ...p, agreeThirdParty: e.target.checked } : p)} className="accent-violet-500" />
                  개인정보 제3자 제공 동의
                </label>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/20 p-3 text-xs text-muted-foreground space-y-1.5">
                <p>등록일: {formatDate(selectedRegistration.submittedAt)}</p>
                <p>최초 입장: {formatDate(selectedRegistration.enteredAt)}</p>
                <p>마지막 신호: {formatDate(selectedRegistration.lastPingAt)}</p>
                <p>접속: {selectedRegistration.enteredAt ? `${connectedMin(selectedRegistration)}분` : "-"}{selectedRegistration.enteredAt && selectedRegistration.focusSeconds > 0 ? ` (화면 활성 ${Math.floor(selectedRegistration.focusSeconds / 60)}분)` : ""}</p>
              </div>

              {surveys.length > 0 && (
                <section className="space-y-2.5 border-t border-border pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">설문 응답</h4>
                      <p className="mt-1 text-xs text-muted-foreground">등록 정보와 연결된 답변만 표시합니다.</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${selectedRegistration.surveyResponses.length === 0 ? "bg-secondary text-muted-foreground" : "bg-violet-500/10 text-violet-600 dark:text-violet-400"}`}>
                      {selectedRegistration.surveyResponses.length}/{surveys.length} 응답
                    </span>
                  </div>

                  <div className="space-y-2">
                    {surveys.map((survey) => {
                      const response = selectedRegistration.surveyResponses.find((item) => item.surveyId === survey.id);
                      return (
                        <div key={survey.id} className="rounded-xl border border-border bg-secondary/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 text-xs font-medium leading-relaxed">{survey.title}</p>
                            {response ? (
                              <span className="shrink-0 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-600 dark:text-green-400">응답</span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">미응답</span>
                            )}
                          </div>

                          {response && (
                            <>
                              <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(response.submittedAt)} 제출</p>
                              <dl className="mt-3 space-y-2 border-t border-border/70 pt-3">
                                {survey.questions.map((question) => {
                                  const answer = response.answers?.[question.id];
                                  if (answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0)) return null;
                                  return (
                                    <div key={question.id} className="space-y-0.5">
                                      <dt className="text-[11px] text-muted-foreground">{question.title}</dt>
                                      <dd className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">{formatSurveyAnswer(question, answer)}</dd>
                                    </div>
                                  );
                                })}
                              </dl>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 문의 — 설문과 나란히 둔다. 예전엔 라이브 콘솔 안에만 있어서 "이 사람이 뭘
                  물었나" 를 보려면 사람 화면을 떠나 문의 목록에서 이름을 찾아야 했다.
                  설문과 달리 0건이면 섹션 자체를 접는다: 설문은 "미응답" 이 정보지만(보낸
                  설문에 답을 안 한 것), 문의는 안 한 게 기본이라 빈 칸이 정보가 아니다. */}
              {selectedRegistration.qaItems.length > 0 && (
                <section className="space-y-2.5 border-t border-border pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">남긴 문의</h4>
                      <p className="mt-1 text-xs text-muted-foreground">라이브 중 이 등록자가 보낸 질문이에요.</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-600 dark:text-violet-400">
                      {selectedRegistration.qaItems.length}건
                    </span>
                  </div>

                  <ul className="space-y-2">
                    {selectedRegistration.qaItems.map((item) => (
                      <li key={item.id} className="rounded-xl border border-border bg-secondary/20 p-3">
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{item.question}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span
                            className={`rounded-full px-1.5 py-0.5 ${item.status === "answered" ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-secondary"}`}
                          >
                            {qaStatusLabel(item.status)}
                          </span>
                          {item.sessionNo != null ? <span>세션 {item.sessionNo}</span> : null}
                          {item.voteCount > 0 ? <span>추천 {item.voteCount}</span> : null}
                          <span className="ml-auto">{formatDate(item.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className="flex gap-2 border-t border-border pt-4">
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  onClick={saveRegistrationDetail}
                  disabled={isSaving}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />저장
                </motion.button>
                <motion.button
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring}
                  onClick={() => deleteRegistration(selectedRegistration)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm text-red-500 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />삭제
                </motion.button>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <InlineError message="등록자를 불러오지 못했어요" onRetry={() => void fetchRegistrations()} />
      ) : registrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-10 h-10 text-muted-foreground/20 mb-3" />
          <p className="text-sm font-medium">아직 등록자가 없어요</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            배포 탭에서 아임웹에 사전등록 폼을 붙이면 등록자가 이곳으로 자동으로 모여요. 직접 추가하거나 CSV로 불러올 수도 있어요.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => { setShowManual(true); setShowBulk(false); }}
              className="rounded-xl bg-violet-500 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600"
            >
              직접 추가
            </button>
            <button
              onClick={() => { setShowBulk(true); setShowManual(false); }}
              className="rounded-xl border border-border px-3.5 py-2 text-xs font-medium transition-colors hover:bg-secondary"
            >
              CSV 불러오기
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 선택 일괄 작업 바 — 체크박스로 고른 등록자에 내보내기·삭제 */}
          {selectedIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 px-4 py-2.5">
              <span className="text-sm font-medium">{selectedIds.size}명 선택됨</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={handleExportSelected} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary">선택 내보내기</button>
                <button onClick={handleBulkDelete} disabled={isBulkDeleting} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50">{isBulkDeleting ? "삭제 중..." : "선택 삭제"}</button>
                <button onClick={() => setSelectedIds(new Set())} className="rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">선택 해제</button>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="이 페이지 전체 선택"
                        checked={allOnPageSelected}
                        ref={(el) => { if (el) el.indeterminate = !allOnPageSelected && registrations.some((r) => selectedIds.has(r.id)); }}
                        onChange={toggleAllOnPage}
                        className="align-middle accent-violet-500 cursor-pointer"
                      />
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="이름" sortKey="name" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    {/* 참여점수 — 이름 바로 옆에 둔다. 누구부터 연락할지가 이 두 열로 읽혀야 한다. */}
                    {showScore && (
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap" title="참석·체류·인터랙션·마케팅 동의를 합성한 0~100 점수">
                        <SortHeader label="참여점수" sortKey="score" activeKey={sortBy} dir={sortDir} onSort={handleSort} />
                      </th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="연락처" sortKey="phone" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="소속" sortKey="company" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="직함" sortKey="jobTitle" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="업종" sortKey="industry" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="마케팅" sortKey="agreeMarketing" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    {surveys.length > 0 && <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">설문</th>}
                    {/* 문의 열은 이 페이지에 문의가 하나라도 있을 때만 — 대부분의 웨비나에서
                        대부분의 등록자는 문의를 남기지 않아, 늘 켜 두면 빈 열이 명단을 넓힌다.
                        (설문 열이 surveys.length 로 판단하는 것과 같은 이중 게이트 원칙) */}
                    {hasAnyQa && <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">문의</th>}
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="접속" sortKey="stayMinutes" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="최초 입장" sortKey="enteredAt" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="등록일" sortKey="submittedAt" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap"><SortHeader label="상태" sortKey="isActive" activeKey={sortBy} dir={sortDir} onSort={handleSort} /></th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {registrations.map((r) => (
                    <tr key={r.id} className={`transition-colors ${selectedIds.has(r.id) ? "bg-violet-500/5" : "hover:bg-secondary/20"}`}>
                      <td className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          aria-label={`${r.name} 선택`}
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleOne(r.id)}
                          className="align-middle accent-violet-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-600 dark:text-violet-400" aria-hidden>{r.name?.[0] ?? "?"}</span>
                          {r.name}
                        </span>
                      </td>
                      {showScore && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5" title={scoreTitle(r)}>
                            <span className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums ${SEGMENT_META[r.segment ?? "noShow"].cls}`}>
                              {r.score ?? 0}
                            </span>
                            <span className="text-[11px] text-muted-foreground">{SEGMENT_META[r.segment ?? "noShow"].label}</span>
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <div>{r.phone ?? "-"}</div>
                        {r.email && <div className="text-xs">{r.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        <div>{r.company ?? "-"}</div>
                        {r.department && <div className="text-xs">{r.department}</div>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.jobTitle ?? "-"}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">{r.industry ?? "-"}</td>
                      <td className="px-4 py-3">
                        {r.agreeMarketing ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">동의</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">-</span>
                        )}
                      </td>
                      {surveys.length > 0 && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openRegistrationDetail(r)}
                            className={`rounded-full px-1.5 py-0.5 text-[10px] transition-colors hover:brightness-95 ${r.surveyResponses.length === 0 ? "bg-secondary text-muted-foreground" : r.surveyResponses.length === surveys.length ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-violet-500/10 text-violet-600 dark:text-violet-400"}`}
                            title="설문 응답 보기"
                          >
                            {r.surveyResponses.length === 0 ? "미응답" : r.surveyResponses.length === surveys.length ? "응답 완료" : `${r.surveyResponses.length}/${surveys.length} 응답`}
                          </button>
                        </td>
                      )}
                      {hasAnyQa && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {r.qaItems.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => openRegistrationDetail(r)}
                              className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 transition-colors hover:brightness-95 dark:text-violet-400"
                              title="문의 보기"
                            >
                              <MessageCircleQuestion className="h-3 w-3" />
                              {r.qaItems.length}건
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">-</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {r.enteredAt ? `${connectedMin(r)}분` : "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDate(r.enteredAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{formatDateShort(r.submittedAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {(r.isLive ?? r.isActive) ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">시청 중</span>
                        ) : r.enteredAt ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">시청함</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">미시청</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.92 }}
                          transition={spring}
                          onClick={() => openRegistrationDetail(r)}
                          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          title="상세/수정"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </motion.button>
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.92 }}
                          transition={spring}
                          onClick={() => deleteRegistration(r)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 text-muted-foreground transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </motion.button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="px-3 py-2 rounded-xl border border-border bg-background text-xs focus:outline-none"
              >
                <option value={30}>30명씩</option>
                <option value={50}>50명씩</option>
                <option value={100}>100명씩</option>
                <option value={200}>200명씩</option>
              </select>
              <p className="text-xs text-muted-foreground">
                전체 {total.toLocaleString()}명 중 {((page - 1) * pageSize + 1).toLocaleString()}-{Math.min(page * pageSize, total).toLocaleString()}명
              </p>
            </div>
            <div className="flex items-center gap-2">
              <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => setPage(1)} disabled={page === 1} className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40 transition-colors"><ChevronsLeft className="w-4 h-4" /></motion.button>
              <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40 transition-colors"><ChevronLeft className="w-4 h-4" /></motion.button>
              <span className="text-sm text-muted-foreground tabular-nums">{page} / {totalPages}</span>
              <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40 transition-colors"><ChevronRight className="w-4 h-4" /></motion.button>
              <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.92 }} transition={spring} onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-1.5 rounded-lg border border-border hover:bg-secondary disabled:opacity-40 transition-colors"><ChevronsRight className="w-4 h-4" /></motion.button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
