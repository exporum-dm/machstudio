"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { use } from "react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import {
  ArrowLeft, Database, Globe, Copy, Check, Plus, Trash2,
  GripVertical, Code2, Table2, Settings2, Loader2, RefreshCw,
  ExternalLink, Sparkles, ClipboardPaste,
  Download, Upload, ArrowUp, ArrowDown, ChevronsUpDown, Wand2,
  ChevronLeft, ChevronRight, Search, Filter, Activity, Shield,
  RefreshCcw, Bell, Webhook, KeyRound, Eraser, AlertTriangle, ShieldAlert,
  MoreHorizontal, Link2, Wrench, HardDriveDownload, Columns3, MapPin, X, Layers,
  Eye, EyeOff, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/contexts/workspace";
import ActiveToggle from "@/app/(app)/collect/_components/ActiveToggle";
import FormBuilderTab from "./FormBuilderTab";
import InfoTab, { type VenueInfo } from "./InfoTab";
import CheckinTab from "./CheckinTab";
import { TABS, tabsFor, type Tab } from "./tabs";
import SourceOverviewTab from "./SourceOverviewTab";
import dynamic from "next/dynamic";
const ImportModal = dynamic(() => import("./ImportModal"), { ssr: false });
const CleanupModal = dynamic(() => import("./CleanupModal"), { ssr: false });
const RecordDetailModal = dynamic(() => import("./RecordDetailModal"), { ssr: false });
const NormalizeModal = dynamic(() => import("./NormalizeModal"), { ssr: false });
const TestModal = dynamic(() => import("./TestModal"), { ssr: false });
import DangerDeleteModal from "./DangerDeleteModal";
import GdprModal from "./GdprModal";
import RetentionPolicyEditor from "./RetentionPolicyEditor";
import DateRangeField from "@/components/DateRangeField";
import { formatKst, formatKstDateTime } from "@/lib/datetime";
import { dateTimeIn } from "@/lib/collect-checkin";
import { formatCollectValue } from "@/lib/collect-columns";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

const GA4_MANUAL_ENTRY = "__manual__";

interface Ga4PropertyOption {
  propertyId: string;
  displayName: string;
  accountDisplayName: string;
}

type SortKind = "createdAt" | "field" | "utmSource" | "utmMedium";
interface SortState {
  kind: SortKind;
  fieldKey?: string;
  dir: "asc" | "desc";
}

interface FieldMapping {
  id: string;
  index: number;
  key: string;
  label: string;
  type: string;
  isRequired: boolean;
  /** 프로젝트 대시보드에 이 필드의 값 분포를 카드로 보여줄지. 기본 true(§ 스키마 주석). */
  showInDashboard: boolean;
  sortOrder: number;
  /** 수집 데이터 표(목록)에서 이 열을 숨긴다 — 값은 계속 수집되고 상세·CSV엔 그대로 나온다. */
  hidden: boolean;
}

interface DiscoveredField {
  index: number;
  label: string;
  type: string;
}

interface CollectSource {
  id: string;
  /** "capture"(외부 폼에 스크립트) | "builder"(여기서 폼을 만든다) — 화면이 이걸로 갈린다. */
  mode: string;
  previewToken: string | null;
  formConfig: unknown;
  name: string;
  description: string | null;
  apiKey: string;
  siteUrl: string | null;
  successTrigger: string;
  redirectUrl: string | null;
  isActive: boolean;
  projectId: string;
  workspaceId: string;
  webhookUrl: string | null;
  notifyOnSubmit: boolean;
  allowedOrigins: string[];
  formPagePatterns: string[];
  dedupKeyFields: string[];
  fieldGroupSelector: string;
  /** 일자·장소·관람시간·키컬러·하이라이트 영상·포스터 — InfoTab.tsx VenueInfo 와 같은 모양. */
  venueConfig: VenueInfo | null;
  /** 현장 체크인(빌더형) — 켜져 있으면 표에 입장 열이 생긴다. 시각은 행사 시간대로 보인다. */
  checkinEnabled?: boolean;
  checkinTimezone?: string;
  fieldMappings: FieldMapping[];
  discoveredFields: DiscoveredField[] | null;
  _count: { records: number };
}

interface CollectRecord {
  id: string;
  data: Record<string, string>;
  /** 빌더형에만 있다 — 현장 입장의 열쇠이므로 목록에서 대조할 수 있어야 한다(§9.1·§12). */
  registrationNo?: string | null;
  /** 현장 체크인 요약 — 한 번이라도 스캔된 레코드에만 온다. */
  checkIn?: { firstAt: string; lastAt: string; count: number };
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  createdAt: string;
}

interface ActivityLogEntry {
  id: string;
  action: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string } | null;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className={className ?? "p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CopyCodeButton({ text, label = "코드 복사" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "복사됨" : label}
    </button>
  );
}

/**
 * GA4 속성 선택 — 이번 해/작년 두 곳에서 같은 UI를 쓴다(전년 비교를 켜려면 작년 속성도
 * 지정해야 해서). 목록 조회 실패, 또는 저장된 값이 목록에 없으면(오래된 값·권한 변경)
 * 잃어버리지 않게 수동 입력이 기본값 — 사용자가 셀렉트에서 직접 고른 적 있으면 그 선택이
 * 항상 우선한다.
 */
function Ga4PropertySelect({ value, onChange, properties }: {
  value: string;
  onChange: (next: string) => void;
  properties: Ga4PropertyOption[] | null;
}) {
  const [manualEntryChoice, setManualEntryChoice] = useState<boolean | null>(null);
  const manualEntry = useMemo(() => {
    if (manualEntryChoice !== null) return manualEntryChoice;
    if (properties === null) return true;
    return !!value && !properties.some((p) => p.propertyId === value);
  }, [manualEntryChoice, properties, value]);
  const selectValue = useMemo(() => {
    if (properties === null || manualEntry) return GA4_MANUAL_ENTRY;
    return value || "";
  }, [properties, manualEntry, value]);

  if (properties !== null && properties.length > 0) {
    return (
      <>
        <select
          value={selectValue}
          onChange={(e) => {
            if (e.target.value === GA4_MANUAL_ENTRY) {
              setManualEntryChoice(true);
            } else {
              setManualEntryChoice(false);
              onChange(e.target.value);
            }
          }}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none transition-colors focus:border-violet-400"
        >
          <option value="" disabled>속성을 선택하세요</option>
          {value && !properties.some((p) => p.propertyId === value) && (
            <option value={value}>현재 값: {value} (목록에 없음)</option>
          )}
          {Object.entries(
            properties.reduce<Record<string, Ga4PropertyOption[]>>((groups, p) => {
              (groups[p.accountDisplayName] ??= []).push(p);
              return groups;
            }, {}),
          ).map(([account, props]) => (
            <optgroup key={account} label={account}>
              {props.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} ({p.propertyId})
                </option>
              ))}
            </optgroup>
          ))}
          <option value={GA4_MANUAL_ENTRY}>직접 입력...</option>
        </select>
        {manualEntry && (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="예: 123456789"
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none transition-colors focus:border-violet-400"
          />
        )}
      </>
    );
  }

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: 123456789"
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none transition-colors focus:border-violet-400"
      />
      {properties === null && (
        <span className="block text-[11px] text-muted-foreground">
          접근 가능한 속성 목록을 불러오지 못해 직접 입력해야 해요.
        </span>
      )}
    </>
  );
}

function timeStr(dateStr: string) {
  return formatKst(dateStr, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toKey(label: string, index: number) {
  const romanized = label
    .replace(/[가-힣]+/g, (_, offset) => `field${offset}`)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
  return romanized || `field_${index}`;
}

export default function CollectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { currentProject, workspace, setCurrentProject, projects } = useWorkspace();
  const [source, setSource] = useState<CollectSource | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // 대시보드 카드가 ?tab=overview 로 바로 현황을 연다. 모르는 값이면 현황(기본 탭)으로.
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get("tab");
    return TABS.find((t) => t.id === requested)?.id ?? "overview";
  });

  // GA4 분석 연동 — 소스가 아니라 "프로젝트" 단위 설정이지만(§데이터 관리 탭 참고),
  // 데이터를 다루는 이 화면에서 바로 고칠 수 있어야 접근성이 있다.
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [ga4PreviousYearPropertyId, setGa4PreviousYearPropertyId] = useState("");
  const [ga4RegistrationPagePath, setGa4RegistrationPagePath] = useState("");
  const [ga4Properties, setGa4Properties] = useState<Ga4PropertyOption[] | null>(null);
  const [ga4Loading, setGa4Loading] = useState(false);
  const [ga4Saving, setGa4Saving] = useState(false);

  const [records, setRecords] = useState<CollectRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0); // 필터 적용된 서버 카운트 (현재 조회 조건 기준)
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false); // 전체 결과 선택 진행 중
  const [showImport, setShowImport] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [showNormalize, setShowNormalize] = useState(false);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [showRegenerateKeyModal, setShowRegenerateKeyModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showUtmSource, setShowUtmSource] = useState(true);
  const [showUtmMedium, setShowUtmMedium] = useState(true);
  const [showTest, setShowTest] = useState(false);
  const [showDangerDelete, setShowDangerDelete] = useState(false);
  const [showGdpr, setShowGdpr] = useState(false);
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>({ kind: "createdAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // 검색/필터 — 서버 페이지네이션. 검색어는 디바운스(300ms) 후 서버 요청.
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterUtmSource, setFilterUtmSource] = useState("");
  const [filterUtmMedium, setFilterUtmMedium] = useState("");
  // UTM 필터 드롭다운 옵션 — 누적된 distinct 값 (페이지/검색을 거치며 본 값들의 합집합)
  const [utmSourceOptions, setUtmSourceOptions] = useState<string[]>([]);
  const [utmMediumOptions, setUtmMediumOptions] = useState<string[]>([]);
  // "전체 결과 선택" — 현재 필터에 매칭되는 모든 레코드(현재 페이지 밖 포함)를 선택한 상태
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // 설정 폼
  const [settingsWebhookUrl, setSettingsWebhookUrl] = useState("");
  const [settingsNotifyOnSubmit, setSettingsNotifyOnSubmit] = useState(false);
  const [settingsAllowedOrigins, setSettingsAllowedOrigins] = useState("");
  // 폼 페이지 패턴 (글로브). 빈 배열 = 모든 페이지에서 폼 감지 활성화.
  const [formPagePatterns, setFormPagePatterns] = useState<string[]>([]);
  const [formPagePatternInput, setFormPagePatternInput] = useState("");
  const [savingFormPagePatterns, setSavingFormPagePatterns] = useState(false);
  // 중복 기준 필드 (가져오기 시 중복 판정용 우선순위 필드)
  const [dedupKeyFields, setDedupKeyFields] = useState<string[]>([]);
  const [savingDedup, setSavingDedup] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState(false);

  // 활동 로그
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const [fields, setFields] = useState<FieldMapping[]>([]);
  const [isSavingFields, setIsSavingFields] = useState(false);
  const [successTrigger, setSuccessTrigger] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [fieldGroupSelector, setFieldGroupSelector] = useState(".form-group");

  const [script, setScript] = useState<string | null>(null);
  const [utmScript, setUtmScript] = useState<string | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [browserOrigin, setBrowserOrigin] = useState("");
  // console sniffer paste
  const [pasteJson, setPasteJson] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [snifferPlatform, setSnifferPlatform] = useState<"iweb" | "mice">("iweb");

  const fetchSource = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/collect-sources/${id}`);
      const data = await res.json();
      if (!res.ok) return;
      setSource(data.source);
      setFields(data.source.fieldMappings ?? []);
      setSuccessTrigger(data.source.successTrigger);
      setRedirectUrl(data.source.redirectUrl ?? "");
      setFieldGroupSelector(data.source.fieldGroupSelector || ".form-group");
      setSettingsWebhookUrl(data.source.webhookUrl ?? "");
      setSettingsNotifyOnSubmit(!!data.source.notifyOnSubmit);
      setSettingsAllowedOrigins((data.source.allowedOrigins ?? []).join("\n"));
      setFormPagePatterns(Array.isArray(data.source.formPagePatterns) ? data.source.formPagePatterns : []);
      setDedupKeyFields(Array.isArray(data.source.dedupKeyFields) ? data.source.dedupKeyFields : []);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  const fetchGa4Settings = useCallback(async (projectId: string) => {
    setGa4Loading(true);
    try {
      const [projectRes, propsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/ga4-properties`),
      ]);
      const projectData = await projectRes.json().catch(() => ({}));
      if (projectRes.ok && projectData.project) {
        setGa4PropertyId(projectData.project.ga4PropertyId ?? "");
        setGa4PreviousYearPropertyId(projectData.project.ga4PreviousYearPropertyId ?? "");
        setGa4RegistrationPagePath(projectData.project.ga4RegistrationPagePath ?? "");
      }
      const propsData = await propsRes.json().catch(() => ({}));
      setGa4Properties(propsRes.ok && Array.isArray(propsData.properties) ? propsData.properties : null);
    } finally {
      setGa4Loading(false);
    }
  }, []);

  const handleSaveGa4 = async () => {
    if (!source) return;
    setGa4Saving(true);
    try {
      const res = await fetch(`/api/projects/${source.projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ga4PropertyId, ga4PreviousYearPropertyId, ga4RegistrationPagePath }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "저장 실패");
        return;
      }
      toast.success("분석 연동 설정을 저장했어요");
    } finally {
      setGa4Saving(false);
    }
  };

  // 현재 검색/필터/정렬 상태를 records API 쿼리스트링으로 직렬화 (페이지네이션 제외)
  const buildFilterQuery = useCallback(() => {
    const qs = new URLSearchParams();
    if (debouncedSearch.trim()) qs.set("q", debouncedSearch.trim());
    // 날짜 필터는 KST 경계로 ISO 변환해 전달
    if (filterDateFrom) qs.set("from", `${filterDateFrom}T00:00:00+09:00`);
    if (filterDateTo) qs.set("to", `${filterDateTo}T23:59:59+09:00`);
    if (filterUtmSource) qs.set("utmSource", filterUtmSource);
    if (filterUtmMedium) qs.set("utmMedium", filterUtmMedium);
    if (sort) {
      qs.set("sort", sort.kind);
      qs.set("dir", sort.dir);
      if (sort.kind === "field" && sort.fieldKey) qs.set("sortField", sort.fieldKey);
    }
    return qs;
  }, [debouncedSearch, filterDateFrom, filterDateTo, filterUtmSource, filterUtmMedium, sort]);

  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const qs = buildFilterQuery();
      qs.set("page", String(page));
      qs.set("limit", String(pageSize));
      const res = await fetch(`/api/collect-sources/${id}/records?${qs.toString()}`);
      const data = await res.json();
      const fetched: CollectRecord[] = data.records ?? [];
      const total: number = data.total ?? 0;
      setRecords(fetched);
      setRecordsTotal(total);
      // 삭제 등으로 현재 페이지가 범위를 벗어났으면 마지막 페이지로 보정 → 재조회
      const maxPage = Math.max(1, Math.ceil(total / pageSize));
      if (page > maxPage) setPage(maxPage);
      // 본 적 있는 UTM 값을 누적해 드롭다운 옵션 구성
      setUtmSourceOptions((prev) => {
        const merged = new Set(prev);
        fetched.forEach((r) => { if (r.utmSource) merged.add(r.utmSource); });
        return Array.from(merged).sort();
      });
      setUtmMediumOptions((prev) => {
        const merged = new Set(prev);
        fetched.forEach((r) => { if (r.utmMedium) merged.add(r.utmMedium); });
        return Array.from(merged).sort();
      });
      // 전체 선택 모드가 아니면, 더 이상 화면에 없는 선택 항목은 정리
      if (!selectAllMatchingRef.current) {
        const pageIds = new Set(fetched.map((r) => r.id));
        setSelectedIds((prev) => new Set(Array.from(prev).filter((rid) => pageIds.has(rid))));
      }
    } finally {
      setRecordsLoading(false);
    }
  }, [id, page, pageSize, buildFilterQuery]);

  const toggleSelect = (recordId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  // 현재 페이지의 레코드만 선택/해제 (전체 결과 선택은 별도 배너 버튼)
  const toggleSelectAll = () => {
    const pageIds = records.map((r) => r.id);
    const allChecked = pageIds.length > 0 && pageIds.every((rid) => selectedIds.has(rid));
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allChecked) pageIds.forEach((rid) => next.delete(rid));
      else pageIds.forEach((rid) => next.add(rid));
      return next;
    });
  };

  // 현재 필터에 매칭되는 모든 레코드를 선택 (현재 페이지 밖 포함)
  const selectAllAcrossPages = async () => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const all = await fetchAllMatchingRecords();
      setSelectedIds(new Set(all.map((r) => r.id)));
      setSelectAllMatching(true);
    } catch {
      toast.error("전체 선택에 실패했어요");
    } finally {
      setSelectingAll(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      // 대량 선택(전체 선택) 시 요청 본문 413 방지를 위해 1000건씩 분할 삭제
      const allIds = Array.from(selectedIds);
      const chunkSize = 1000;
      let deleted = 0;
      for (let i = 0; i < allIds.length; i += chunkSize) {
        const chunk = allIds.slice(i, i + chunkSize);
        const res = await fetch(`/api/collect-sources/${id}/records`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error ?? "삭제 실패"); return; }
        deleted += data.deleted ?? 0;
      }
      toast.success(`${deleted.toLocaleString()}건 삭제됐어요`);
      setShowDeleteSelectedModal(false);
      setSelectAllMatching(false);
      setSelectedIds(new Set());
      await fetchSource(); // 전체 카운트 갱신
      await fetchRecords();
    } finally {
      setIsDeleting(false);
    }
  };

  // 필터/선택이 없으면 서버 export(전체), 있으면 클라이언트에서 필터된 결과 export
  const handleExportCsv = () => { handleExportCsvWithFilter(); };

  // 필터/정렬 변경 시 1페이지로 + 전체선택 해제 (이벤트 핸들러 → 동기 setState 허용)
  const resetToFirstPage = () => { setPage(1); setSelectAllMatching(false); };

  const cycleSort = (kind: SortKind, fieldKey?: string) => {
    resetToFirstPage();
    setSort((prev) => {
      const same = prev && prev.kind === kind && prev.fieldKey === fieldKey;
      if (!same) return { kind, fieldKey, dir: "asc" };
      if (prev.dir === "asc") return { kind, fieldKey, dir: "desc" };
      return null;
    });
  };

  // 서버가 필터·정렬·페이지네이션을 처리하므로 클라이언트는 받은 records 를 그대로 표시.
  // recordsTotal = 현재 필터 조건에 매칭되는 전체 건수, recordsGrandTotal = 무필터 전체 건수.
  const recordsGrandTotal = source?._count?.records ?? 0;

  const hasActiveFilter = !!(searchQuery || filterDateFrom || filterDateTo || filterUtmSource || filterUtmMedium);
  const resetFilters = () => {
    setSearchQuery(""); setFilterDateFrom(""); setFilterDateTo("");
    setFilterUtmSource(""); setFilterUtmMedium("");
    resetToFirstPage();
  };

  const totalPages = Math.max(1, Math.ceil(recordsTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = pageStart + records.length;

  // 검색어 디바운스 (300ms) — 매 타이핑마다 서버 요청 방지.
  // 검색어가 바뀌면 1페이지로 리셋(타임아웃 콜백 내 처리 → 효과 본문 동기 setState 회피).
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
      setSelectAllMatching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // 필터/정렬/페이지 크기는 이벤트 핸들러에서 즉시 1페이지로 리셋한다(resetToFirstPage).
  // 레코드 변경(삭제/정리 등) 후에도 핸들러에서 페이지를 보정하므로 별도 보정 효과가 필요 없다.

  const sortIcon = (kind: SortKind, fieldKey?: string) => {
    const active = sort && sort.kind === kind && sort.fieldKey === fieldKey;
    if (!active) return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40" />;
    return sort.dir === "asc"
      ? <ArrowUp className="w-3 h-3 text-violet-500" />
      : <ArrowDown className="w-3 h-3 text-violet-500" />;
  };

  const fetchScript = useCallback(async () => {
    setScriptLoading(true);
    try {
      const res = await fetch(`/api/collect-sources/${id}/script`);
      const data = await res.json();
      setScript(data.script ?? "");
      setUtmScript(data.utmScript ?? "");
    } finally {
      setScriptLoading(false);
    }
  }, [id]);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/collect-sources/${id}/activity`);
      const data = await res.json();
      setActivityLogs(data.logs ?? []);
    } finally {
      setActivityLoading(false);
    }
  }, [id]);

  // 탭별 최초 1회 fetch 최적화 (탭 재방문 시 불필요한 재요청 방지)
  const hasFetchedScriptRef = useRef(false);
  const hasFetchedActivityRef = useRef(false);
  const hasFetchedGa4Ref = useRef(false);
  // 전체 선택 모드를 fetchRecords 의존성에서 제외하기 위한 ref 미러
  const selectAllMatchingRef = useRef(selectAllMatching);
  useEffect(() => { selectAllMatchingRef.current = selectAllMatching; }, [selectAllMatching]);

  useEffect(() => { fetchSource(); }, [fetchSource]);

  // 52,000건 capture 설치 경로와 localhost 경고는 현재 host를 함께 보여야 해 이번 범위에서 보존한다.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => { setBrowserOrigin(window.location.origin); }, []);

  // 프로젝트 컨텍스트 ↔ URL 의 소스 동기화
  // - 처음 로드: URL 의 소스 projectId 와 currentProject 가 다르면 currentProject 를 맞춤
  // - 그 뒤 사용자가 프로젝트를 다른 곳으로 전환하면 /collect 목록으로 이동
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!source || !currentProject || projects.length === 0) return;
    if (source.projectId === currentProject.id) {
      syncedRef.current = true;
      return;
    }
    if (!syncedRef.current) {
      // 초기 동기화: URL 기준으로 프로젝트 맞추기
      const proj = projects.find((p) => p.id === source.projectId);
      if (proj) setCurrentProject(proj);
      else router.replace("/collect");
    } else {
      // 사용자가 프로젝트를 바꿈 → 목록으로
      router.replace("/collect");
    }
  }, [source, currentProject, projects, setCurrentProject, router]);

  // 워크스페이스가 다르면 접근 불가 → 목록으로
  useEffect(() => {
    if (!source || !workspace) return;
    if (source.workspaceId !== workspace.id) router.replace("/collect");
  }, [source, workspace, router]);
  // records 탭: 최초 진입 시, 그리고 검색/필터/정렬/페이지 변경 시 서버 재조회.
  // 다른 탭에 있을 땐 요청하지 않다가, 탭 복귀 시 1회 동기화.
  useEffect(() => {
    if (tab !== "records") return;
    fetchRecords();
  }, [tab, fetchRecords]);
  useEffect(() => {
    if (tab === "script" && !hasFetchedScriptRef.current) {
      hasFetchedScriptRef.current = true;
      fetchScript();
    }
  }, [tab, fetchScript]);
  useEffect(() => {
    if (tab === "activity" && !hasFetchedActivityRef.current) {
      hasFetchedActivityRef.current = true;
      fetchActivity();
    }
  }, [tab, fetchActivity]);
  useEffect(() => {
    if (tab === "data-mgmt" && !hasFetchedGa4Ref.current && source) {
      hasFetchedGa4Ref.current = true;
      fetchGa4Settings(source.projectId);
    }
  }, [tab, source, fetchGa4Settings]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    if (showMoreMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMoreMenu]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setShowColumnsMenu(false);
      }
    };
    if (showColumnsMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColumnsMenu]);

  // 컬럼 표시 설정 localStorage 동기화
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`collect-columns-${id}`);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v.showUtmSource === "boolean") setShowUtmSource(v.showUtmSource);
        if (typeof v.showUtmMedium === "boolean") setShowUtmMedium(v.showUtmMedium);
      }
    } catch {}
  }, [id]);
  useEffect(() => {
    try {
      localStorage.setItem(`collect-columns-${id}`, JSON.stringify({ showUtmSource, showUtmMedium }));
    } catch {}
  }, [id, showUtmSource, showUtmMedium]);

  const handleSaveSecuritySettings = async () => {
    setSavingSettings(true);
    try {
      const origins = settingsAllowedOrigins
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/collect-sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: settingsWebhookUrl || null,
          notifyOnSubmit: settingsNotifyOnSubmit,
          allowedOrigins: origins,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
      toast.success("저장됐어요");
      setSource(data.source);
      setSettingsAllowedOrigins((data.source.allowedOrigins ?? []).join("\n"));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRegenerateKey = async () => {
    setRegeneratingKey(true);
    try {
      const res = await fetch(`/api/collect-sources/${id}/regenerate-key`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "재발급 실패"); return; }
      toast.success("새 키가 발급됐어요. 스크립트를 다시 복사해주세요.");
      setSource((s) => s ? { ...s, apiKey: data.apiKey } : s);
      if (tab === "script") fetchScript();
    } finally {
      setRegeneratingKey(false);
    }
  };

  // 현재 필터 조건에 매칭되는 모든 레코드를 서버에서 페이지 단위로 모아 반환
  const fetchAllMatchingRecords = useCallback(async (): Promise<CollectRecord[]> => {
    const all: CollectRecord[] = [];
    const pageLimit = 500;
    for (let p = 1; p <= 200; p++) {
      const qs = buildFilterQuery();
      qs.set("page", String(p));
      qs.set("limit", String(pageLimit));
      const res = await fetch(`/api/collect-sources/${id}/records?${qs.toString()}`);
      if (!res.ok) break;
      const data = await res.json();
      const batch: CollectRecord[] = data.records ?? [];
      all.push(...batch);
      if (batch.length < pageLimit || all.length >= (data.total ?? all.length)) break;
    }
    return all;
  }, [id, buildFilterQuery]);

  const handleExportCsvWithFilter = async () => {
    // 필터·선택 모두 없으면 서버 전체 export (first-touch UTM 등 풍부한 컬럼 포함)
    if (!hasActiveFilter && selectedIds.size === 0) {
      window.location.href = `/api/collect-sources/${id}/records/export`;
      return;
    }
    if (!source || isExporting) return;
    setIsExporting(true);
    try {
      // 필터 매칭 전체를 서버에서 모은 뒤, 명시적 선택이 있으면 그 ID로 좁힘
      const matching = await fetchAllMatchingRecords();
      const targetRecords = selectedIds.size > 0 && !selectAllMatching
        ? matching.filter((r) => selectedIds.has(r.id))
        : matching;
      const csvEscape = (v: unknown) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = [
        "시간 (KST)",
        ...source.fieldMappings.map((f) => f.label || f.key),
        "UTM 소스", "UTM 매체", "UTM 캠페인", "UTM 키워드", "UTM 콘텐츠", "Referrer",
      ];
      const rows = targetRecords.map((r) => [
        formatKstDateTime(r.createdAt),
        ...source.fieldMappings.map((f) => r.data?.[f.key] ?? ""),
        r.utmSource ?? "", r.utmMedium ?? "", r.utmCampaign ?? "",
        r.utmTerm ?? "", r.utmContent ?? "", r.referrer ?? "",
      ]);
      const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      a.download = `${source.name.replace(/[^a-zA-Z0-9가-힣_-]+/g, "_")}_filtered_${date}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("내보내기에 실패했어요");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveFields = async () => {
    setIsSavingFields(true);
    try {
      const res = await fetch(`/api/collect-sources/${id}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fields.map((f, i) => ({ ...f, sortOrder: i })) }),
      });
      if (!res.ok) { toast.error("저장 실패"); return; }

      /**
       * 저장 결과를 **source.fieldMappings 에도 반영한다.**
       *
       * 안 하면 필드를 추가·수정·삭제해도 수집 데이터 표의 컬럼이 새로고침 전까지 낡은 채다 —
       * 표 헤더·셀·CSV 헤더·모달이 전부 fields 가 아니라 source.fieldMappings 에서 컬럼을
       * 뽑기 때문(1206·1251·622·627행). 저장은 됐는데 화면이 안 바뀌니 운영자는 저장이
       * 실패한 줄 안다.
       *
       * fetchSource() 를 부르지 않는 이유: 그 함수는 **모든 폼 상태를 서버 값으로 다시
       * 씌운다**(웹훅·허용 Origin·성공 트리거·리다이렉트). 필드를 저장하는 순간 옆 탭에서
       * 저장 안 한 편집이 조용히 사라진다. PUT 이 이미 서버가 다시 읽은 전체 목록을
       * 돌려주므로 추가 요청도 필요 없다.
       */
      const data = await res.json().catch(() => null);
      if (Array.isArray(data?.fields)) {
        setSource((prev) => (prev ? { ...prev, fieldMappings: data.fields } : prev));
        // 새로 추가한 행은 클라이언트 임시 id 를 들고 있다 — 서버 행으로 바꿔 다음 저장이 실제 id 를 보내게.
        setFields(data.fields);
      }

      toast.success("필드 설정이 저장됐어요");
      if (tab === "script") fetchScript();
    } finally {
      setIsSavingFields(false);
    }
  };

  const handleSaveSettings = async () => {
    const res = await fetch(`/api/collect-sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ successTrigger, redirectUrl: redirectUrl || null, fieldGroupSelector: fieldGroupSelector.trim() || ".form-group" }),
    });
    if (!res.ok) { toast.error("저장 실패"); return; }
    toast.success("설정이 저장됐어요");
    setSource((s) => s ? { ...s, successTrigger, redirectUrl: redirectUrl || null, fieldGroupSelector: fieldGroupSelector.trim() || ".form-group" } : s);
  };

  /**
   * 스니퍼 결과를 붙여넣는 순간 선택자를 **바로 서버에 저장한다.**
   *
   * 예전엔 "필드 적용"(화면 상태만 바꿈)과 "선택자 저장"(서버에 반영)이 완전히 분리돼
   * 있어서, 필드는 매핑해 놓고 선택자 저장만 잊는 사고가 실제로 났다 — 그러면 실제 사이트에서
   * 스크립트가 옛 선택자(기본 .form-group)로 아무것도 못 찾아 매핑을 다 해도 데이터가
   * 하나도 안 들어온다. `setFieldGroupSelector` 직후 같은 값을 바로 인자로 넘겨 저장한다 —
   * React state 갱신은 비동기라 그 자리에서 `fieldGroupSelector` 를 읽으면 갱신 전 값이 잡힌다.
   */
  const saveFieldGroupSelector = async (selector: string) => {
    const res = await fetch(`/api/collect-sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldGroupSelector: selector }),
    });
    if (!res.ok) { toast.error("선택자 저장 실패 — 아래 '선택자 저장' 버튼으로 다시 시도해주세요"); return; }
    setSource((s) => s ? { ...s, fieldGroupSelector: selector } : s);
  };

  const addFormPagePattern = () => {
    const v = formPagePatternInput.trim();
    if (!v) return;
    if (v.length > 200) { toast.error("패턴은 200자 이내로 입력해주세요"); return; }
    if (formPagePatterns.includes(v)) { setFormPagePatternInput(""); return; }
    if (formPagePatterns.length >= 20) { toast.error("패턴은 최대 20개까지 등록할 수 있어요"); return; }
    setFormPagePatterns((prev) => [...prev, v]);
    setFormPagePatternInput("");
  };

  const removeFormPagePattern = (pattern: string) => {
    setFormPagePatterns((prev) => prev.filter((p) => p !== pattern));
  };

  const handleSaveFormPagePatterns = async () => {
    setSavingFormPagePatterns(true);
    try {
      // 인풋에 남아 있는 미확정 패턴이 있다면 함께 저장
      const pending = formPagePatternInput.trim();
      const next = pending && !formPagePatterns.includes(pending)
        ? [...formPagePatterns, pending].slice(0, 20)
        : formPagePatterns;
      const res = await fetch(`/api/collect-sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formPagePatterns: next }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
      const saved = Array.isArray(data.source?.formPagePatterns) ? data.source.formPagePatterns : next;
      setFormPagePatterns(saved);
      setFormPagePatternInput("");
      setSource((s) => s ? { ...s, formPagePatterns: saved } : s);
      toast.success("폼 페이지 패턴 저장됨. 5분 내 사이트에 적용돼요");
    } finally {
      setSavingFormPagePatterns(false);
    }
  };

  const handleSaveDedupKeyFields = async () => {
    setSavingDedup(true);
    try {
      const res = await fetch(`/api/collect-sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dedupKeyFields }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
      const saved = Array.isArray(data.source?.dedupKeyFields) ? data.source.dedupKeyFields : dedupKeyFields;
      setDedupKeyFields(saved);
      setSource((s) => s ? { ...s, dedupKeyFields: saved } : s);
      toast.success("중복 기준 필드가 저장됐어요");
    } finally {
      setSavingDedup(false);
    }
  };

  const handleToggleSilent = async (next: boolean) => {
    if (!source) return;
    const res = await fetch(`/api/collect-sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
    if (!res.ok) { toast.error("상태 변경 실패"); return; }
    setSource((s) => s ? { ...s, isActive: next } : s);
  };

  const handleToggle = async (next: boolean) => {
    if (!source) return;
    const prev = source.isActive;
    await handleToggleSilent(next);
    if (prev && !next) {
      toast("사전등록 폼이 비활성화됐어요", {
        description: "새 데이터 수집이 중단됩니다",
        duration: 5000,
        action: { label: "되돌리기", onClick: () => handleToggleSilent(true) },
      });
    } else if (!prev && next) {
      toast.success("사전등록 폼이 활성화됐어요");
    }
  };

  // 감지된 필드 한 번에 적용
  const applyDiscoveredFields = () => {
    if (!source?.discoveredFields) return;
    const applied: FieldMapping[] = source.discoveredFields.map((f, i) => ({
      id: `discovered-${i}`,
      index: f.index,
      key: toKey(f.label, f.index),
      label: f.label || `필드 ${f.index}`,
      type: f.type || "text",
      isRequired: false,
      showInDashboard: true,
      sortOrder: i,
      hidden: false,
    }));
    setFields(applied);
    toast.success("감지된 필드가 적용됐어요. 저장 버튼을 눌러 확정하세요");
    setTab("fields");
  };

  // 콘솔 스니퍼 JSON 붙여넣기로 필드 적용 — { selector, fields } 새 형식과, 옛 스니퍼가
  // 찍던 배열 하나짜리 형식을 둘 다 받는다(캐시된 옛 스니퍼로 붙여넣는 사람이 있을 수 있다).
  const applyPastedJson = () => {
    setPasteError("");
    try {
      const parsed = JSON.parse(pasteJson);
      const list: unknown = Array.isArray(parsed) ? parsed : parsed?.fields;
      if (!Array.isArray(list)) throw new Error("형식이 올바르지 않아요");
      const applied: FieldMapping[] = list.map((f: { index?: number; key?: string; label?: string; type?: string }, i: number) => ({
        id: `pasted-${i}`,
        index: typeof f.index === "number" ? f.index : i,
        key: f.key || toKey(f.label ?? "", i),
        label: f.label || `필드 ${i}`,
        type: f.type || "text",
        isRequired: false,
        showInDashboard: true,
        sortOrder: i,
        hidden: false,
      }));
      setFields(applied);
      // 새 형식이면 감지에 실제로 쓰인 선택자도 같이 받아 온다 — 운영자가 CSS를 몰라도 된다.
      // 선택자는 여기서 바로 서버에 저장한다(아래 saveFieldGroupSelector 주석 참고) —
      // 필드 매핑은 라벨·키를 더 고칠 수 있어 "저장" 버튼을 따로 눌러야 하지만, 선택자는
      // 고칠 이유가 없는 값이라 미룰수록 "매핑은 했는데 선택자를 깜빡했다"는 사고만 커진다.
      const detectedSelector = !Array.isArray(parsed) && typeof parsed?.selector === "string" ? parsed.selector : "";
      if (detectedSelector) {
        setFieldGroupSelector(detectedSelector);
        void saveFieldGroupSelector(detectedSelector);
      }
      setPasteJson("");
      toast.success(
        detectedSelector
          ? `${applied.length}개 필드가 적용되고 선택자(${detectedSelector})도 저장됐어요 — 필드는 '필드 매핑 저장'으로 확정하세요`
          : `${applied.length}개 필드가 적용됐어요. 저장 버튼을 눌러 확정하세요`,
      );
      setTab("fields");
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : "JSON 형식이 올바르지 않아요");
    }
  };

  const addField = () => {
    // fields.length 가 아니라 "지금 있는 index 중 제일 큰 값 + 1" 을 쓴다 — 중간 항목을
    // 지운 뒤라면(아래 removeField) 배열 길이가 실제 DOM 위치보다 작아서, length 를 그대로
    // 쓰면 이미 쓰고 있는 index 와 겹친다.
    const newIndex = fields.length > 0 ? Math.max(...fields.map((f) => f.index)) + 1 : 0;
    setFields((f) => [...f, {
      id: `new-${Date.now()}`,
      index: newIndex,
      key: `field_${newIndex}`,
      label: "",
      type: "text",
      isRequired: false,
      showInDashboard: true,
      sortOrder: f.length,
      hidden: false,
    }]);
  };

  /**
   * index 는 화면 배열 순서가 아니라 **실제 사이트에서 필드 하나가 몇 번째인지**를 가리키는
   * 값이다(연동형 스크립트가 `groups[field.index]` 로 그 자리를 찾는다). 그래서 항목 하나를
   * 지운다고 나머지의 index 까지 당겨 버리면, 지운 자리 뒤의 모든 필드가 실제 DOM 과 하나씩
   * 어긋난다 — "숨김 필드라 안 보이는 항목이니 지워도 되겠지" 하고 지운 순간 그 뒤의 필드가
   * 전부 잘못된 값을 모으게 된다. sortOrder(화면에 보이는 순서)만 다시 매기고 index 는
   * 그대로 둔다.
   */
  const removeField = (idx: number) => {
    setFields((f) => f.filter((_, i) => i !== idx).map((fld, i) => ({ ...fld, sortOrder: i })));
  };

  const updateField = (idx: number, patch: Partial<FieldMapping>) => {
    setFields((f) => f.map((fld, i) => i === idx ? { ...fld, ...patch } : fld));
  };

  /**
   * 콘솔 스니퍼는 **플랫폼별로 완전히 분리한다.** 예전에 ".form-group"·"table tr"·"dl > div"
   * 를 한 번에 다 시도해서 "매칭 개수가 제일 많은 쪽"을 고르게 했더니, 아임웹 페이지에 폼과
   * 무관한 다른 표(예: 뉴스레터 구독란)가 있으면 그 표의 행 수가 실제 .form-group 개수를
   * 이겨서 **아임웹조차 오감지**했다 — "아임웹도 안 되고 마이스허브도 안 된다"던 피드백의
   * 원인이다. 운영자가 지금 보고 있는 사이트가 뭔지 이미 알고 있으니, 그 앎을 그대로
   * 탭으로 받는다 — 서로 경쟁하지 않으니 한쪽 사이트의 잡음이 다른 쪽 감지를 흔들 수 없다.
   */
  const SNIFFER_PLATFORMS = {
    iweb: {
      label: "아임웹",
      sel: ".form-group",
      // 필드 제목이 그룹 안의 <label> 이다(체크박스·라디오 옵션 자체의 라벨과 안 겹친다 —
      // 아임웹은 옵션 텍스트를 label 이 아니라 별도 span 으로 둔다).
      getTitle: `var label = g.querySelector("label"); return label ? label.textContent.trim() : "";`,
    },
    mice: {
      label: "마이스허브",
      // 실측(edtechkorea.or.kr) 확인: 필드 하나 = div.field.rowN.fr_{모듈ID}, 그 안에
      // input 을 감싼 div.input-area 와 **형제로** 제목 요소가 있다("field row1 fr_mod3813_in1"
      // > "input-area f_checkbox" 형제). 체크박스·라디오 옵션 텍스트는 label 이 input 을
      // 바로 감싸고 있어(§iweb 과 반대), input-area 안쪽을 먼저 보면 옵션 텍스트를 제목으로
      // 오인한다 — 그래서 input-area 가 아닌 형제를 **먼저** 본다.
      sel: ".field",
      getTitle: `
    var sib = g.querySelector(":scope > *:not(.input-area)");
    if (sib && sib.textContent.trim()) return sib.textContent.trim();
    var label = g.querySelector("label");
    return label ? label.textContent.trim() : "";`,
    },
  } as const;
  type SnifferPlatform = keyof typeof SNIFFER_PLATFORMS;

  function buildSnifferScript(platform: SnifferPlatform): string {
    const { sel, getTitle } = SNIFFER_PLATFORMS[platform];
    return `(function() {
  var SEL = ${JSON.stringify(sel)};
  function getTitle(g) {${getTitle}
  }
  var groups = Array.prototype.filter.call(document.querySelectorAll(SEL), function(g) {
    return g.querySelector("input, select, textarea");
  });
  var fields = groups.map(function(g, i) {
    var input = g.querySelector("input, select, textarea");
    var labelText = getTitle(g) || (input ? (input.placeholder || input.getAttribute("name") || "") : "");
    var type = "text";
    if (input) {
      if (input.tagName === "SELECT") type = "select";
      else if (input.type === "checkbox") type = "checkbox";
      else if (input.type === "radio") type = "radio";
    }
    return { index: i, key: "field_" + i, label: labelText, type: type };
  });
  var result = { selector: SEL, fields: fields };
  try { copy(JSON.stringify(result, null, 2)); } catch(e) {}
  console.log((fields.length === 0
    ? "0개 감지됨 — 이 방식은 이 사이트에 안 맞아요. 신청서 필드를 우클릭 → 검사로 감싸는 태그를 확인해서 '직접 입력'에 넣어주세요."
    : fields.length + "개 필드 감지됨") + " (선택자: " + SEL + ")");
  console.log(JSON.stringify(result, null, 2));
  return result;
})();`;
  }

  const snifferScript = buildSnifferScript(snifferPlatform);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!source) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">소스를 찾을 수 없어요</p>
        <Link href="/collect" className="text-sm text-violet-500 mt-2">목록으로</Link>
      </div>
    );
  }

  // 입장 열 — 체크인을 켰거나, 끈 뒤에도 이미 스캔 기록이 있으면 보인다(기록이 사라져 보이지 않게).
  const showCheckinCol = source.mode === "builder" && (Boolean(source.checkinEnabled) || records.some((r) => r.checkIn));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* 헤더 */}
      <div>
        <Link href="/collect" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
          <ArrowLeft className="w-3.5 h-3.5" />데이터 수집 목록
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-500 shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold">{source.name}</h1>
                {/* 방식은 되돌릴 수 없는 성질이라(레코드가 쌓이면 전환 불가) 이름 옆에 상시 노출한다. */}
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                  {source.mode === "builder" ? "빌더형" : "연동형"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {source.description && <p className="text-sm text-muted-foreground">{source.description}</p>}
                {source.siteUrl && (
                  <a href={source.siteUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <Globe className="w-3 h-3" />{source.siteUrl}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
          <ActiveToggle active={source.isActive} onChange={(next) => handleToggle(next)} size="md" />
        </div>
      </div>

      {/* 탭 */}
      <div className="sticky top-0 z-10 flex gap-1 border-b border-border bg-background overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabsFor(source.mode).map(({ id: tabId, label, icon: Icon }) => {
          const isDanger = tabId === "data-mgmt";
          const activeColor = isDanger ? "border-red-500 text-red-500" : "border-violet-500 text-violet-500";
          const idleColor = isDanger ? "border-transparent text-red-500/70 hover:text-red-500" : "border-transparent text-muted-foreground hover:text-foreground";
          return (
          <button key={tabId} onClick={() => setTab(tabId)}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === tabId ? activeColor : idleColor
            }`}
          >
            <Icon className="w-3.5 h-3.5" />{label}
            {tabId === "records" && recordsGrandTotal > 0 && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500">
                {recordsGrandTotal.toLocaleString()}
              </span>
            )}
          </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>

          {/* 현황 탭 — 이 폼의 등록 흐름·유입·구성(예전 프로젝트 대시보드의 실시간 보고서) */}
          {tab === "overview" && (
            <SourceOverviewTab workspaceId={source.workspaceId} projectId={source.projectId} sourceId={source.id} />
          )}

          {/* 기본 정보 탭 */}
          {tab === "info" && (
            <InfoTab
              sourceId={source.id}
              initial={source.venueConfig ?? {}}
              onSaved={(venueConfig) => setSource((current) => current ? { ...current, venueConfig } : current)}
            />
          )}

          {/* 현장 체크인 탭 (빌더형) — 권한은 서버가 본다(ADMIN 이상만 바꿀 수 있다) */}
          {tab === "checkin" && <CheckinTab sourceId={source.id} canEdit />}

          {/* 등록자 DB 탭 */}
          {tab === "records" && (
            <div>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  {hasActiveFilter
                    ? <>필터 결과 <span className="text-foreground font-medium">{recordsTotal.toLocaleString()}</span> / 전체 {recordsGrandTotal.toLocaleString()}건</>
                    : <>총 {recordsGrandTotal.toLocaleString()}건</>}
                  {selectedIds.size > 0 && <span className="ml-2 text-violet-500">· {selectedIds.size.toLocaleString()}건 선택</span>}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => setShowDeleteSelectedModal(true)}
                      disabled={isDeleting}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/5 text-red-500 text-xs font-medium hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {isDeleting ? "삭제 중..." : `선택 삭제`}
                    </button>
                  )}
                  <motion.button
                    whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring}
                    onClick={handleExportCsv}
                    disabled={recordsGrandTotal === 0 || isExporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-secondary transition-colors disabled:opacity-40"
                    title={hasActiveFilter || selectedIds.size > 0 ? "필터/선택된 결과만 내보냅니다" : "전체 데이터를 내보냅니다"}
                  >
                    {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}CSV 내보내기
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.92 }} transition={spring}
                    onClick={() => fetchRecords()}
                    className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </motion.button>
                  {/* 컬럼 표시 */}
                  <div ref={columnsMenuRef} className="relative">
                    <motion.button
                      whileTap={{ scale: 0.92 }} transition={spring}
                      onClick={() => setShowColumnsMenu((v) => !v)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                      title="컬럼 표시"
                    >
                      <Columns3 className="w-3.5 h-3.5" />
                    </motion.button>
                    <AnimatePresence>
                      {showColumnsMenu && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.97 }}
                          transition={{ duration: 0.1 }}
                          className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-xl shadow-lg z-20 overflow-hidden p-1"
                        >
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-1.5 pb-1">컬럼 표시</p>
                          <label className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-lg hover:bg-secondary transition-colors cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showUtmSource}
                              onChange={(e) => setShowUtmSource(e.target.checked)}
                              className="accent-violet-500"
                            />
                            UTM 소스
                          </label>
                          <label className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-lg hover:bg-secondary transition-colors cursor-pointer">
                            <input
                              type="checkbox"
                              checked={showUtmMedium}
                              onChange={(e) => setShowUtmMedium(e.target.checked)}
                              className="accent-violet-500"
                            />
                            UTM 매체
                          </label>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {/* 더보기 메뉴 */}
                  <div ref={moreMenuRef} className="relative">
                    <motion.button
                      whileTap={{ scale: 0.92 }} transition={spring}
                      onClick={() => setShowMoreMenu((v) => !v)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                      title="더보기"
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </motion.button>
                    <AnimatePresence>
                      {showMoreMenu && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.97 }}
                          transition={{ duration: 0.1 }}
                          className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-xl shadow-lg z-20 overflow-hidden"
                        >
                          <button
                            onClick={() => { setShowImport(true); setShowMoreMenu(false); }}
                            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs hover:bg-secondary transition-colors text-left"
                          >
                            <Upload className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                            <div>
                              <div className="font-medium">가져오기</div>
                              <div className="text-muted-foreground text-[11px]">엑셀/CSV</div>
                            </div>
                          </button>
                          <div className="border-t border-border" />
                          <button
                            onClick={() => { setShowNormalize(true); setShowMoreMenu(false); }}
                            disabled={recordsGrandTotal === 0}
                            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs hover:bg-secondary transition-colors text-left disabled:opacity-40"
                          >
                            <Eraser className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <div>
                              <div className="font-medium">정규화</div>
                              <div className="text-muted-foreground text-[11px]">전화번호·이름 형식 통일</div>
                            </div>
                          </button>
                          <button
                            onClick={() => { setShowCleanup(true); setShowMoreMenu(false); }}
                            disabled={recordsGrandTotal === 0 || source.fieldMappings.length === 0}
                            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs hover:bg-secondary transition-colors text-left disabled:opacity-40"
                          >
                            <Wand2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <div>
                              <div className="font-medium">데이터 정리</div>
                              <div className="text-muted-foreground text-[11px]">중복·빈 레코드 제거</div>
                            </div>
                          </button>
                          <div className="border-t border-border" />
                          <a
                            href={`/api/collect-sources/${id}/export-all`}
                            onClick={() => setShowMoreMenu(false)}
                            className="flex items-center gap-2 w-full px-3 py-2.5 text-xs hover:bg-secondary transition-colors text-left"
                          >
                            <HardDriveDownload className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                            <div>
                              <div className="font-medium">백업</div>
                              <div className="text-muted-foreground text-[11px]">전체 JSON 다운로드</div>
                            </div>
                          </a>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* 검색/필터 바 — 데이터가 있거나 필터가 적용된 동안 항상 표시 (0건 결과에서도 해제 가능하도록) */}
              {(recordsGrandTotal > 0 || hasActiveFilter) && (() => {
                const activeFilterCount = [filterDateFrom, filterDateTo, filterUtmSource, filterUtmMedium].filter(Boolean).length;
                return (
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="이름·이메일·휴대폰 등 모든 필드 검색"
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400"
                        />
                      </div>
                      <motion.button
                        whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring}
                        onClick={() => setFiltersOpen((v) => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          filtersOpen || activeFilterCount > 0
                            ? "border-violet-400/50 bg-violet-500/5 text-violet-500"
                            : "border-border text-muted-foreground hover:bg-secondary"
                        }`}
                      >
                        <Filter className="w-3.5 h-3.5" />필터
                        {activeFilterCount > 0 && (
                          <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400">
                            {activeFilterCount}
                          </span>
                        )}
                      </motion.button>
                    </div>
                    <AnimatePresence initial={false}>
                      {filtersOpen && (
                        <motion.div
                          key="filters"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden"
                        >
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <DateRangeField
                              from={filterDateFrom}
                              to={filterDateTo}
                              onChange={(f, t) => { setFilterDateFrom(f); setFilterDateTo(t); resetToFirstPage(); }}
                            />
                            {utmSourceOptions.length > 0 && (
                              <select
                                value={filterUtmSource}
                                onChange={(e) => { setFilterUtmSource(e.target.value); resetToFirstPage(); }}
                                className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400"
                              >
                                <option value="">UTM 소스 전체</option>
                                {utmSourceOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            )}
                            {utmMediumOptions.length > 0 && (
                              <select
                                value={filterUtmMedium}
                                onChange={(e) => { setFilterUtmMedium(e.target.value); resetToFirstPage(); }}
                                className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400"
                              >
                                <option value="">UTM 매체 전체</option>
                                {utmMediumOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            )}
                            {hasActiveFilter && (
                              <button onClick={resetFilters} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-secondary transition-colors">
                                <Filter className="w-3 h-3" />필터 해제
                              </button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })()}

              {/* 전체 결과 선택 배너 — 현재 페이지를 모두 선택했고, 페이지 밖에 더 있는 경우 */}
              {!selectAllMatching && records.length > 0 && recordsTotal > records.length && records.every((r) => selectedIds.has(r.id)) && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-400/30 text-xs flex items-center justify-between">
                  <span>이 페이지의 {records.length.toLocaleString()}건이 선택됐어요.</span>
                  <button
                    onClick={selectAllAcrossPages}
                    disabled={selectingAll}
                    className="text-violet-500 font-medium hover:underline disabled:opacity-50"
                  >
                    {selectingAll
                      ? "선택 중..."
                      : hasActiveFilter ? `필터된 ${recordsTotal.toLocaleString()}건 전체 선택` : `전체 ${recordsTotal.toLocaleString()}건 선택`}
                  </button>
                </div>
              )}
              {/* 전체 결과 선택됨 안내 */}
              {selectAllMatching && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-400/40 text-xs flex items-center justify-between">
                  <span>{hasActiveFilter ? `필터된 ${recordsTotal.toLocaleString()}건 전체가 선택됐어요.` : `전체 ${recordsTotal.toLocaleString()}건이 선택됐어요.`}</span>
                  <button
                    onClick={() => { setSelectAllMatching(false); setSelectedIds(new Set()); }}
                    className="text-violet-500 font-medium hover:underline"
                  >
                    선택 해제
                  </button>
                </div>
              )}
              {recordsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : recordsGrandTotal === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Table2 className="w-8 h-8 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">아직 수집된 데이터가 없어요</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {source.mode === "builder"
                      ? "등록 폼 탭에서 폼을 만들고 코드를 붙이면 여기 쌓여요"
                      : "스크립트를 설치하면 폼 제출 시 자동으로 수집돼요"}
                  </p>
                </div>
              ) : records.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Filter className="w-8 h-8 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">필터 조건에 맞는 데이터가 없어요</p>
                  <button onClick={resetFilters} className="text-xs text-violet-500 hover:underline mt-2">필터 해제</button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/50">
                        <th className="px-3 py-2.5 w-10 sticky left-0 z-10 bg-secondary/50">
                          <input
                            type="checkbox"
                            checked={records.length > 0 && records.every((r) => selectedIds.has(r.id))}
                            onChange={toggleSelectAll}
                            className="accent-violet-500 cursor-pointer"
                            aria-label="현재 페이지 모두 선택"
                          />
                        </th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap sticky left-10 z-10 bg-secondary/50 shadow-[1px_0_0_0_hsl(var(--border))]">
                          <button onClick={() => cycleSort("createdAt")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                            시간 {sortIcon("createdAt")}
                          </button>
                        </th>
                        {/* 등록번호는 빌더형에만 있고 시간 바로 뒤다 — 현장에서 스캔한 번호로 찾는다. */}
                        {source.mode === "builder" && (
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            등록번호
                          </th>
                        )}
                        {showCheckinCol && (
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            입장
                          </th>
                        )}
                        {source.fieldMappings.filter((f) => !f.hidden).map((f) => {
                          const colWidth = f.type === "email" ? "max-w-[240px]"
                            : (f.type === "select" || f.type === "checkbox") ? "max-w-[140px]"
                            : "max-w-[200px]";
                          /*
                            머리글도 잘라야 한다. max-w 만 주고 넘침 처리를 안 하면
                            whitespace-nowrap 인 긴 문항 제목이 칸을 넘어 **옆 열 위에 겹쳐 그려진다**
                            — 본문 td 에는 truncate 가 있어 데이터만 멀쩡하고 머리글만 뭉개졌다.
                            잘린 제목은 마우스를 올리면 전체가 보이게 title 을 단다.
                          */
                          return (
                          <th key={f.id} className={`text-left px-4 py-2.5 text-xs font-medium text-muted-foreground ${colWidth}`}>
                            <button
                              onClick={() => cycleSort("field", f.key)}
                              title={f.label}
                              className="flex w-full items-center gap-1 hover:text-foreground transition-colors"
                            >
                              <span className="truncate">{f.label}</span>
                              <span className="shrink-0">{sortIcon("field", f.key)}</span>
                            </button>
                          </th>
                          );
                        })}
                        {showUtmSource && (
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            <button onClick={() => cycleSort("utmSource")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                              UTM 소스 {sortIcon("utmSource")}
                            </button>
                          </th>
                        )}
                        {showUtmMedium && (
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">
                            <button onClick={() => cycleSort("utmMedium")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                              UTM 매체 {sortIcon("utmMedium")}
                            </button>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr
                          key={record.id}
                          onClick={() => setDetailRecordId(record.id)}
                          className={`group border-b border-border last:border-0 hover:bg-secondary/30 transition-colors cursor-pointer ${selectedIds.has(record.id) ? "bg-violet-500/5" : ""}`}
                        >
                          <td className={`px-3 py-3 w-10 sticky left-0 z-[1] ${selectedIds.has(record.id) ? "bg-violet-500/5" : "bg-background group-hover:bg-secondary/30"}`} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(record.id)}
                              onChange={() => toggleSelect(record.id)}
                              className="accent-violet-500 cursor-pointer"
                              aria-label="선택"
                            />
                          </td>
                          <td className={`px-4 py-3 text-xs text-muted-foreground whitespace-nowrap sticky left-10 z-[1] shadow-[1px_0_0_0_hsl(var(--border))] ${selectedIds.has(record.id) ? "bg-violet-500/5" : "bg-background group-hover:bg-secondary/30"}`}>{timeStr(record.createdAt)}</td>
                          {source.mode === "builder" && (
                            <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                              {record.registrationNo ?? "-"}
                            </td>
                          )}
                          {showCheckinCol && (
                            <td className="px-4 py-3 text-xs whitespace-nowrap tabular-nums" title={record.checkIn ? `마지막 스캔 ${dateTimeIn(source.checkinTimezone ?? "Asia/Seoul", record.checkIn.lastAt)}` : undefined}>
                              {record.checkIn ? (
                                <span className="text-emerald-700 dark:text-emerald-400">
                                  {dateTimeIn(source.checkinTimezone ?? "Asia/Seoul", record.checkIn.firstAt)}
                                  {record.checkIn.count > 1 && <span className="ml-1 text-muted-foreground">· {record.checkIn.count}회</span>}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          )}
                          {source.fieldMappings.filter((f) => !f.hidden).map((f) => {
                            const colWidth = f.type === "email" ? "max-w-[240px]"
                              : (f.type === "select" || f.type === "checkbox") ? "max-w-[80px]"
                              : "max-w-[200px]";
                            return (
                            <td key={f.id} className={`px-4 py-3 text-xs ${colWidth} truncate`}>{formatCollectValue(record.data[f.key]) || "-"}</td>
                            );
                          })}
                          {showUtmSource && <td className="px-4 py-3 text-xs text-muted-foreground">{record.utmSource ?? "-"}</td>}
                          {showUtmMedium && <td className="px-4 py-3 text-xs text-muted-foreground">{record.utmMedium ?? "-"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!recordsLoading && records.length > 0 && (
                <div className="flex items-center justify-between gap-3 mt-3 px-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {recordsTotal === 0 ? 0 : (pageStart + 1).toLocaleString()}–{Math.min(pageEnd, recordsTotal).toLocaleString()} / {recordsTotal.toLocaleString()}건
                    </span>
                    <span className="text-muted-foreground/40">·</span>
                    <label className="flex items-center gap-1">
                      페이지당
                      <select
                        value={pageSize}
                        onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
                        className="px-1.5 py-0.5 rounded border border-border bg-background text-xs focus:outline-none focus:border-violet-400"
                      >
                        {[25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(1)}
                      disabled={safePage === 1}
                      className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      처음
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                      className="p-1 rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="이전 페이지"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs text-muted-foreground px-2 tabular-nums">
                      {safePage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                      className="p-1 rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="다음 페이지"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={safePage === totalPages}
                      className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      마지막
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 등록 폼 탭 — 빌더형 전용(tabsFor 가 연동형에는 안 준다) */}
          {tab === "form" && (
            <FormBuilderTab
              sourceId={source.id}
              initialConfig={source.formConfig}
              previewToken={source.previewToken}
              workspaceId={workspace?.id}
              onSaved={(formConfig) => setSource((current) => (current ? { ...current, formConfig } : current))}
            />
          )}

          {tab === "fields" && (
            <div className="space-y-5">
              {/* A: 자동 감지된 필드 */}
              {source.discoveredFields && source.discoveredFields.length > 0 && (
                <div className="p-4 rounded-2xl border border-violet-400/30 bg-violet-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-500" />
                      <span className="text-sm font-medium text-violet-500">스크립트가 감지한 필드</span>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={applyDiscoveredFields}
                      className="px-3 py-1.5 rounded-xl bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors"
                    >
                      한 번에 적용
                    </motion.button>
                  </div>
                  <div className="space-y-1.5">
                    {source.discoveredFields.map((f) => (
                      <div key={f.index} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-background border border-border text-xs">
                        <span className="w-6 text-center font-mono text-muted-foreground">{f.index}</span>
                        <span className="flex-1 font-medium">{f.label || <span className="text-muted-foreground italic">라벨 없음</span>}</span>
                        <span className="text-muted-foreground">{f.type}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">실제 폼 제출 시 스크립트가 감지한 필드예요. &ldquo;한 번에 적용&rdquo; 후 라벨과 키를 수정하세요.</p>
                </div>
              )}

              {/* 필드 매핑 편집기 */}
              <div className="border-t border-border pt-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium">필드 매핑</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      인덱스는 아래 &ldquo;필드 묶음 선택자&rdquo;로 찾은 순서(0부터)예요 · 눈 아이콘으로 등록자 DB 표에 보일지 정해요(값은 계속 수집돼요) · &ldquo;필수&rdquo;를 하나라도 켜면, 그 필드들이 전부 채워진 제출만 저장돼요 · &ldquo;통계&rdquo;는 현황 탭에 값 분포 카드로 보일지예요(기본 켜짐, 필요없으면 꺼주세요)
                    </p>
                  </div>
                </div>

                <Reorder.Group axis="y" values={fields} onReorder={setFields} className="space-y-2">
                  {fields.map((field, idx) => (
                    <Reorder.Item key={field.id} value={field}>
                      <div className={`flex items-center gap-2 p-3 rounded-xl border border-border bg-background transition-opacity ${field.hidden ? "opacity-50" : ""}`}>
                        <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab shrink-0" />
                        <div className="w-10 shrink-0">
                          <input type="number" min={0} value={field.index}
                            onChange={(e) => updateField(idx, { index: parseInt(e.target.value) || 0 })}
                            className="w-full px-2 py-1 rounded-lg border border-border bg-background text-xs text-center focus:outline-none focus:border-violet-400"
                            title="form-group 인덱스" />
                        </div>
                        <input type="text" value={field.key} onChange={(e) => updateField(idx, { key: e.target.value })}
                          placeholder="키 (영문)"
                          className="flex-1 px-2 py-1 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400" />
                        <input type="text" value={field.label} onChange={(e) => updateField(idx, { label: e.target.value })}
                          placeholder="라벨 (예: 이름)"
                          className="flex-1 px-2 py-1 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400" />
                        <select value={field.type} onChange={(e) => updateField(idx, { type: e.target.value })}
                          className="px-2 py-1 rounded-lg border border-border bg-background text-xs focus:outline-none focus:border-violet-400">
                          <option value="text">텍스트</option>
                          <option value="select">선택</option>
                          <option value="checkbox">체크박스</option>
                          <option value="radio">라디오</option>
                        </select>
                        <label
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border text-xs text-muted-foreground shrink-0 cursor-pointer hover:bg-secondary transition-colors"
                          title="이 필드가 비어있으면 그 제출 자체를 저장하지 않아요 (수집 스크립트가 전송 전에 걸러요)"
                        >
                          <input
                            type="checkbox"
                            checked={field.isRequired}
                            onChange={(e) => updateField(idx, { isRequired: e.target.checked })}
                            className="w-3.5 h-3.5 accent-violet-500"
                          />
                          필수
                        </label>
                        <label
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border text-xs text-muted-foreground shrink-0 cursor-pointer hover:bg-secondary transition-colors"
                          title="프로젝트 대시보드에 이 필드의 값 분포를 카드로 보여줘요 — 필요없으면 꺼도 수집 자체는 계속돼요"
                        >
                          <input
                            type="checkbox"
                            checked={field.showInDashboard}
                            onChange={(e) => updateField(idx, { showInDashboard: e.target.checked })}
                            className="w-3.5 h-3.5 accent-violet-500"
                          />
                          통계
                        </label>
                        <button onClick={() => updateField(idx, { hidden: !field.hidden })}
                          title={field.hidden ? "등록자 DB 표에서 숨김 — 클릭해서 보이기" : "등록자 DB 표에 보임 — 클릭해서 숨기기"}
                          className={`p-1 rounded-lg transition-colors shrink-0 ${field.hidden ? "text-muted-foreground hover:text-foreground hover:bg-secondary" : "text-violet-500 hover:bg-violet-500/10"}`}>
                          {field.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => removeField(idx)}
                          className="p-1 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors text-muted-foreground shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>

                <div className="flex gap-2 mt-3">
                  <button onClick={addField}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-violet-400 hover:text-violet-500 transition-colors">
                    <Plus className="w-3.5 h-3.5" />필드 추가
                  </button>
                  <button onClick={handleSaveFields} disabled={isSavingFields}
                    className="px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40">
                    {isSavingFields ? "저장 중..." : "필드 저장"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 스크립트 탭 */}
          {tab === "script" && (
            <div className="space-y-5">
              {browserOrigin.includes("localhost") && (
                <div className="p-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">로컬 스크립트 주의</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      현재 localhost에서 열고 있어 복사한 스크립트는 localhost API로 전송됩니다.
                      아임웹 운영 사이트에는 <b>machstudio.vercel.app</b>에서 접속한 뒤 스크립트를 복사해 설치하세요.
                    </p>
                  </div>
                </div>
              )}

              {/* A: 1줄 설치 (권장) */}
              {browserOrigin && (
                <div className="rounded-2xl border border-violet-400/50 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-5 space-y-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
                        <p className="text-sm font-semibold">1줄 설치 (권장)</p>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500 text-white">NEW</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        사이트 공통 헤더에 1줄 설치. 필드/리다이렉트 수정도 자동 반영돼요.
                        <br />
                        <span className="text-foreground/80">아래에서 폼 페이지를 지정하면 그 페이지에서만 폼 감지가 작동</span>해 false positive를 방지해요.
                      </p>
                    </div>
                    <CopyCodeButton text={`<script async src="${browserOrigin}/s/${id}"></script>`} />
                  </div>
                  <pre className="p-3 rounded-xl bg-secondary/80 border border-border text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
{`<script async src="${browserOrigin}/s/${id}"></script>`}
                  </pre>
                  <ul className="text-[11px] text-muted-foreground space-y-1">
                    <li className="flex items-center gap-1.5"><Check className="w-3 h-3 text-violet-500 shrink-0" /> 짧음 — 사이트 코드에 노출되어도 노이즈 없음</li>
                    <li className="flex items-center gap-1.5"><Check className="w-3 h-3 text-violet-500 shrink-0" /> 자동 업데이트 — 필드를 바꿔도 사이트 재설치 불필요 (5~10분 캐시)</li>
                    <li className="flex items-center gap-1.5"><Check className="w-3 h-3 text-violet-500 shrink-0" /> CDN 캐싱으로 빠름</li>
                  </ul>
                </div>
              )}

              {/* 폼 페이지 지정 — 패턴에 매칭된 페이지에서만 폼 감지가 작동. 빈 배열이면 모든 페이지. */}
              <div className="rounded-2xl border border-border bg-background p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">폼 페이지 지정 <span className="text-xs font-normal text-muted-foreground">(선택)</span></p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      등록 폼이 있는 페이지의 URL 경로만 입력하세요. 비워두면 모든 페이지에서 폼 감지가 작동해요.
                      <br />
                      <span className="text-foreground/70">UTM 캡처는 패턴과 상관없이 모든 페이지에서 계속 동작합니다.</span>
                    </p>
                  </div>
                </div>

                {formPagePatterns.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <AnimatePresence initial={false}>
                      {formPagePatterns.map((pattern) => (
                        <motion.span
                          key={pattern}
                          layout
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={spring}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-400/40 text-xs font-mono text-violet-700 dark:text-violet-300"
                        >
                          {pattern}
                          <button
                            type="button"
                            onClick={() => removeFormPagePattern(pattern)}
                            aria-label={`${pattern} 제거`}
                            className="hover:text-violet-900 dark:hover:text-violet-100 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={formPagePatternInput}
                    onChange={(e) => setFormPagePatternInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addFormPagePattern();
                      }
                    }}
                    placeholder="/event/register, /2026/* 등 — Enter로 추가"
                    className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-sm font-mono focus:outline-none focus:border-violet-400"
                  />
                  <motion.button
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={spring}
                    onClick={addFormPagePattern}
                    disabled={!formPagePatternInput.trim()}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border text-xs font-medium hover:border-violet-400 hover:text-violet-500 transition-colors disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />추가
                  </motion.button>
                </div>

                <div className="text-[11px] text-muted-foreground leading-relaxed bg-secondary/50 rounded-xl px-3 py-2 space-y-0.5">
                  <p className="font-medium text-foreground/80">예시</p>
                  <p>· <span className="font-mono">/event/register</span> — 정확한 경로</p>
                  <p>· <span className="font-mono">/event/*/register</span> — 와일드카드</p>
                  <p>· <span className="font-mono">/2026/*</span> — 하위 모든 경로</p>
                </div>

                <div className="flex justify-end">
                  <motion.button
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={spring}
                    onClick={() => void handleSaveFormPagePatterns()}
                    disabled={savingFormPagePatterns}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
                  >
                    {savingFormPagePatterns ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    저장
                  </motion.button>
                </div>
              </div>

              {/* 중복 기준 필드 — 가져오기 시 이 필드들로 중복 판정 */}
              <div className="rounded-2xl border border-border bg-background p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Layers className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">중복 기준 필드 <span className="text-xs font-normal text-muted-foreground">(선택)</span></p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      엑셀/CSV 가져오기에서 &quot;중복 건너뛰기&quot;로 중복을 판정할 기준 필드예요.
                      위에서부터 우선 적용하고, 값이 비어있으면 다음 필드로 넘어가요.
                      <br />
                      <span className="text-foreground/70">비워두면 전체 항목이 같을 때만 중복으로 봐요.</span>
                    </p>
                  </div>
                </div>

                {/* 선택된 필드 — 순서 = 우선순위 */}
                {dedupKeyFields.length > 0 && (
                  <div className="space-y-1.5">
                    <AnimatePresence initial={false}>
                      {dedupKeyFields.map((fk, idx) => {
                        const label = fields.find((f) => f.key === fk)?.label ?? fk;
                        return (
                          <motion.div
                            key={fk}
                            layout
                            initial={{ opacity: 0, scale: 0.97 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            transition={spring}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/5 border border-violet-400/30"
                          >
                            <span className="text-[11px] font-mono text-violet-500 w-9 shrink-0">{idx + 1}순위</span>
                            <span className="flex-1 text-sm min-w-0 truncate">{label} <span className="text-xs font-mono text-muted-foreground">({fk})</span></span>
                            <button
                              type="button"
                              onClick={() => setDedupKeyFields((arr) => arr.filter((x) => x !== fk))}
                              aria-label={`${label} 제거`}
                              className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}

                {/* 필드 추가 드롭다운 */}
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && !dedupKeyFields.includes(v)) setDedupKeyFields((arr) => [...arr, v].slice(0, 10));
                    }}
                    className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400"
                  >
                    <option value="">+ 기준 필드 추가</option>
                    {fields.filter((f) => !dedupKeyFields.includes(f.key)).map((f) => (
                      <option key={f.key} value={f.key}>{f.label} ({f.key})</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end">
                  <motion.button
                    type="button"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={spring}
                    onClick={() => void handleSaveDedupKeyFields()}
                    disabled={savingDedup}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
                  >
                    {savingDedup ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    저장
                  </motion.button>
                </div>
              </div>

              {/* B: 콘솔 스니퍼 */}
              <div className="p-4 rounded-2xl border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium">필드 자동 감지 (설치 전 사용)</span>
                </div>

                {/* 플랫폼마다 스니퍼를 완전히 따로 둔다 — 한 스크립트가 여러 방식을 동시에 시도해
                    "매칭 개수가 제일 많은 쪽"을 고르면, 폼과 무관한 다른 표가 페이지 어딘가에
                    있을 때 그쪽이 이겨서 오감지한다(아임웹에서 실제로 그랬다). 지금 보고 있는
                    사이트가 뭔지는 운영자가 이미 아니까, 그 앎을 탭으로 그대로 받는다. */}
                <div className="flex items-center gap-1.5 mb-3">
                  {(Object.keys(SNIFFER_PLATFORMS) as Array<keyof typeof SNIFFER_PLATFORMS>).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSnifferPlatform(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        snifferPlatform === p ? "bg-amber-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {SNIFFER_PLATFORMS[p].label}
                    </button>
                  ))}
                </div>

                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside mb-3">
                  <li>등록 폼 페이지를 열고 브라우저 콘솔(F12)을 엽니다</li>
                  <li>위에서 이 사이트를 만든 플랫폼을 고르고, 아래 스크립트를 콘솔에 붙여넣고 Enter</li>
                  <li>출력된 JSON을 아래에 붙여넣기 → 필드와 감지 방식이 자동 입력</li>
                </ol>
                <div className="relative mb-3">
                  <div className="absolute top-2 right-2">
                    <CopyButton text={snifferScript} />
                  </div>
                  <pre className="p-3 rounded-xl bg-secondary border border-border text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed pr-10">
                    {snifferScript}
                  </pre>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ClipboardPaste className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">콘솔 출력 결과 붙여넣기</span>
                  </div>
                  <textarea
                    value={pasteJson}
                    onChange={(e) => { setPasteJson(e.target.value); setPasteError(""); }}
                    placeholder={'[\n  { "index": 0, "key": "field_0", "label": "이름", "type": "text" },\n  ...\n]'}
                    rows={4}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-xs font-mono focus:outline-none focus:border-violet-400 resize-none"
                  />
                  {pasteError && <p className="text-xs text-red-500">{pasteError}</p>}
                  <button
                    onClick={applyPastedJson}
                    disabled={!pasteJson.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 transition-colors disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />필드 적용
                  </button>
                </div>

                {/* 감지 선택자 — 스니퍼가 자동으로 채워 주지만, 0개가 나온 사이트는 직접 확인해서 넣는다. */}
                <div className="mt-4 pt-4 border-t border-border space-y-1.5">
                  <span className="text-xs font-medium">필드 묶음 선택자</span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    실제로 폼에 설치되는 스크립트가 필드 하나를 찾을 때 쓰는 CSS 선택자예요. 위 스니퍼가 감지에
                    성공하면 자동으로 채워져요. 0개가 나왔다면 신청서 필드 하나를 우클릭 → 검사로 감싸는 태그를
                    확인해서 직접 입력하세요(예: 표 형태면 <code className="font-mono">table tr</code>).
                  </p>
                  <input
                    type="text"
                    value={fieldGroupSelector}
                    onChange={(e) => setFieldGroupSelector(e.target.value)}
                    placeholder=".form-group"
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-xs font-mono focus:outline-none focus:border-violet-400"
                  />
                  <button
                    onClick={() => void handleSaveSettings()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />선택자 저장
                  </button>
                </div>
              </div>

              {/* 고급: 인라인 설치 (전체 코드) — 1줄 설치가 안 되는 환경용 */}
              <details className="group rounded-2xl border border-border bg-background/50">
                <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 hover:bg-secondary/40 rounded-2xl transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">고급: 인라인 설치 (전체 코드)</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">CSP나 외부 스크립트가 막힌 환경에서만 사용하세요. 코드 수정 시 사이트에 다시 붙여넣어야 합니다.</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">펼치기</span>
                  <span className="shrink-0 text-xs text-muted-foreground hidden group-open:inline">접기</span>
                </summary>
                <div className="px-4 pb-4 pt-2 space-y-5">
              {/* 공통 UTM 보존 코드 */}
              <div>
                {scriptLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : utmScript ? (
                  <div className="rounded-2xl border border-border bg-violet-500/5 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-violet-500 shrink-0" />
                          <p className="text-sm font-medium">1. 공통 UTM 보존 코드</p>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                          사이트 전체 공통 헤더/푸터에 한 번만 설치하세요. 사용자가 다른 페이지를 둘러보다가 등록해도 UTM을 30일 동안 이어받습니다.
                        </p>
                      </div>
                      <CopyCodeButton text={`<script>\n${utmScript}\n</script>`} />
                    </div>
                    <details className="group">
                      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                        코드 미리보기
                        <span className="ml-1 text-muted-foreground/60 group-open:hidden">펼치기</span>
                        <span className="ml-1 text-muted-foreground/60 hidden group-open:inline">접기</span>
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto p-4 rounded-2xl bg-secondary border border-border text-xs font-mono whitespace-pre-wrap leading-relaxed">
                        {`<script>\n${utmScript}\n</script>`}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Code2 className="w-8 h-8 text-muted-foreground/20 mb-3" />
                    <p className="text-sm text-muted-foreground">UTM 보존 코드가 아직 생성되지 않았어요</p>
                  </div>
                )}
              </div>

              {/* 실제 수집 스크립트 */}
              <div>
                {scriptLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : script ? (
                  <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Code2 className="w-4 h-4 text-violet-500 shrink-0" />
                          <p className="text-sm font-medium">2. 실제 수집 스크립트</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">등록 폼이 있는 페이지의 사용자 정의 코드 → &lt;/body&gt; 앞에 붙여넣기</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setShowTest(true)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-background text-xs font-medium hover:bg-secondary transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5" />설치 테스트
                        </button>
                        <CopyCodeButton text={`<script>\n${script}\n</script>`} />
                      </div>
                    </div>
                    <details className="group">
                      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">
                        코드 미리보기
                        <span className="ml-1 text-muted-foreground/60 group-open:hidden">펼치기</span>
                        <span className="ml-1 text-muted-foreground/60 hidden group-open:inline">접기</span>
                      </summary>
                      <pre className="mt-3 max-h-64 overflow-auto p-4 rounded-2xl bg-secondary border border-border text-xs font-mono whitespace-pre-wrap leading-relaxed">
                        {`<script>\n${script}\n</script>`}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Code2 className="w-8 h-8 text-muted-foreground/20 mb-3" />
                    <p className="text-sm text-muted-foreground">필드를 먼저 설정하면 스크립트가 생성돼요</p>
                  </div>
                )}
              </div>
                </div>
              </details>
            </div>
          )}

          {/* 설치 탭 */}
          {tab === "install" && (
            <div className="space-y-4 max-w-2xl">
              {/* 성공 트리거 / 리다이렉트 */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-violet-500" />
                  <h3 className="text-sm font-medium">제출 성공 동작</h3>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">성공 트리거 텍스트</label>
                  <input type="text" value={successTrigger} onChange={(e) => setSuccessTrigger(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400" />
                  <p className="text-[11px] text-muted-foreground mt-1">폼 제출 후 이 텍스트가 나타나면 데이터를 수집해요</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">제출 후 리다이렉트 URL <span className="text-muted-foreground/60">(선택)</span></label>
                  <input type="url" value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)}
                    placeholder="https://example.com/thank-you"
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:border-violet-400" />
                </div>
              </div>

              <div className="flex justify-end">
                <motion.button
                  whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring}
                  onClick={() => {
                    void handleSaveSettings();
                    void handleSaveSecuritySettings();
                  }}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
                >
                  {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  설치 설정 저장
                </motion.button>
              </div>
            </div>
          )}

          {/* 설정 탭 */}
          {tab === "settings" && (
            <div className="space-y-4 max-w-2xl">
              {/* 알림 */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-medium">새 제출 알림</h3>
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsNotifyOnSubmit}
                    onChange={(e) => setSettingsNotifyOnSubmit(e.target.checked)}
                    className="mt-0.5 accent-violet-500 cursor-pointer"
                  />
                  <div>
                    <p className="text-sm">인앱 알림 켜기</p>
                    <p className="text-[11px] text-muted-foreground">새 폼 제출이 있을 때 워크스페이스 멤버들에게 알림이 표시돼요</p>
                  </div>
                </label>
              </div>

              {/* 웹훅 */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <Webhook className="w-4 h-4 text-blue-500" />
                  <h3 className="text-sm font-medium">웹훅 URL</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  새 레코드가 수집되면 이 URL로 POST 요청을 보냅니다. Slack incoming webhook, Discord, Zapier 등에 연결할 수 있어요.
                </p>
                <input
                  type="url"
                  value={settingsWebhookUrl}
                  onChange={(e) => setSettingsWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm font-mono focus:outline-none focus:border-violet-400"
                />
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">전송되는 페이로드 형식</summary>
                  <pre className="mt-2 p-2 rounded-lg bg-secondary border border-border overflow-x-auto">{`{
  "event": "record.created",
  "sourceId": "...",
  "sourceName": "...",
  "recordId": "...",
  "data": { ... },
  "utm": { "utmSource": "...", ... },
  "createdAt": "ISO 8601"
}`}</pre>
                </details>
              </div>

              {/* 허용 Origin */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-medium">허용 Origin (CORS)</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  비워두면 모든 출처에서 호출 가능합니다. 보안을 위해 실제 폼이 있는 도메인만 허용하세요. 한 줄에 하나씩, 또는 쉼표로 구분.
                </p>
                <textarea
                  value={settingsAllowedOrigins}
                  onChange={(e) => setSettingsAllowedOrigins(e.target.value)}
                  placeholder={"https://example.com\nhttps://www.example.com"}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm font-mono focus:outline-none focus:border-violet-400 resize-none"
                />
              </div>

              {/* API 키 */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-violet-500" />
                  <h3 className="text-sm font-medium">API 키</h3>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary border border-border">
                  <span className="text-xs font-mono truncate flex-1">{source.apiKey}</span>
                  <CopyButton text={source.apiKey} />
                </div>
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => setShowRegenerateKeyModal(true)}
                    disabled={regeneratingKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/5 text-red-500 text-xs font-medium hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  >
                    {regeneratingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                    키 재발급
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    키가 유출됐거나 정기 교체할 때 사용하세요. 재발급 시 기존 스크립트는 즉시 동작을 멈추고, 새 키로 다시 설치해야 해요.
                  </p>
                </div>
              </div>

              {/* 보관 정책 */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-medium">자동 보관 기간</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  설정 일수가 지난 레코드는 매일 자동 삭제됩니다. 개인정보 보호 대응.
                </p>
                <RetentionPolicyEditor sourceId={id} />
              </div>

              <div className="flex justify-end">
                <motion.button
                  whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={spring}
                  onClick={() => {
                    void handleSaveSettings();
                    void handleSaveSecuritySettings();
                  }}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
                >
                  {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  설정 저장
                </motion.button>
              </div>
            </div>
          )}

          {/* 데이터 관리 탭 */}
          {tab === "data-mgmt" && (
            <div className="space-y-4 max-w-2xl">
              {/* 분석 연동 (GA4) — 이 소스가 아니라 프로젝트 전체에 적용되는 설정이라 아래 안내에서 밝힌다 */}
              <div className="p-4 rounded-2xl border border-border bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-violet-500" />
                  <h3 className="text-sm font-medium">분석 연동 (GA4)</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  이미 설치된 GA4에서 홈페이지·사전등록 페이지 방문자 수를 가져와 요약 카드 퍼널에 표시해요.
                  이 프로젝트 전체에 적용되는 설정이에요 — 이 프로젝트에 다른 수집 소스가 있다면 거기도 함께 바뀌어요.
                </p>
                {ga4Loading ? (
                  <div className="flex items-center justify-center h-20">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">GA4 속성</span>
                      <Ga4PropertySelect value={ga4PropertyId} onChange={setGa4PropertyId} properties={ga4Properties} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">작년 GA4 속성 (선택)</span>
                      <Ga4PropertySelect value={ga4PreviousYearPropertyId} onChange={setGa4PreviousYearPropertyId} properties={ga4Properties} />
                      <span className="block text-[11px] text-muted-foreground">
                        지정하면 홈페이지·사전등록 페이지 방문에도 &quot;전년 동일 D구간&quot; 비교가 떠요.
                        이번 해·작년 소스 양쪽에 행사 일자가 설정돼 있어야 계산돼요(기본 정보 탭).
                      </span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">사전등록 페이지 경로 (선택)</span>
                      <input
                        type="text"
                        value={ga4RegistrationPagePath}
                        onChange={(e) => setGa4RegistrationPagePath(e.target.value)}
                        placeholder="예: /Pre-registration"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none transition-colors focus:border-violet-400"
                      />
                      <span className="block text-[11px] text-muted-foreground">
                        비워두면 사전등록 페이지 방문자는 표시하지 않아요.
                      </span>
                    </label>
                    <motion.button
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.96 }}
                      transition={spring}
                      onClick={handleSaveGa4}
                      disabled={ga4Saving}
                      className="px-3 py-1.5 rounded-lg bg-violet-500 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50 w-fit"
                    >
                      {ga4Saving ? "저장 중..." : "저장"}
                    </motion.button>
                  </>
                )}
              </div>

              {/* 백업 */}
              <div className="p-4 rounded-2xl border border-red-500/30 bg-background space-y-3">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-violet-500" />
                  <h3 className="text-sm font-medium">데이터 백업</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  소스 설정 + 필드 매핑 + 모든 수집 레코드를 단일 JSON 파일로 다운로드합니다.
                </p>
                <a
                  href={`/api/collect-sources/${id}/export-all`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-secondary transition-colors w-fit"
                >
                  <Download className="w-3.5 h-3.5" />전체 JSON 백업 다운로드
                </a>
              </div>

              {/* GDPR */}
              <div className="p-4 rounded-2xl border border-red-500/30 bg-amber-500/5 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-medium">개인정보 검색·삭제 (GDPR)</h3>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  특정 이메일/전화 등이 포함된 레코드를 찾아 일괄 삭제. right-to-erasure 대응.
                </p>
                <button
                  onClick={() => setShowGdpr(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors w-fit"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />검색·삭제 열기
                </button>
              </div>

              {/* 위험 영역 */}
              <div className="p-4 rounded-2xl border-2 border-red-500/30 bg-red-500/5 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">위험 영역</h3>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">모든 수집 레코드 삭제</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      이 소스에 수집된 모든 데이터({recordsGrandTotal.toLocaleString()}건)를 영구 삭제합니다. 되돌릴 수 없어요.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDangerDelete(true)}
                    disabled={recordsGrandTotal === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />전체 삭제
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 활동 로그 탭 */}
          {tab === "activity" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">최근 활동 {activityLogs.length}건</p>
                <button onClick={fetchActivity} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              {activityLoading ? (
                <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : activityLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">기록된 활동이 없어요</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {activityLogs.map((log) => (
                    <ActivityRow key={log.id} log={log} />
                  ))}
                </div>
              )}
            </div>
          )}

        </motion.div>
      </AnimatePresence>

      {/* 선택 삭제 확인 모달 */}
      <AnimatePresence>
        {showDeleteSelectedModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setShowDeleteSelectedModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-background border border-border rounded-2xl p-6 w-80 max-w-[calc(100vw-2rem)] shadow-xl"
            >
              <h3 className="text-base font-semibold mb-2">레코드 삭제</h3>
              <p className="text-sm text-muted-foreground mb-5">선택한 <span className="font-medium text-foreground">{selectedIds.size.toLocaleString()}건</span>을 삭제할까요? 되돌릴 수 없어요.</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                  className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-40"
                >
                  {isDeleting ? "삭제 중..." : "삭제"}
                </button>
                <button
                  onClick={() => setShowDeleteSelectedModal(false)}
                  className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-secondary transition-colors"
                >
                  취소
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* API 키 재발급 확인 모달 */}
      <AnimatePresence>
        {showRegenerateKeyModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setShowRegenerateKeyModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-background border border-border rounded-2xl p-6 w-80 max-w-[calc(100vw-2rem)] shadow-xl"
            >
              <h3 className="text-base font-semibold mb-2">API 키 재발급</h3>
              <p className="text-sm text-muted-foreground mb-5">기존 키로 설치된 스크립트는 <span className="font-medium text-foreground">즉시 동작을 멈춥니다</span>. 재발급 후 스크립트를 다시 설치해야 해요.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowRegenerateKeyModal(false); void handleRegenerateKey(); }}
                  disabled={regeneratingKey}
                  className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-40"
                >
                  {regeneratingKey ? "재발급 중..." : "재발급"}
                </button>
                <button
                  onClick={() => setShowRegenerateKeyModal(false)}
                  className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-secondary transition-colors"
                >
                  취소
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {showImport && (
        <ImportModal
          sourceId={id}
          fieldMappings={source.fieldMappings}
          onClose={() => setShowImport(false)}
          onImported={() => { fetchRecords(); fetchSource(); }}
        />
      )}

      {showCleanup && (
        <CleanupModal
          sourceId={id}
          fieldMappings={source.fieldMappings}
          onClose={() => setShowCleanup(false)}
          onCleaned={() => { fetchRecords(); fetchSource(); }}
        />
      )}

      {showNormalize && (
        <NormalizeModal
          sourceId={id}
          fieldMappings={source.fieldMappings}
          onClose={() => setShowNormalize(false)}
          onApplied={() => { fetchRecords(); }}
        />
      )}

      {showTest && (
        <TestModal
          sourceId={id}
          siteUrl={source.siteUrl}
          fieldMappings={source.fieldMappings}
          onClose={() => setShowTest(false)}
          onRecordReceived={() => { fetchRecords(); fetchSource(); }}
        />
      )}

      {showDangerDelete && (
        <DangerDeleteModal
          sourceId={id}
          sourceName={source.name}
          recordCount={recordsGrandTotal}
          onClose={() => setShowDangerDelete(false)}
          onDeleted={() => { fetchRecords(); fetchSource(); }}
        />
      )}

      {showGdpr && (
        <GdprModal
          sourceId={id}
          onClose={() => setShowGdpr(false)}
          onChanged={() => { fetchRecords(); fetchSource(); }}
        />
      )}

      {detailRecordId && (
        <RecordDetailModal
          sourceId={id}
          recordId={detailRecordId}
          fieldMappings={source.fieldMappings}
          onClose={() => setDetailRecordId(null)}
          onChanged={() => { fetchRecords(); fetchSource(); }}
        />
      )}
    </div>
  );
}

// ── 활동 로그 행 ──────────────────────────────────────
function ActivityRow({ log }: { log: ActivityLogEntry }) {
  const { label, color } = activityLabel(log.action);
  const meta = log.meta ?? {};
  const summary = activitySummary(log.action, meta);
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-border bg-background">
      <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-medium">{label}</p>
          {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {formatKstDateTime(log.createdAt)} KST
          {log.user && <> · {log.user.name ?? log.user.email}</>}
        </p>
      </div>
    </div>
  );
}

function activityLabel(action: string): { label: string; color: string } {
  switch (action) {
    case "source.created":         return { label: "소스 생성",         color: "bg-emerald-500" };
    case "source.updated":         return { label: "소스 설정 변경",     color: "bg-blue-500" };
    case "source.deleted":         return { label: "소스 삭제",         color: "bg-red-500" };
    case "source.key_regenerated": return { label: "API 키 재발급",      color: "bg-amber-500" };
    case "source.preview_token_regenerated": return { label: "미리보기 링크 재발급", color: "bg-amber-500" };
    case "record.created":         return { label: "레코드 생성",        color: "bg-emerald-500" };
    case "record.updated":         return { label: "레코드 편집",        color: "bg-blue-500" };
    case "record.deleted":         return { label: "레코드 삭제",        color: "bg-red-500" };
    case "records.bulk_deleted":   return { label: "레코드 일괄 삭제",   color: "bg-red-500" };
    case "records.imported":       return { label: "데이터 가져오기",    color: "bg-violet-500" };
    case "records.cleaned":        return { label: "중복 정리",          color: "bg-amber-500" };
    case "records.normalized":     return { label: "데이터 정규화",      color: "bg-emerald-500" };
    default:                       return { label: action,              color: "bg-muted-foreground/40" };
  }
}

function activitySummary(action: string, meta: Record<string, unknown>): string {
  if (action === "records.imported") {
    const parts: string[] = [];
    if (typeof meta.imported === "number") parts.push(`신규 ${meta.imported}`);
    if (typeof meta.updated === "number" && meta.updated > 0) parts.push(`업데이트 ${meta.updated}`);
    if (typeof meta.skipped === "number" && meta.skipped > 0) parts.push(`스킵 ${meta.skipped}`);
    return parts.join(" · ");
  }
  if (action === "records.bulk_deleted" && typeof meta.count === "number") {
    return `${meta.count}건`;
  }
  if (action === "records.cleaned" && typeof meta.deleted === "number") {
    return `${meta.deleted}건 정리 (${String(meta.keyField ?? "")} 기준)`;
  }
  if (action === "records.normalized" && typeof meta.changedRows === "number") {
    return `${meta.changedRows}건 수정`;
  }
  if (action === "source.updated" && Array.isArray(meta.fields)) {
    return `${(meta.fields as string[]).join(", ")}`;
  }
  if ((action === "source.created" || action === "source.deleted") && typeof meta.name === "string") {
    return meta.name;
  }
  return "";
}
