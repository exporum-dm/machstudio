"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { use } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2 } from "lucide-react";
import LivePushLayer, { type LivePopup, type LiveTallyPush, type LivePoll, type LiveSurveyPush } from "../LivePushLayer";
import LiveContentStk, { onAccentColor } from "../LiveContentStk";
import PreLiveWaiting from "../PreLiveWaiting";
import EntryVerify from "../EntryVerify";
import EndedScreen from "../EndedScreen";
import { endedSurveyLinks, readEndedSurveys, readHasInternalEndedSurvey, type EndedSurveyLink, type EndedSurveyRef } from "@/lib/webinar-ended-surveys";
import ViewerModal from "../ViewerModal";
import EndedSurveyDialog from "../EndedSurveyDialog";
import { formatKst } from "@/lib/datetime";
import { buildIcs, icsFileName } from "@/lib/webinar-calendar";
import {
  isValidEmail,
  isValidPhone,
  normalizeLivePageConfig,
  normalizeRegistrationForm,
  safeHttpUrl,
  type WebinarRegistrationField,
} from "@/lib/webinar-config";
import { MultiChoiceField, SingleChoiceField } from "@/components/webinar/choice-fields";
import { readStatusRefresh } from "../status-refresh";
import { buildUtmEnvelope, sendVisitBeacon } from "@/lib/attribution-client";
import { buildShareUrl, normalizeShareCode, readShareCode, type ShareChannel, type ShareSurface } from "@/lib/webinar-share";
import { PUBLIC_REGISTRATION_FORM_CSS } from "@/lib/webinar-public-form-css";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;
const REGISTRATION_FOCUSABLE =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// 소유자 미리보기 진입 여부 — ?preview 파라미터. 이 tab 에선 폴링·ping·제출 등 모든 부작용을 정지시킨다.
const isPreviewUrl = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
/**
 * 어드민 '만들기' 의 인접 미리보기 패널 안에서 열렸는가(?embed=1).
 * 그 패널에는 이미 대기·입장·라이브·종료 세그먼트가 폼 쪽에 있다. 아래 소유자 전환 바를
 * 그대로 두면 **같은 것을 조작하는 컨트롤이 둘**이 되고, 안쪽에서 상태를 바꾸면 폼과 어긋난다.
 * 그래서 embed 일 때만 전환 바를 숨긴다(미리보기 자체의 동작은 그대로).
 */
const isEmbeddedPreview = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";

// 상태 폴링(fetchStatus)은 URL 의 ?view 만 보고 화면을 정한다 — state 로만 바꾼 화면은
// 다음 폴에서 되돌아간다. "등록하러 가기" 같은 사용자의 명시적 이동은 여기에 남겨야 유지된다.
// UTM 봉투·방문 비콘은 attribution-client 한 곳에서 만든다 — 예전엔 이 파일이 자기만의
// 빌더를 갖고 있어서 정규화·클릭ID·리퍼러 추론이 임베드 경로와 달랐고, 같은 채널이 분석
// 표에서 두 줄로 갈라졌다(자세한 배경은 attribution-client 상단 주석).

function setViewParam(value: "signup" | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set("view", value);
  else url.searchParams.delete("view");
  window.history.replaceState(null, "", url.toString());
}

interface WebinarSession {
  id: string;
  number: number;
  type?: string;
  title: string;
  speaker: string | null;
  speakerCompany?: string | null;
  speakerPhotoUrl?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  startTime: string;
  endTime: string;
}

interface WebinarInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  signupDeadline: string;
  theme: Record<string, string>;
  config: Record<string, unknown>;
  components?: Record<string, unknown> | null;
  sessions: WebinarSession[];
}

interface Announcement {
  id: string;
  type: string;
  message: string;
}

interface AnsweredQA {
  id: string;
  question: string;
  sessionNumber: number | null;
  name: string | null;
  voteCount: number;
  status: string;
}

interface ChatMessage {
  id: string;
  name: string;
  message: string;
  isHost: boolean;
  createdAt: string;
}

// 통합 라이브 상태 응답 — 여러 폴링 엔드포인트를 대체 (/api/webinar/[slug]/live-state)
interface LiveStateResponse {
  status: string;
  entryOpen: boolean;
  serverNow: string;
  chatEnabled?: boolean;
  qaMode?: "open" | "closed";
  youtubeId?: string | null;
  viewerCount?: number | null;
  announcements: Announcement[];
  answeredQA?: AnsweredQA[];
  chat?: { messages: ChatMessage[] };
  poll: LivePoll | null;
  popup: LivePopup | null;
  tally: LiveTallyPush | null;
  survey?: LiveSurveyPush | null;
  pushedQuestion?: { id: string; question: string; name: string | null } | null;
  pinnedMessage?: { id: string; name: string; message: string; isHost: boolean; createdAt: string } | null;
}

type PageView = "signup" | "live" | "ended";
type AuthMethod = "phone" | "email";

// 등록 폼 정규화는 @/lib/webinar-config 단일 정의 사용 (필드 순서·placeholder 포함)
type RegistrationField = WebinarRegistrationField;

export default function LivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [webinar, setWebinar] = useState<WebinarInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<PageView>("signup");
  // ── 소유자 미리보기 — ?preview=<상태>. 4개 상태를 강제 렌더(부작용 차단). null = 일반 시청자 뷰.
  const [previewState, setPreviewState] = useState<null | "registration" | "entry" | "live" | "ended">(null);
  // 렌더 중 직접 window 를 읽으면 서버/클라이언트 첫 렌더가 갈린다 → 마운트 후 state 로.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => { setEmbedded(isEmbeddedPreview()); }, []);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const previewMode = previewState !== null;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [answeredQA, setAnsweredQA] = useState<AnsweredQA[]>([]);
  const [pushedQuestion, setPushedQuestion] = useState<{ id: string; question: string; name: string | null } | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; name: string; message: string; isHost: boolean } | null>(null);
  const [serverNowMs, setServerNowMs] = useState<number | undefined>(undefined);
  const [viewerCount, setViewerCount] = useState<number | null>(null); // 실시간 동시 시청자 수(라이브)
  const [isTrulyLive, setIsTrulyLive] = useState(false); // status === "live" (입장오픈 전 창과 구분)
  const [entryOpenNow, setEntryOpenNow] = useState(false); // 입장 확인 창이 열렸는가 — signup 고정 상태의 "입장으로 돌아가기" 노출용
  // 함께 기다리는 사람 수 — /status 가 함께 내려준다(별도 폴러를 만들지 않는다).
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  // 누적 사전등록자 수 — 사회적 증거 밴드용. 같은 /status 응답에 실려 온다(폴러를 늘리지 않는다).
  const [registrantCount, setRegistrantCount] = useState<number | null>(null);
  // 채팅 상태
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatEnabledLive, setChatEnabledLive] = useState<boolean | null>(null); // 라이브 중 /live-state 로 동기화
  const [qaModeLive, setQaModeLive] = useState<"open" | "closed" | null>(null); // 라이브 중 Q&A 공개범위 전환 반영
  const [votedQa, setVotedQa] = useState<Set<string>>(() => new Set()); // 세션 내 추천한 질문
  const [activeTab, setActiveTab] = useState<string>("qa");
  const chatCursorRef = useRef<string | null>(null);
  const liveTickRef = useRef(0);
  // 푸시(팝업·Tally·실시간 투표) — 통합 /live-state 폴링 결과를 LivePushLayer 로 내려준다
  const [pushPopup, setPushPopup] = useState<LivePopup | null>(null);
  const [pushTally, setPushTally] = useState<LiveTallyPush | null>(null);
  const [pushPoll, setPushPoll] = useState<LivePoll | null>(null);
  const [pushSurvey, setPushSurvey] = useState<LiveSurveyPush | null>(null);
  // 알림 구독 ("알림 받고 이어보기")
  const [notifySubscribed, setNotifySubscribed] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [notifyError, setNotifyError] = useState("");
  const [notifyPending, setNotifyPending] = useState(false);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  /* 이 등록자의 추천 코드 — 공유 버튼이 링크에 붙인다. 등록·입장확인 응답에서 미리 받아 두는
     이유: 버튼 클릭 시점에 서버를 기다리면 사용자 제스처가 끊겨 공유 시트가 막힌다. */
  const [shareCode, setShareCode] = useState<string | null>(null);
  // youtubeId 는 /info 로 공개하지 않고 verify 통과 시에만 받아 영상 게이팅
  const [videoId, setVideoId] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("phone");
  const [authValue, setAuthValue] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // 등록 폼 상태
  const [form, setForm] = useState({
    name: "", phone: "", email: "", company: "", department: "",
    jobTitle: "", industry: "", agreeMarketing: false, agreePrivacy: false, agreeThirdParty: false,
  });
  const [customFields, setCustomFields] = useState<Record<string, string | boolean>>({});
  const [isRegistering, setIsRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [canRegister, setCanRegister] = useState(true); // 서버 상태머신 판정 — 마감(upcoming) 시 폼 대신 안내
  const [regModalOpen, setRegModalOpen] = useState(false); // 대기 화면의 사전등록 폼 모달
  const [registrationOpener, setRegistrationOpener] = useState<HTMLElement | null>(null);
  const registrationDialogRef = useRef<HTMLDivElement>(null);
  const [viewerFocusRoot, setViewerFocusRoot] = useState<HTMLDivElement | null>(null);
  const [formError, setFormError] = useState("");
  // 실시간 중복 확인 — 연락처/이메일 입력 시 디바운스 후 기존 등록 여부 표시
  const [dupCheck, setDupCheck] = useState<{ phone: boolean; email: boolean }>({ phone: false, email: false });
  const dupSeqRef = useRef(0);
  const consentDefaultsAppliedRef = useRef(false);
  // 종료 화면에 연결된 자체 설문 (/info 가 내려줌) — 있으면 외부 surveyUrl 보다 우선
  const [endedSurveys, setEndedSurveys] = useState<EndedSurveyRef[]>([]);
  // 자체 설문 연결 여부 — 응답 기간을 벗어난 설문도 '있음' 으로 센다(외부 URL 배타 폴백용)
  const [hasInternalEndedSurvey, setHasInternalEndedSurvey] = useState<boolean | undefined>(undefined);
  /* 이 등록자가 이미 낸 설문 — 자료 게이팅이 본다. /info 가 registrationId 를 받으면 함께 준다. */
  const [completedSurveyIds, setCompletedSurveyIds] = useState<string[]>([]);
  /** 종료 화면 설문 팝업 — 새 창 대신 이 자리에서 답한다(EndedSurveyDialog). */
  const [openedSurvey, setOpenedSurvey] = useState<EndedSurveyLink | null>(null);
  /**
   * 사전등록 완료 팝업 — 제출이 성공했다는 사실을 화면이 말해 준다.
   *
   * 예전엔 등록에 성공하면 모달만 조용히 닫혔다. 대기 화면으로 돌아오긴 하는데 그 화면이
   * 등록 전과 크게 다르지 않아(카운트다운·아젠다는 그대로) "눌렸나?" 를 알 수 없었고,
   * 실제로 다시 누르는 사람이 생긴다 — 그러면 중복 안내를 만난다.
   * 임베드 폼은 이미 성공 문구를 인라인으로 띄우고 있어서, 자체 페이지만 침묵하고 있었다.
   */
  const [registerDone, setRegisterDone] = useState(false);
  // 동의 약관 전문 팝업 — 동의 문구 텍스트 클릭 시 (본문이 설정된 경우에만)
  const [termsModal, setTermsModal] = useState<{
    kind: "privacy" | "marketing" | "thirdParty";
    title: string;
    body: string;
    opener: HTMLElement;
  } | null>(null);
  const termsModalOpenRef = useRef(false);

  // Q&A 상태
  const [question, setQuestion] = useState("");
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [isSendingQA, setIsSendingQA] = useState(false);
  const [qaSent, setQaSent] = useState(false);
  const [qaError, setQaError] = useState("");

  const pingRef = useRef<NodeJS.Timeout | null>(null);

  // iframe 높이 자동 전달 (아임웹 임베드 시 사용)
  useEffect(() => {
    const sendHeight = () => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: "mach-resize", height: document.body.scrollHeight }, "*");
      }
    };
    sendHeight();
    const ro = new ResizeObserver(sendHeight);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  /**
   * 방문 1회 기록(세션당 1회) — 퍼널의 "방문" 분모.
   * 예전엔 방문이 임베드 로더 비콘으로만 쌓여서, 공유 링크·QR·카카오로 이 페이지에 직접 온
   * 채널은 분석 표에서 visits=0 · registered>0 이 되어 등록률이 0% 로 보였다.
   * 미리보기 가드는 sendVisitBeacon 안에 있다(공개 페이지 부작용 규약).
   */
  useEffect(() => {
    sendVisitBeacon(slug);
  }, [slug]);

  // 재접속 유지 — 인증한 registrationId·영상을 브라우저에 저장해 새로고침해도 입장 확인부터 다시 하지 않게
  useEffect(() => {
    if (isPreviewUrl()) return;
    try {
      const raw = localStorage.getItem(`mach_reg_${slug}`);
      if (raw) {
        const s = JSON.parse(raw) as { registrationId?: string; videoId?: string | null; shareCode?: string | null };
        if (s.registrationId) setRegistrationId(s.registrationId);
        if (typeof s.videoId === "string") setVideoId(s.videoId);
        // 새로고침해도 공유 버튼이 바로 동작해야 한다 — 코드를 다시 받으려면 입장 확인을 또 해야 한다.
        if (typeof s.shareCode === "string") setShareCode(normalizeShareCode(s.shareCode) || null);
      }
    } catch { /* 스토리지 차단 무시 */ }
  }, [slug]);
  useEffect(() => {
    if (isPreviewUrl()) return;
    try {
      if (registrationId) localStorage.setItem(`mach_reg_${slug}`, JSON.stringify({ registrationId, videoId, shareCode }));
    } catch { /* 무시 */ }
  }, [slug, registrationId, videoId, shareCode]);

  const fetchWebinar = useCallback(async () => {
    try {
      /* registrationId 를 붙이면 설문 완료 목록이 함께 온다(자료 게이팅용). 없으면 공개 응답. */
      const q = registrationId ? `?registrationId=${encodeURIComponent(registrationId)}` : "";
      const res = await fetch(`/api/webinar/${slug}/info${q}`);
      if (!res.ok) return;
      const data = await res.json();
      setWebinar(data.webinar);
      setEndedSurveys(readEndedSurveys(data));
      setHasInternalEndedSurvey(readHasInternalEndedSurvey(data));
      setCompletedSurveyIds(Array.isArray(data.completedSurveyIds) ? data.completedSurveyIds.filter((v: unknown) => typeof v === "string") : []);
      if (typeof data.serverNow === "string") setServerNowMs(new Date(data.serverNow).getTime());

      // 서버 상태머신 판정 사용 — statusOverride(운영 콘솔 수동 전환)·입장오픈 윈도 반영
      const status: string = data.status;
      const entryOpen: boolean = data.entryOpen;
      if (typeof data.canRegister === "boolean") setCanRegister(data.canRegister);
      setIsTrulyLive(status === "live"); // 입장오픈(라이브 전) 창에선 false → LIVE 칩 대신 '곧 시작'
      setEntryOpenNow(status === "live" || entryOpen);
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView === "signup" && status !== "ended") setView("signup");
      else if (status === "ended") setView("ended");
      else if (status === "live" || entryOpen) setView("live");
      else setView("signup");
    } finally {
      setIsLoading(false);
    }
    /* registrationId 가 의존성에 있어야 등록 직후 설문 완료 목록을 다시 받는다 —
       빼면 자료 자물쇠가 이전 상태(미등록)로 남는다. */
  }, [slug, registrationId]);

  // 라이브 전 상태 전환 감지용 경량 폴 — /status(상태만) 를 받아 view/serverNow/isTrulyLive 갱신.
  // 세션·테마·config 를 30초마다 다시 받지 않아 대기 시청자 egress 를 줄인다(정적 콘텐츠는 최초 /info 1회).
  const fetchStatus = useCallback(async () => {
    const refresh = await readStatusRefresh(() => fetch(`/api/webinar/${slug}/status`));
    setWaitingCount(refresh.waitingCount);
    setRegistrantCount(refresh.registrantCount);
    const data = refresh.data;
    if (!data) return;
    try {
      const status = typeof data.status === "string" ? data.status : "";
      const entryOpen = data.entryOpen === true;
      if (typeof data.canRegister === "boolean") setCanRegister(data.canRegister);
      if (typeof data.serverNow === "string") setServerNowMs(new Date(data.serverNow).getTime());
      setIsTrulyLive(status === "live");
      setEntryOpenNow(status === "live" || entryOpen);
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (requestedView === "signup" && status !== "ended") setView("signup");
      else if (status === "ended") setView("ended");
      else if (status === "live" || entryOpen) setView("live");
      else setView("signup");
    } catch { /* 상태 필드 계약 오류는 다음 주기에 재시도 — 인원 값은 위에서 이미 숨겼다. */ }
  }, [slug]);

  // 채팅 활성 여부 — 초기값은 /info(components.chatEnabled), 라이브 중엔 /live-state 의 chatEnabled 로 동기화
  const chatEnabled = chatEnabledLive ?? ((webinar?.components ?? {})["chatEnabled"] === true);
  // Q&A 공개 범위 — 같은 방식(초기값 /info, 라이브 중 /live-state). closed = 질문은 주최자만 본다.
  const qaMode: "open" | "closed" =
    qaModeLive ?? (((webinar?.components ?? {})["qaMode"] === "closed") ? "closed" : "open");

  // 통합 라이브 폴링 — 공지·답변 Q&A·채팅·투표·팝업·Tally·상태를 한 번의 요청으로 받아 egress 절감.
  // 예전엔 announcements/qa/chat 3개 + LivePushLayer 자체 3개로 분산 폴링했다.
  // fullChat=true 면 채팅 전체 재동기화(모더레이션 삭제 반영), 아니면 커서 이후 증분만. 최근 100개 유지.
  const liveReqRef = useRef(0); // 인플라이트 응답 펜스 — 늦게 온 전체 재동기화가 최신 상태(방금 보낸 채팅·커서)를 덮지 않게
  const fetchLiveState = useCallback(async (fullChat = false) => {
    const gen = ++liveReqRef.current;
    try {
      const useChat = chatEnabled && activeTab === "chat" && !!registrationId;
      // Q&A 탭 볼 때만 보드 100행 요청(egress 절감). 폐쇄형은 보드가 없으니 아예 요청하지 않는다.
      const useQa = activeTab === "qa" && !!registrationId && qaMode === "open";
      const after = useChat && !fullChat ? chatCursorRef.current : null;
      const params = new URLSearchParams();
      if (registrationId) params.set("registrationId", registrationId);
      if (useQa) params.set("qa", "1");
      if (useChat) {
        params.set("chat", "1");
        if (after) params.set("chatAfter", after);
      }
      const qs = params.toString();
      const res = await fetch(`/api/webinar/${slug}/live-state${qs ? `?${qs}` : ""}`);
      if (!res.ok) return;
      const data = (await res.json()) as LiveStateResponse;
      if (gen !== liveReqRef.current) return; // 더 새로운 요청이 출발함 — 이 응답 폐기(방금 보낸 채팅·커서 보호)
      // 서버 설정이 바뀌면 이미 재생 중인 참여자도 다음 폴에서 즉시 새 영상으로 전환한다.
      // null 역시 동기화해 운영자가 영상을 비웠을 때 이전 영상을 계속 보여주지 않는다.
      if (data.youtubeId !== undefined && data.youtubeId !== videoId) setVideoId(data.youtubeId);
      setViewerCount(data.viewerCount ?? null);

      setAnnouncements(data.announcements ?? []);
      // 라이브 중 오픈형 → 폐쇄형으로 바뀌면 이미 받아 둔 목록을 지운다.
      // (폐쇄형에선 answeredQA 가 아예 안 오므로 아래 if 만으로는 옛 목록이 화면에 남는다)
      if (data.qaMode === "closed") setAnsweredQA([]);
      else if (data.answeredQA) setAnsweredQA(data.answeredQA);
      setPushedQuestion(data.pushedQuestion ?? null);
      setPinnedMessage(data.pinnedMessage ?? null);
      setPushPopup(data.popup ?? null);
      setPushTally(data.tally ?? null);
      setPushPoll(data.poll ?? null);
      setPushSurvey(data.survey ?? null);
      if (typeof data.serverNow === "string") setServerNowMs(new Date(data.serverNow).getTime());
      setIsTrulyLive(data.status === "live");
      // 채팅 on/off 를 라이브 중에도 반영 — 호스트가 세션 중 토글하면 다음 폴에서 탭 노출/숨김이 갱신됨
      if (typeof data.chatEnabled === "boolean") setChatEnabledLive(data.chatEnabled);
      if (data.qaMode === "open" || data.qaMode === "closed") setQaModeLive(data.qaMode);
      // 라이브 중 종료 전환 — 종료되면 종료 화면으로. view!=="live" 가 되어 이 폴링도 자동 중단된다.
      if (data.status === "ended") setView("ended");
      // 운영자가 라이브를 등록/대기로 되돌린 경우(수동 override) — 시청자를 라이브에 가두지 않고 대기 화면으로.
      else if (data.status !== "live" && !data.entryOpen) setView("signup");

      // 채팅 병합 — 요청 시 보낸 after 와 동일한 기준으로 처리(교체 vs 증분)
      if (data.chat) {
        const incoming = data.chat.messages ?? [];
        if (!after) {
          const trimmed = incoming.slice(-100);
          chatCursorRef.current = trimmed.length ? trimmed[trimmed.length - 1].createdAt : null;
          setChatMessages(trimmed);
        } else if (incoming.length > 0) {
          chatCursorRef.current = incoming[incoming.length - 1].createdAt ?? chatCursorRef.current;
          setChatMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter((m) => !seen.has(m.id));
            if (fresh.length === 0) return prev; // gte 경계 메시지뿐 → 변화 없음, 리렌더 스킵
            return [...prev, ...fresh].slice(-100);
          });
        }
      }
    } catch {
      /* 폴링 중 일시적 네트워크 오류는 다음 주기에 재시도 */
    }
    // qaMode: useQa 판단에 쓰인다. 빠뜨리면 폐쇄형→오픈형 전환 시 콜백이 옛 값을 계속 봐서
    // 보드를 영원히 요청하지 않는다(목록이 안 나옴).
  }, [slug, registrationId, chatEnabled, activeTab, videoId, qaMode]);

  const handleSendChat = async () => {
    if (isPreviewUrl()) return;
    const msg = chatInput.trim();
    if (!msg || isSendingChat) return;
    setIsSendingChat(true);
    setChatError("");
    try {
      const res = await fetch(`/api/webinar/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, registrationId, name: form.name || null }),
      });
      if (res.ok) {
        setChatInput("");
        await fetchLiveState();
      } else {
        const d = await res.json().catch(() => ({}));
        setChatError(d.error ?? "메시지 전송에 실패했어요. 잠시 후 다시 시도해주세요.");
      }
    } catch {
      setChatError("메시지 전송에 실패했어요. 연결 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setIsSendingChat(false);
    }
  };

  // 알림 스위치 토글 — ON: 구독(등록 이메일 저장), OFF: 해제. 낙관적 업데이트 + 실패 시 이전 상태로 복원.
  const handleNotifyToggle = async () => {
    if (isPreviewUrl()) return;
    if (notifyPending) return; // 연타 방지 (진행 중 중복 요청 차단)
    const prev = notifySubscribed;
    const next = !prev;
    setNotifyError("");
    setNotifyPending(true);
    setNotifySubscribed(next);
    try {
      const res = await fetch(`/api/webinar/${slug}/reminder`, {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setNotifyError(d.error ?? "알림 설정에 실패했어요.");
        setNotifySubscribed(prev); // 실패 → 이전 상태로 복원
      }
    } catch {
      setNotifyError("알림 설정에 실패했어요. 잠시 후 다시 시도해주세요.");
      setNotifySubscribed(prev);
    } finally {
      setNotifyPending(false);
    }
  };

  useEffect(() => {
    // 미리보기(소유자)는 아래 /preview 로더가 데이터를 세팅하고, 인증 실패자는 로더가 ?preview 를 떼고 재이동한다.
    // 여기서 /info 를 함께 돌리면 프리뷰 드라이버가 세팅한 view/isTrulyLive 를 덮어써 초기 화면이 잘못 뜬다(레이스).
    if (isPreviewUrl()) return;
    fetchWebinar();
  }, [fetchWebinar]);

  // 동의 체크박스 기본값 — 웨비나 설정에 따라 폼 진입 시 1회만 적용(이후 사용자가 직접 만진 값을 덮어쓰지 않는다)
  useEffect(() => {
    if (!webinar || consentDefaultsAppliedRef.current) return;
    consentDefaultsAppliedRef.current = true;
    const rf = normalizeRegistrationForm(webinar.config ?? {});
    const thirdPartyDefault = rf.thirdPartyEnabled && rf.thirdPartyDefaultChecked;
    if (!rf.privacyDefaultChecked && !rf.marketingDefaultChecked && !thirdPartyDefault) return;
    setForm((f) => ({
      ...f,
      agreePrivacy: f.agreePrivacy || rf.privacyDefaultChecked,
      agreeMarketing: f.agreeMarketing || rf.marketingDefaultChecked,
      agreeThirdParty: f.agreeThirdParty || thirdPartyDefault,
    }));
  }, [webinar]);

  // 미리보기 진입 — ?preview 있으면 소유자 인증 후 데이터 로드. 실패(비소유자·비로그인) 시 조용히 폴백(일반 뷰).
  useEffect(() => {
    if (!isPreviewUrl()) return;
    const p = new URLSearchParams(window.location.search).get("preview");
    const init = (["registration", "entry", "live", "ended"] as const).find((s) => s === p) ?? "registration";
    // 인증 실패(비소유자·세션 만료)면 ?preview 를 떼고 깨끗한 URL 로 재이동 → 일반 시청 화면으로 완전 복구.
    // (부작용 가드가 URL 기준이라, 파라미터를 남기면 등록·입장·ping 이 아무 표시 없이 죽는다.)
    const fallbackToClean = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete("preview");
      window.location.replace(u.toString());
    };
    let alive = true;
    (async () => {
      // 인증 실패(401/403)는 즉시 폴백, 일시적 오류(5xx·네트워크)는 짧게 2회 재시도 후 폴백 —
      // 소유자가 서버 블립 한 번에 소리없이 공개 등록 화면으로 튕겨나가지 않게.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`/api/webinar/${slug}/preview`);
          if (!alive) return;
          if (res.ok) {
            const data = await res.json();
            if (!alive) return; // json 파싱 대기 중 slug 변경/언마운트 — stale 데이터로 새 상태를 덮지 않게
            setWebinar(data.webinar);
            setEndedSurveys(readEndedSurveys(data)); // 미리보기도 실제 시청자와 같은 종료 화면 설문을 보도록
            setHasInternalEndedSurvey(readHasInternalEndedSurvey(data));
            if (typeof data.serverNow === "string") setServerNowMs(new Date(data.serverNow).getTime());
            setPreviewVideoId(typeof data.youtubeId === "string" ? data.youtubeId : null);
            setPreviewState(init);
            setIsLoading(false);
            return;
          }
          if (res.status === 401 || res.status === 403 || res.status === 404) break; // 권한 문제 — 재시도 무의미
        } catch { /* 네트워크 블립 — 재시도 */ }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
      if (alive) fallbackToClean();
    })();
    return () => { alive = false; };
  }, [slug]);

  // 미리보기 상태 → view/registrationId/videoId 강제. 부작용 이펙트는 isPreviewUrl 가드로 정지돼 있어 덮이지 않는다.
  // useLayoutEffect — 스위처 클릭 후 페인트 전에 view 를 확정해 이전 화면 1프레임 깜빡임을 없앤다.
  useLayoutEffect(() => {
    if (!previewState) return;
    setView(previewState === "ended" ? "ended" : previewState === "registration" ? "signup" : "live");
    setRegistrationId(previewState === "live" ? "preview" : null);
    // 미리보기 "대기화면"은 리디자인된 대기 화면(PreLiveWaiting)을 보여준다(등록자 관점). 신규 방문자 등록 폼은 등록폼 탭에서 미리보기.
    setRegistered(previewState === "registration");
    setVideoId(previewState === "live" ? previewVideoId : null);
    setIsTrulyLive(previewState === "live");
  }, [previewState, previewVideoId]);

  // 모달이 렌더 조건(뷰 전환·등록 완료)을 벗어나 사라지면 열림 상태도 함께 정리한다 —
  // 남겨두면 아래 이펙트가 배경 스크롤을 계속 잠근 채로 둔다.
  useEffect(() => {
    if (regModalOpen && (view !== "signup" || registered || registrationId)) setRegModalOpen(false);
  }, [regModalOpen, view, registered, registrationId]);

  useEffect(() => {
    termsModalOpenRef.current = termsModal !== null;
  }, [termsModal]);

  // 등록 모달 — 랜딩 모달과 같은 수명주기: 내부 초기 포커스·Tab 트랩·Esc·스크롤 잠금·opener 복원.
  useEffect(() => {
    if (!regModalOpen) return;
    const dialog = registrationDialogRef.current;
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(REGISTRATION_FOCUSABLE));
    const onKey = (e: KeyboardEvent) => {
      // 약관 ViewerModal이 최상위인 동안에는 Escape/Tab 소유권을 넘긴다.
      if (termsModalOpenRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setRegModalOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (dialog.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),textarea:not([disabled])")
      ?? focusable()[0]
      ?? dialog).focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      queueMicrotask(() => {
        // Strict Mode effect 재실행 중에는 dialog가 그대로 연결돼 있다. 실제 일반 종료 뒤에만 복원한다.
        if (dialog.isConnected) return;
        if (registrationOpener?.isConnected) registrationOpener.focus();
      });
    };
  }, [regModalOpen, registrationOpener]);

  // 라이브 전(사전등록·입장 대기) 상태 폴링 — 서버 status 가 live 로 바뀌면 fetchStatus 가
  // view/isTrulyLive/serverNowMs 를 갱신해 대기 중이던 시청자가 자동 전환된다. (30초, 탭 비활성 시 스킵)
  // 경량 /status 만 받아 정적 콘텐츠 재수신 egress 를 없앤다.
  useEffect(() => {
    if (isPreviewUrl()) return;
    // 라이브 중에는 live-state 폴러가 상태를 본다 → 여기선 중복 폴링 안 함.
    // 종료 상태에서는 예전에 폴링을 완전히 멈춰서, liveEndAt 을 넘겨 자동 종료된 뒤
    // 운영자가 콘솔에서 "라이브" 로 되돌려도 시청자는 수동 새로고침 전까지 돌아올 수 없었다.
    // 종료 화면에서만 저빈도(2분)로 확인해 복구 경로를 남긴다.
    if (view === "live") return;
    // 종료 화면은 복구 확인 목적이라 저빈도(2분)로 — 대기 화면은 전환 감지가 중요해 30초 유지.
    const periodMs = view === "ended" ? 120_000 : 30_000;
    /**
     * 대기 프레즌스 — "N명이 함께 기다려요" 의 근거. 상태 폴과 **같은 주기**에 실어 보낸다
     * (새 타이머를 만들지 않는다 — 이 프로젝트는 뷰어 폴러를 하나로 모아 왔다).
     *
     * event: "wait" 는 presencePingAt 만 찍는다. heartbeat 를 쓰면 isActive·connectedSeconds 가
     * 올라가 대기 시간이 시청 시간·입장률로 들어간다(ping 라우트 주석 참고).
     * 종료 화면에서는 보내지 않는다 — 기다리는 사람이 아니다.
     */
    const beat = () => {
      if (view === "ended" || !registrationId) return;
      void fetch(`/api/webinar/${slug}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId, event: "wait" }),
      }).catch(() => {});
    };
    beat();
    /**
     * 첫 화면에서 한 번 받아 둔다. 인터벌 안에서만 부르면 사회적 증거 밴드가 **30초 뒤에**
     * 튀어나온다 — 등록을 망설이는 순간은 그 전에 지나간다. /info 는 정적 콘텐츠만 주므로
     * 인원 수는 여기서 온다(새 엔드포인트·새 타이머를 만들지 않는다).
     */
    void fetchStatus();
    const interval = setInterval(() => {
      if (document.hidden) return;
      beat();
      void fetchStatus();
    }, periodMs);
    return () => clearInterval(interval);
  }, [view, fetchStatus, registrationId, slug]);

  // 라이브 중 통합 폴링 — 12초 주기(탭 비활성 시 스킵). 공지·답변 Q&A·채팅·투표·팝업·Tally·상태를
  // 한 번의 요청으로 받는다. fetchLiveState 가 activeTab/채팅 여부를 반영하므로 탭 전환 시 이 이펙트가
  // 재실행되어 즉시 재동기화된다. 5주기(약 60초)마다 채팅 전체 재동기화(모더레이션 삭제 반영).
  // registrationId 없는 입장 확인 화면 시청자도 공지 배너·상태 전환은 받아야 하므로 view=live 면 폴링한다
  // (Q&A·채팅·푸시는 서버/JSX 에서 registrationId 로 게이팅되어 인증 전엔 조회/표시되지 않음).
  useEffect(() => {
    if (isPreviewUrl()) return;
    if (view !== "live") return;
    liveTickRef.current = 0;
    void fetchLiveState(true);
    const interval = setInterval(() => {
      if (document.hidden) return;
      liveTickRef.current += 1;
      void fetchLiveState(liveTickRef.current % 5 === 0);
    }, 12000);
    return () => clearInterval(interval);
  }, [view, registrationId, fetchLiveState]);

  // presence ping
  useEffect(() => {
    if (isPreviewUrl()) return;
    if (view !== "live" || !registrationId) return;

    fetch(`/api/webinar/${slug}/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId, event: "enter" }),
    });

    // 60초 ± 10초 jitter — 동시 입장한 시청자들의 heartbeat 가 같은 초에 몰리지 않게 분산.
    // hidden 은 접속/포커스 시간을 나눠 쌓기 위한 신호 — 탭이 숨겨져도 ping 은 계속 보낸다
    // (근무 중 창만 띄워두고 소리로 듣는 참석을 이탈로 세지 않기 위해).
    pingRef.current = setInterval(() => {
      fetch(`/api/webinar/${slug}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId, event: "ping", hidden: document.hidden }),
      });
    }, 50_000 + Math.floor(Math.random() * 20_000));

    const handleLeave = () => {
      if (!registrationId) return;
      navigator.sendBeacon(`/api/webinar/${slug}/ping`, JSON.stringify({ registrationId, event: "leave" }));
    };
    // beforeunload 만 걸면 iOS Safari·모바일 앱 전환에서 거의 발화하지 않아 퇴장이 기록되지 않고
    // 동시 시청자 수가 한 방향(과대)으로 편향됐다. pagehide 는 모바일에서 신뢰할 수 있는 신호다.
    window.addEventListener("beforeunload", handleLeave);
    window.addEventListener("pagehide", handleLeave);

    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      window.removeEventListener("beforeunload", handleLeave);
      window.removeEventListener("pagehide", handleLeave);
      // 라이브→종료 전환·SPA 이탈 등 beforeunload 가 안 뜨는 경로에서도 퇴장 기록(sendBeacon은 언로드에도 안전).
      handleLeave();
    };
  }, [view, registrationId, slug]);

  // 실시간 중복 확인 — 유효한 연락처/이메일이 입력되면 디바운스 후 기존 등록 여부 조회.
  // 미리보기·등록완료 상태에선 호출하지 않고, 실패는 무시(제출 시 서버가 최종 판정).
  useEffect(() => {
    if (isPreviewUrl() || registered) return;
    // 시퀀스는 매 실행마다 올린다 — 필드를 비운 뒤 도착하는 이전 값의 응답이 빈 필드에 경고를 세우지 않게
    const seq = ++dupSeqRef.current;
    const phone = form.phone.replace(/[^0-9]/g, "");
    const email = form.email.trim().toLowerCase();
    const phoneReady = isValidPhone(phone);
    const emailReady = isValidEmail(email);
    if (!phoneReady) setDupCheck((d) => (d.phone ? { ...d, phone: false } : d));
    if (!emailReady) setDupCheck((d) => (d.email ? { ...d, email: false } : d));
    if (!phoneReady && !emailReady) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/webinar/${slug}/register/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(phoneReady ? { phone } : {}), ...(emailReady ? { email } : {}) }),
        });
        if (!res.ok || seq !== dupSeqRef.current) return;
        const data = await res.json();
        setDupCheck({
          phone: phoneReady && Boolean(data?.exists?.phone),
          email: emailReady && Boolean(data?.exists?.email),
        });
      } catch { /* 네트워크 오류 무시 */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.phone, form.email, slug, registered]);

  const handleRegister = async () => {
    if (isPreviewUrl()) return;
    setFormError("");
    if (!form.agreePrivacy) {
      setFormError(registrationForm.privacyText || "개인정보 수집 및 이용 동의가 필요합니다.");
      return;
    }
    for (const field of registrationForm.fields) {
      if (!field.required) continue;
      const value = field.system
        ? form[field.key as keyof typeof form]
        : customFields[field.key];
      const isEmpty = field.type === "checkbox" ? !value : !String(value ?? "").trim();
      if (isEmpty) {
        setFormError(`${field.label} 항목을 입력해주세요.`);
        return;
      }
    }

    setIsRegistering(true);
    try {
      const res = await fetch(`/api/webinar/${slug}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // _ref: 추천 링크(`?ref=`)로 들어왔으면 그 코드를 함께 보내 추천인에 연결한다
        body: JSON.stringify({ ...form, customFields, _utm: buildUtmEnvelope(), _ref: readShareCode(window.location.search) || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "등록에 실패했어요. 다시 시도해주세요.");
        // 서버가 중복을 판정한 경우(디바운스 경합·check 레이트리밋 등) — 인라인 필드 경고에도 반영
        if (data.duplicateField === "phone" || data.duplicateField === "email") {
          setDupCheck((d) => ({ ...d, [data.duplicateField as "phone" | "email"]: true }));
        }
        return;
      }
      setRegistrationId(data.registration.id);
      if (typeof data.registration.shareCode === "string") setShareCode(normalizeShareCode(data.registration.shareCode) || null);
      if (typeof data.youtubeId === "string") setVideoId(data.youtubeId);
      setRegistered(true);
      setRegModalOpen(false); // 등록 완료 — 모달을 닫고 대기 화면(등록자용)으로 돌아간다
      setRegisterDone(true); // 완료 팝업 — 아래 ViewerModal 이 사용자가 닫을 때까지 남는다
      // 등록을 마쳤으면 signup 고정을 푼다 — 안 풀면 입장이 열려 있어도 대기 화면에 머문다.
      setViewParam(null);

      // 라이브 중이면 바로 이동 — 클라이언트 시계 대신 서버 상태(status/serverNow)로 판정
      void fetchWebinar();
    } catch {
      setFormError("등록 중 오류가 났어요. 연결 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setIsRegistering(false);
    }
  };

  const handleVerifyEntry = async () => {
    if (isPreviewUrl()) return;
    const value = authMethod === "phone" ? authValue.replace(/[^0-9]/g, "") : authValue.trim().toLowerCase();
    if (!value || (authMethod === "phone" && !isValidPhone(value)) || (authMethod === "email" && !isValidEmail(value))) {
      setVerifyError(authMethod === "phone" ? "올바른 연락처를 입력해주세요." : "올바른 이메일을 입력해주세요.");
      return;
    }

    setIsVerifying(true);
    setVerifyError("");
    try {
      const res = await fetch(`/api/webinar/${slug}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: authMethod, value }),
      });
      const data = await res.json().catch(() => null);
      // 429·5xx 를 "등록 내역 없음" 으로 뭉개면 정상 등록자가 미등록자로 오인되고,
      // 안내대로 사전등록을 눌러도 중복으로 막혀 완전한 막다른 길이 된다 → 원인별로 구분한다.
      if (res.status === 429) {
        setVerifyError(data?.error ?? "요청이 잦아 잠시 막혔어요. 조금 뒤 다시 시도해주세요.");
        return;
      } else if (!res.ok && res.status >= 500) {
        setVerifyError("일시적인 오류예요. 잠시 후 다시 시도해주세요.");
        return;
      } else if (!res.ok || !data?.found || !data?.registration) {
        setVerifyError("등록 내역을 찾지 못했습니다. 다른 인증 방법으로도 시도해보세요.");
        return;
      }

      const registration = data.registration as {
        id: string;
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        company?: string | null;
        department?: string | null;
        jobTitle?: string | null;
        industry?: string | null;
        shareCode?: string | null;
      };

      setRegistrationId(registration.id);
      // 공유 버튼이 쓸 추천 코드 — 입장 확인에서 받아 둔다(클릭 시점에 서버를 기다리지 않게)
      if (typeof registration.shareCode === "string") setShareCode(normalizeShareCode(registration.shareCode) || null);
      if (typeof data.youtubeId === "string") setVideoId(data.youtubeId);
      if (typeof data.reminderSubscribed === "boolean") setNotifySubscribed(data.reminderSubscribed);
      setForm((prev) => ({
        ...prev,
        name: registration.name ?? prev.name,
        phone: registration.phone ?? prev.phone,
        email: registration.email ?? prev.email,
        company: registration.company ?? prev.company,
        department: registration.department ?? prev.department,
        jobTitle: registration.jobTitle ?? prev.jobTitle,
        industry: registration.industry ?? prev.industry,
      }));
      setAuthValue("");
    } catch {
      setVerifyError("확인 중 오류가 났어요. 연결 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setIsVerifying(false);
    }
  };

  // 세션에 저장된 추천 이력 복원 (버튼 비활성 유지)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`mach_qavote_${slug}`);
      if (raw) setVotedQa(new Set(JSON.parse(raw) as string[]));
    } catch { /* 스토리지 차단 무시 */ }
  }, [slug]);

  const handleVoteQA = async (qaId: string) => {
    if (isPreviewUrl()) return;
    if (votedQa.has(qaId)) return;
    const persist = (set: Set<string>) => {
      try { sessionStorage.setItem(`mach_qavote_${slug}`, JSON.stringify([...set])); } catch { /* 무시 */ }
    };
    // 낙관적 — 추천 표시 + 카운트 +1
    setVotedQa((prev) => { const n = new Set(prev); n.add(qaId); persist(n); return n; });
    setAnsweredQA((prev) => prev.map((q) => (q.id === qaId ? { ...q, voteCount: (q.voteCount ?? 0) + 1 } : q)));
    // 실패 시 되돌리기 — 표가 기록 안 됐는데 버튼이 잠기는 것 방지 (handleNotifyToggle 패턴)
    const rollback = () => {
      setVotedQa((prev) => { const n = new Set(prev); n.delete(qaId); persist(n); return n; });
      setAnsweredQA((prev) => prev.map((q) => (q.id === qaId ? { ...q, voteCount: Math.max(0, (q.voteCount ?? 1) - 1) } : q)));
    };
    try {
      const res = await fetch(`/api/webinar/${slug}/qa/${qaId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId }),
      });
      if (res.ok) {
        const d = await res.json();
        setAnsweredQA((prev) => prev.map((q) => (q.id === qaId ? { ...q, voteCount: d.voteCount } : q))); // 서버 값(중복 포함)으로 보정
      } else {
        rollback();
      }
    } catch {
      rollback();
    }
  };

  const handleSendQA = async () => {
    if (isPreviewUrl()) return;
    if (!question.trim()) return;
    setQaError("");
    setIsSendingQA(true);
    try {
      const res = await fetch(`/api/webinar/${slug}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          sessionNumber: selectedSession,
          name: form.name || null,
          company: form.company || null,
          registrationId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setQaError(data.error ?? "질문 전송에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      setQuestion("");
      setQaSent(true);
      setTimeout(() => setQaSent(false), 3000);
    } catch {
      setQaError("질문 전송에 실패했어요. 연결 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setIsSendingQA(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0f0f0f" }}>
        <Loader2 className="w-8 h-8 animate-spin text-white/30" />
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0f0f0f" }}>
        <p className="text-white/50">웨비나를 찾을 수 없어요</p>
      </div>
    );
  }

  const theme = webinar.theme;
  const bg = theme.bgColor ?? "#0f0f0f";
  const surface = theme.surfaceColor ?? "#1a1a1a";
  const accent = theme.accentColor ?? "#6d28d9";
  const text = theme.textColor ?? "#ffffff";
  /** 텍스트 색에서 파생한 반투명 색 — 모달 껍데기가 테마를 따라가게(LivePushLayer 와 같은 식). */
  const soft = (pct: number) => `color-mix(in srgb, ${text} ${pct}%, transparent)`;
  const font = theme.font ?? "Pretendard";
  const radius = theme.borderRadius ?? "16px";
  const registrationForm = normalizeRegistrationForm(webinar.config ?? {});
  const visibleFields = registrationForm.fields;
  const completionCtaUrl = safeHttpUrl(registrationForm.successCta.url);
  const showCompletionCta =
    registrationForm.successCta.enabled &&
    registrationForm.successCta.label.trim() !== "" &&
    completionCtaUrl !== "";
  /**
   * 확인 버튼이 이동할 주소. 비면 예전처럼 모달만 닫는다.
   * safeHttpUrl 을 거치는 이유: 어드민이 넣은 값이 그대로 location 에 들어가면 javascript: 로
   * 스크립트를 실행시킬 수 있다(공개 면이라 입력자와 실행 대상이 다르다).
   */
  const completionRedirectUrl = safeHttpUrl(registrationForm.successRedirectUrl);
  /**
   * 미리보기에서는 실제로 나가지 않는다 — 소유자가 상태를 훑는 중에 화면이 통째로
   * 다른 사이트로 넘어가면 돌아올 길이 없다(AGENTS.md: 새 부작용은 isPreviewUrl 가드).
   */
  const confirmCompletion = () => {
    if (completionRedirectUrl && !previewMode) {
      window.location.href = completionRedirectUrl;
      return;
    }
    setRegisterDone(false);
  };
  const inputStyle = { border: "1px solid rgba(255,255,255,0.1)", borderRadius: `calc(${radius} * 0.6)`, color: text };
  /**
   * 캘린더 담기 — 운영자가 붙여 넣은 URL 이 아니라 **웨비나 일정에서 직접** 만든다.
   * 예전에는 config.calendarUrl 을 안 채우면 게이트가 막혀 모바일 배너가 아예 안 떴고,
   * 시각을 고쳐도 링크는 옛날 시각을 가리켰다. 일정은 웨비나가 이미 들고 있는 값이다.
   * 임베드 배너와 같은 빌더를 쓴다(webinar-calendar.ts) — 경로에 따라 다른 일정이 담기면 안 된다.
   *
   * 미리보기에서는 파일을 만들지 않는다 — 소유자가 상태를 훑는 중에 다운로드가 뜨면 안 된다.
   */
  const downloadCalendar = () => {
    if (!webinar || previewMode) return;
    const ics = buildIcs({
      name: webinar.name,
      description: webinar.description ?? null,
      liveStartAt: new Date(webinar.liveStartAt),
      liveEndAt: new Date(webinar.liveEndAt),
      slug,
    });
    const href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = icsFileName(webinar.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 즉시 해제하면 사파리가 파일을 받기 전에 사라진다 — 한 틱 뒤에 반납한다.
    setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  /**
   * 공유 — 링크에 **내 추천 코드**(`?ref=`)를 붙이고, 공유했다는 사실을 서버에 남긴다.
   * 예전에는 추적 없는 맨 URL 을 복사해서 "누가 공유했나" 도 "그 공유로 몇 명이 왔나" 도
   * 알 수 없었다(webinar-share.ts 주석 참고).
   *
   * 순서가 중요하다: URL 을 **먼저 동기적으로** 만들고 공유/복사한 뒤에 기록을 보낸다.
   * 기록을 await 하면 사용자 제스처가 끊겨 iOS 사파리가 공유 시트·클립보드를 막는다.
   * 그래서 추천 코드는 등록·입장확인 응답에서 미리 받아 두고(shareCode 상태), 기록은
   * fire-and-forget 이다.
   */
  const recordShare = (surface: ShareSurface, channel: ShareChannel) => {
    if (isPreviewUrl() || !registrationId || registrationId === "preview") return;
    const payload = JSON.stringify({ registrationId, surface, channel });
    try {
      // sendBeacon 은 화면을 떠나도 전송이 보장된다(공유 후 앱으로 이동하는 모바일 경로)
      if (navigator.sendBeacon?.(`/api/webinar/${slug}/share`, payload)) return;
    } catch { /* 폴백으로 진행 */ }
    void fetch(`/api/webinar/${slug}/share`, { method: "POST", body: payload, keepalive: true }).catch(() => {});
  };

  const handleShare = async (surface: ShareSurface = "live") => {
    if (typeof window === "undefined") return;
    const url = buildShareUrl(`${window.location.origin}/webinar/${slug}/live`, shareCode ?? "");
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: webinar?.name ?? "웨비나", url });
        recordShare(surface, "native");
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
        recordShare(surface, "copy");
      }
    } catch { /* 공유 취소·미지원 무시 — 취소는 기록하지 않는다 */ }
  };
  /**
   * 무효 registrationId 탈출구 — 등록 건이 삭제되면(운영자가 테스트 등록 정리 등) localStorage
   * 의 재접속 유지 값은 그대로 남아 새로고침해도 시청 화면으로 들어간다. 서버 쪽 게이트는 다
   * 소속 검증을 하므로 영상은 "연결되지 않았어요", 질문·채팅·투표는 모두 403 인데 재인증 경로가
   * 없었다 — 이 화면(LiveContentStk)에 항상 보이는 보조 액션으로 저장값을 지우고 EntryVerify 로
   * 되돌린다.
   */
  const handleReauth = () => {
    if (isPreviewUrl()) return;
    try { localStorage.removeItem(`mach_reg_${slug}`); } catch { /* 스토리지 차단 무시 */ }
    setRegistrationId(null);
    setVideoId(null);
  };
  // 자체 설문 N개 vs 외부 URL 하나의 배타적 폴백 — 규칙은 webinar-ended-surveys.ts 한 곳에.
  // 존재 플래그를 함께 넘긴다: 시작 예약 창에서 목록이 비어도 옛 외부 URL 이 되살아나지 않게.
  const surveyLinks = endedSurveyLinks(
    endedSurveys,
    webinar.config?.surveyUrl,
    (id) => `/webinar/${slug}/survey/${id}?src=ended`,
    hasInternalEndedSurvey ?? endedSurveys.length > 0,
  );
  const live = normalizeLivePageConfig(webinar.config);
  // 등록 완료 여부 — 대기 화면은 모두에게 같은 걸 보여주고, 이 값으로 등록 CTA·폼만 켠다.
  const hasRegistration = registered || !!registrationId;

  const renderRegistrationField = (field: RegistrationField) => {
    const commonLabel = `${field.label}${field.required ? " *" : ""}`;
    const value = field.system
      ? String(form[field.key as keyof typeof form] ?? "")
      : customFields[field.key] ?? "";
    const setValue = (next: string | boolean) => {
      if (field.system) {
        setForm((prev) => ({ ...prev, [field.key]: next }));
      } else {
        setCustomFields((prev) => ({ ...prev, [field.key]: next }));
      }
    };

    if (field.type === "checkbox") {
      return (
        <label key={field.key} className="mw-field mw-check">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => setValue(e.target.checked)}
          />
          <span>{commonLabel}</span>
        </label>
      );
    }

    return (
      <div key={field.key} className="mw-field">
        <label className="mw-label">{commonLabel}</label>
        {field.type === "multiple" ? (
          <MultiChoiceField
            field={field}
            value={String(value)}
            onChange={setValue}
            accent={accent}
            inputStyle={inputStyle}
            publicForm
          />
        ) : field.type === "select" ? (
          <SingleChoiceField
            field={field}
            value={String(value)}
            onChange={setValue}
            inputStyle={inputStyle}
            publicForm
          />
        ) : (
          <>
            <input
              type={field.type}
              inputMode={field.type === "tel" ? "numeric" : undefined}
              value={String(value)}
              onChange={(e) => setValue(field.type === "tel" ? e.target.value.replace(/[^0-9]/g, "") : e.target.value)}
              placeholder={field.placeholder}
              className="mw-input"
            />
            {field.system && ((field.key === "phone" && dupCheck.phone) || (field.key === "email" && dupCheck.email)) && (
              <p className="text-[11px] mt-1.5" style={{ color: "#f59e0b" }}>
                이미 사전등록된 {field.key === "phone" ? "연락처" : "이메일"}예요 — 웨비나 당일 이 정보로 바로 입장할 수 있어요.
                {entryOpenNow && !previewMode && (
                  <button
                    type="button"
                    // ?view=signup 고정을 함께 풀어야 한다 — setView 만 하면 30초 뒤 폴링이 되돌린다
                    onClick={() => { setViewParam(null); setRegModalOpen(false); setView("live"); }}
                    className="ml-1.5 underline underline-offset-2 font-medium"
                    style={{ color: accent }}
                  >
                    지금 입장하기
                  </button>
                )}
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={setViewerFocusRoot}
      data-viewer-focus-root
      tabIndex={-1}
      className="min-h-screen"
      style={{ backgroundColor: bg, color: text, fontFamily: `${font}, sans-serif` }}
    >
      <style dangerouslySetInnerHTML={{ __html: PUBLIC_REGISTRATION_FORM_CSS }} />
      {/* 소유자 미리보기 — 상태 전환 바(대기·입장확인·라이브·종료). 실제 부작용은 모두 정지. */}
      {previewMode && !embedded && (
        <div
          className="sticky top-0 z-[70] flex flex-wrap items-center gap-2 border-b border-white/10 bg-neutral-900/90 px-3 py-2 text-white backdrop-blur"
          style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
        >
          <span className="rounded-md bg-violet-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">미리보기</span>
          <div className="flex flex-wrap gap-1">
            {(([["registration", "대기화면"], ["entry", "입장확인"], ["live", "라이브 시청"], ["ended", "종료화면"]]) as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPreviewState(k)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${previewState === k ? "bg-white text-neutral-900" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto hidden text-[11px] text-white/50 sm:inline">실제 전송·입장·집계 없음 · 팝업·투표 등 라이브 푸시는 표시되지 않아요</span>
        </div>
      )}

      {/* 활성 인터랙션(팝업·투표·설문·공지 등) — 닫은 항목은 우하단 알림함에서 다시 연다. */}
      <LivePushLayer
        slug={slug}
        registrationId={registrationId}
        accentColor={accent}
        surfaceColor={surface}
        textColor={text}
        popup={view === "live" && registrationId ? pushPopup : null}
        tally={view === "live" && registrationId ? pushTally : null}
        poll={view === "live" && registrationId ? pushPoll : null}
        survey={view === "live" && registrationId ? pushSurvey : null}
        announcements={view === "live" && registrationId ? announcements : []}
      />

      {/* 공지 배너 — 라이브 뷰에서만. announcements 는 뷰 전환 시 초기화되지 않아,
          게이팅이 없으면 사전등록하러 나간 대기 화면이나 종료 화면에 이전 라이브 공지가 잔류한다. */}
      {view === "live" && announcements.length > 0 && (
        <div
          style={{ backgroundColor: accent }}
          className="px-4 py-2.5 text-center text-sm font-medium"
        >
          {announcements[0].message}
        </div>
      )}

      {/* 진행자가 화면에 띄운 Q&A — 지금 답변 중인 질문 (등록 시청자에게만) */}
      <AnimatePresence>
        {view === "live" && registrationId && pushedQuestion && (
          <motion.div
            key="pushed-q"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
            style={{ borderBottom: `1px solid ${accent}` }}
          >
            <div className="mx-auto max-w-3xl px-4 py-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>지금 답변 중인 질문</div>
              <p className="text-sm font-medium" style={{ color: text }}>{pushedQuestion.question}</p>
              {pushedQuestion.name && <p className="mt-0.5 text-xs opacity-60" style={{ color: text }}>— {pushedQuestion.name}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 진행자가 고정한 채팅 메시지 (등록 시청자에게만) */}
      <AnimatePresence>
        {view === "live" && registrationId && pinnedMessage && (
          <motion.div
            key="pinned-msg"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-b border-black/10 dark:border-white/10"
          >
            <div className="mx-auto flex max-w-3xl items-start gap-2 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 text-xs" style={{ color: accent }}>📌</span>
              <p className="min-w-0 text-sm" style={{ color: text }}>
                <b className="font-semibold">{pinnedMessage.isHost ? `${pinnedMessage.name} · 진행자` : pinnedMessage.name}</b>{" "}
                <span className="opacity-90">{pinnedMessage.message}</span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {view === "live" && registrationId ? (
        <LiveContentStk
          webinar={webinar}
          accent={accent}
          text={text}
          surface={surface}
          youtubeId={videoId}
          serverNowMs={serverNowMs}
          isLive={isTrulyLive}
          viewerCount={viewerCount}
          chatEnabled={chatEnabled}
          onTabChange={setActiveTab}
          slug={slug}
          registrationId={registrationId}
          qa={{
            sessions: webinar.sessions,
            question,
            setQuestion,
            selectedSession,
            setSelectedSession,
            onSend: handleSendQA,
            isSending: isSendingQA,
            sent: qaSent,
            error: qaError,
            answered: answeredQA,
            // 폐쇄형은 목록이 없어 추천 대상도 없다 → 핸들러를 아예 넘기지 않는다
            onVote: qaMode === "closed" ? undefined : handleVoteQA,
            votedIds: [...votedQa],
            mode: qaMode,
          }}
          chat={chatEnabled ? {
            messages: chatMessages,
            input: chatInput,
            setInput: setChatInput,
            onSend: handleSendChat,
            isSending: isSendingChat,
            error: chatError,
          } : undefined}
          notifyState={{ subscribed: notifySubscribed, onToggle: handleNotifyToggle, error: notifyError, pending: notifyPending }}
          onReauth={previewMode ? undefined : handleReauth}
          // 공유는 부모가 처리한다 — 추천 코드·기록은 등록자 컨텍스트를 아는 이쪽에만 있다
          onShare={() => void handleShare("live")}
          shareCopied={shareCopied}
        />
      ) : (
      <div>

        {/* 뷰: 사전등록 — 등록 여부와 무관하게 같은 대기 화면(카운트다운·아젠다)을 보여준다.
            미등록자에겐 그 안에 사전등록 CTA 를 얹고, 폼은 아래에 이어 붙인다. */}
        {view === "signup" && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="space-y-5">
            <PreLiveWaiting
              webinar={{ name: webinar.name, description: webinar.description ?? null, liveStartAt: webinar.liveStartAt, sessions: webinar.sessions }}
              accent={accent}
              text={text}
              surface={surface}
              targetIso={webinar.liveStartAt}
              serverNowMs={serverNowMs}
              registered={hasRegistration}
              live={live}
              waitingCount={waitingCount}
              registrantCount={registrantCount}
              hasCalendar
              onCalendar={downloadCalendar}
              onShare={() => void handleShare("waiting")}
              shareCopied={shareCopied}
              // 알림 구독은 등록 이메일이 필요하다 — 미등록자에겐 버튼을 숨기고(누르면 항상 실패) 등록 CTA 로 유도
              onNotify={hasRegistration ? handleNotifyToggle : undefined}
              notify={{ subscribed: notifySubscribed, pending: notifyPending, error: notifyError }}
              centerAction={hasRegistration ? (
                // 등록자용 — ?view=signup 이 붙은 링크(리마인더·북마크)로 들어오면 상태와 무관하게
                // 대기 화면이 고정된다. 입장이 열려 있으면 들어갈 길을 반드시 보여준다.
                entryOpenNow ? (
                  <div
                    className="mx-auto w-full max-w-md p-6 text-center"
                    style={{ backgroundColor: surface, borderRadius: radius, boxShadow: "0 1px 2px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.08)" }}
                  >
                    <h2 className="text-base font-bold">입장이 열렸어요</h2>
                    <p className="mt-1 text-sm opacity-60">등록을 마치셨어요. 바로 입장할 수 있어요.</p>
                    <button
                      type="button"
                      onClick={() => { setViewParam(null); void fetchStatus(); }}
                      className="mt-4 flex w-full items-center justify-center font-bold text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: accent, borderRadius: `calc(${radius} * 0.6)`, minHeight: 48 }}
                    >
                      웨비나 입장하기 →
                    </button>
                  </div>
                ) : undefined
              ) : (
                <div
                  className="mx-auto w-full max-w-md p-6 text-center"
                  style={{ backgroundColor: surface, borderRadius: radius, boxShadow: "0 1px 2px rgba(0,0,0,.06), 0 12px 32px rgba(0,0,0,.08)" }}
                >
                  {canRegister ? (
                    <>
                      <h2 className="text-base font-bold">아직 등록하지 않으셨나요?</h2>
                      <p className="mt-1 text-sm opacity-60">사전등록하면 시작 전에 알려드리고, 바로 입장할 수 있어요.</p>
                      <button
                        type="button"
                        onClick={(event) => {
                          setRegistrationOpener(event.currentTarget);
                          setRegModalOpen(true);
                        }}
                        className="mt-4 flex w-full items-center justify-center font-bold text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: accent, borderRadius: `calc(${radius} * 0.6)`, minHeight: 48 }}
                      >
                        사전등록하기 →
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-base font-bold">등록이 마감되었어요</h2>
                      <p className="mt-1 text-sm opacity-60">사전 등록 기간이 종료됐어요.<br />시작 시각에 맞춰 다시 방문해 주세요.</p>
                    </>
                  )}
                  {/* 입장 확인에서 "사전등록하기"로 넘어온 등록자의 되돌아갈 길 —
                      URL 의 ?view=signup 고정을 풀지 않으면 어떤 폴링도 입장 화면으로 보내주지 않는다. */}
                  {entryOpenNow && (
                    <button
                      type="button"
                      onClick={() => { setViewParam(null); void fetchStatus(); }}
                      className="mt-3 text-xs underline underline-offset-4 opacity-60 transition-opacity hover:opacity-100"
                      style={{ minHeight: 44 }}
                    >
                      이미 등록하셨나요? 입장 확인으로 돌아가기
                    </button>
                  )}
                </div>
              )}
            />
          </motion.div>
        )}

        {/* 등록 폼 모달 — 대기 화면의 "사전등록하기"로 연다. 대기 화면 자체는 그대로 두고 위에 띄운다.
            canRegister 는 렌더 조건이 아니라 내부 분기 — 폴링으로 마감이 뒤집힐 때 모달이 통째로
            사라지면 입력이 증발하고, regModalOpen 이 남아 배경 스크롤이 영영 잠긴다. */}
        {view === "signup" && !hasRegistration && regModalOpen && (
          <div
            ref={registrationDialogRef}
            className="mw-modal-overlay mw-reset"
            style={{
              "--mw-accent": accent,
              "--mw-on-accent": onAccentColor(accent),
              "--mw-radius": radius,
              "--mw-text": text,
              "--mw-surface": surface,
              zIndex: 60,
            } as React.CSSProperties}
            onClick={(e) => { if (e.target === e.currentTarget) setRegModalOpen(false); }}
            role="dialog"
            aria-modal="true"
            aria-label="사전 등록"
            tabIndex={-1}
          >
            <motion.div
              className="mw-modal-card"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18 }}
            >
              <div className="mw-modal-head">
                <h2 className="mw-form-title">
                  {canRegister ? `${webinar.name} 사전등록` : "등록이 마감되었어요"}
                </h2>
                <button
                  type="button"
                  onClick={() => setRegModalOpen(false)}
                  aria-label="닫기"
                  className="mw-modal-close"
                >
                  ×
                </button>
              </div>
              <div className="mw-modal-body">
                <div className="mw-form-card">
                  {!canRegister ? (
                    <div className="py-8 text-center">
                      <p className="text-sm opacity-60">작성 중에 등록 기간이 종료됐어요.<br />시작 시각에 맞춰 다시 방문해 주세요.</p>
                    </div>
                  ) : (
                  <>
                    <p className="mw-hint mb-5">
                      등록 마감 {formatKst(webinar.signupDeadline, { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3">
                        {visibleFields.map(renderRegistrationField)}
                      </div>

                      <div className="space-y-2 pt-1">
                        {([
                          { kind: "privacy" as const, text: registrationForm.privacyText, body: registrationForm.privacyBody, mode: registrationForm.privacyBodyMode, linkUrl: safeHttpUrl(registrationForm.privacyLinkUrl), checked: form.agreePrivacy, set: (v: boolean) => setForm((f) => ({ ...f, agreePrivacy: v })) },
                          { kind: "marketing" as const, text: registrationForm.marketingText, body: registrationForm.marketingBody, mode: registrationForm.marketingBodyMode, linkUrl: safeHttpUrl(registrationForm.marketingLinkUrl), checked: form.agreeMarketing, set: (v: boolean) => setForm((f) => ({ ...f, agreeMarketing: v })) },
                          ...(registrationForm.thirdPartyEnabled
                            ? [{ kind: "thirdParty" as const, text: registrationForm.thirdPartyText, body: registrationForm.thirdPartyBody, mode: registrationForm.thirdPartyBodyMode, linkUrl: safeHttpUrl(registrationForm.thirdPartyLinkUrl), checked: form.agreeThirdParty, set: (v: boolean) => setForm((f) => ({ ...f, agreeThirdParty: v })) }]
                            : []),
                        ]).map((consent) => (
                          <label key={consent.kind} className="mw-check">
                            <input
                              type="checkbox"
                              checked={consent.checked}
                              onChange={(e) => consent.set(e.target.checked)}
                            />
                            {consent.mode === "link" && consent.linkUrl ? (
                              <a href={consent.linkUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-left underline decoration-from-font underline-offset-2 transition-opacity hover:opacity-90">{consent.text}</a>
                            ) : consent.body ? (
                              // 본문이 설정돼 있으면 텍스트 클릭 = 약관 팝업 (체크 토글은 체크박스에서만)
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setTermsModal({
                                    kind: consent.kind,
                                    title: consent.text,
                                    body: consent.body,
                                    opener: e.currentTarget,
                                  });
                                }}
                                className="text-left underline decoration-from-font underline-offset-2 transition-opacity hover:opacity-90"
                              >
                                {consent.text}
                              </button>
                            ) : (
                              <span>{consent.text}</span>
                            )}
                          </label>
                        ))}
                      </div>

                      {formError && (
                        <p className="mw-msg mw-msg-error" role="alert">{formError}</p>
                      )}

                      <motion.button
                        onClick={handleRegister}
                        disabled={isRegistering || dupCheck.phone || dupCheck.email}
                        className="mw-submit"
                        whileHover={{ y: -1 }}
                        whileTap={{ scale: 0.96 }}
                        transition={spring}
                      >
                        {isRegistering ? "등록 중..." : registrationForm.submitLabel}
                      </motion.button>
                    </div>
                  </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* 뷰: 라이브 */}
        {view === "live" && !registrationId && (
          <EntryVerify
            webinar={{ name: webinar.name, description: webinar.description ?? null, liveStartAt: webinar.liveStartAt, sessions: webinar.sessions }}
            accent={accent}
            text={text}
            surface={surface}
            targetIso={webinar.liveStartAt}
            serverNowMs={serverNowMs}
            isLive={isTrulyLive}
            authMethod={authMethod}
            authValue={authValue}
            verifyError={verifyError}
            isVerifying={isVerifying}
            onAuthMethod={(m) => { setAuthMethod(m); setAuthValue(""); setVerifyError(""); }}
            onAuthValueChange={(v) => setAuthValue(authMethod === "phone" ? v.replace(/[^0-9]/g, "") : v)}
            onVerify={handleVerifyEntry}
            canRegister={canRegister}
            onGoSignup={() => {
              if (previewMode) { setPreviewState("registration"); return; }
              // URL 에 의도를 남기지 않으면 30초 뒤 상태 폴링이 입장 확인 화면으로 되돌려
              // 입력하던 등록 정보가 사라진다.
              setViewParam("signup");
              setView("signup");
            }}
            live={live}
            viewerCount={viewerCount ?? undefined}
            hasCalendar
            onCalendar={downloadCalendar}
            onShare={() => void handleShare("waiting")}
            shareCopied={shareCopied}
            // 이 화면 진입 시 registrationId 는 항상 null(인증 전) — 버튼을 넘기면 누르는 즉시
            // "이메일이 없어 알림을 받을 수 없어요" 가 뜬다. 대기 화면(PreLiveWaiting)과 같은 기준.
            onNotify={registrationId ? handleNotifyToggle : undefined}
            notify={{ subscribed: notifySubscribed, pending: notifyPending, error: notifyError }}
          />
        )}

        {/* 뷰: 종료 */}
        {view === "ended" && (
          <EndedScreen
            webinar={{ name: webinar.name, description: webinar.description ?? null }}
            accent={accent}
            text={text}
            surface={surface}
            live={live}
            surveys={surveyLinks}
            serverNowMs={serverNowMs}
            onOpenSurvey={(s) => setOpenedSurvey(s)}
            hasRegistration={hasRegistration}
            completedSurveyIds={completedSurveyIds}
            /* 종료 화면에서는 등록 자체가 이미 마감(canRegister=false)돼 있다 — 예전엔 여기서
               등록 모달을 열었지만, 상태 폴 이펙트가 곧바로 ?view=signup 고정을 무시하고 되돌려
               버튼이 눌러도 반응 없는 것처럼 보였고, 모달이 열려도 "등록이 마감되었어요" 라는
               틀린 안내만 떴다(아무것도 안 쓴 사람에게). 이 게이트를 열 의도가 없는 쪽으로
               고친다 — onRequireRegister 를 넘기지 않으면 EndedScreen 이 문구·커서 모두
               클릭 불가로 보여준다(EndedScreen.tsx 의 hasNextStep 참고). */
            // 다시보기 신청은 등록 이메일이 있어야 발송된다 — 미등록자에겐 버튼을 숨긴다(누르면 항상 400).
            onReplay={hasRegistration ? handleNotifyToggle : undefined}
            replayRequested={notifySubscribed}
            replayPending={notifyPending}
            onShare={() => void handleShare("ended")}
            shareCopied={shareCopied}
          />
        )}
      </div>
      )}

      {/**
       * 사전등록 완료 팝업 — 자동으로 닫지 않는다. 등록 직후 화면이 대기(등록자용)로 바뀌거나
       * 라이브로 넘어가기도 해서, 시간으로 닫으면 "봤는지" 를 보장할 수 없다.
       * 안내 문구는 임베드 폼의 성공 문구와 같은 말을 한다 — 같은 행동의 결과가 면에 따라
       * 다르게 설명되면 안 된다.
       */}
      {registerDone && (
        <ViewerModal
          surface={surface}
          text={text}
          soft={soft}
          label="사전등록 완료"
          onClose={() => setRegisterDone(false)}
          restoreFocusTo={
            hasRegistration
              ? viewerFocusRoot
              : registrationOpener?.isConnected
                ? registrationOpener
                : viewerFocusRoot
          }
          zIndex={80}
          maxWidthClass="max-w-sm"
        >
          <div className="py-4 text-center">
            <div
              className="mw-done-mark mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full text-2xl"
              style={{
                background: `color-mix(in srgb, ${accent} 14%, ${surface})`,
                color: accent,
              }}
              aria-hidden
            >
              ✓
            </div>
            <p className="text-lg font-bold">사전등록이 완료됐어요</p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: soft(65) }}>
              웨비나 당일 등록하신 연락처·이메일로 바로 입장할 수 있어요.
            </p>
            {showCompletionCta && (
              <a
                href={completionCtaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl px-6 text-sm font-bold"
                style={{ background: accent, color: onAccentColor(accent) }}
              >
                {registrationForm.successCta.label}
              </a>
            )}
            <button
              type="button"
              onClick={confirmCompletion}
              className={`${showCompletionCta ? "mt-2 bg-transparent" : "mt-6"} inline-flex h-11 w-full items-center justify-center rounded-xl px-6 text-sm font-bold`}
              style={showCompletionCta
                ? { color: soft(70) }
                : { background: accent, color: onAccentColor(accent) }}
            >
              {showCompletionCta ? "닫기" : "확인"}
            </button>
          </div>
        </ViewerModal>
      )}

      {/* 종료 화면 설문 팝업 — 우리 설문만 여기로 온다(외부 URL 은 새 탭). */}
      {openedSurvey?.surveyId && (
        <EndedSurveyDialog
          slug={slug}
          surveyId={openedSurvey.surveyId}
          fallbackTitle={openedSurvey.title?.trim() || "설문"}
          registrationId={registrationId}
          accent={accent}
          surface={surface}
          text={text}
          soft={soft}
          readOnly={isPreviewUrl()}
          onClose={() => setOpenedSurvey(null)}
        />
      )}

      {/* 동의 약관 전문 팝업 — 등록 모달보다 위에서 키보드/포커스를 단독 소유한다. */}
      {termsModal && (
        <ViewerModal
          surface={surface}
          text={text}
          soft={soft}
          label={termsModal.title}
          onClose={() => setTermsModal(null)}
          restoreFocusTo={termsModal.opener}
          zIndex={90}
        >
          <h3 className="text-base font-semibold">{termsModal.title}</h3>
          <div className="mt-3 max-h-[55vh] overflow-y-auto text-sm leading-relaxed opacity-75 whitespace-pre-wrap">
            {termsModal.body}
          </div>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setTermsModal(null)}
              className="flex-1 py-2.5 text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
              style={{ borderRadius: `calc(${radius} * 0.6)`, boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.35)" }}
            >
              닫기
            </button>
            <button
              type="button"
              onClick={() => {
                setForm((f) =>
                  termsModal.kind === "privacy"
                    ? { ...f, agreePrivacy: true }
                    : termsModal.kind === "marketing"
                      ? { ...f, agreeMarketing: true }
                      : { ...f, agreeThirdParty: true },
                );
                setTermsModal(null);
              }}
              className="flex-1 py-2.5 text-sm font-semibold"
              style={{
                backgroundColor: accent,
                color: onAccentColor(accent),
                borderRadius: `calc(${radius} * 0.6)`,
              }}
            >
              동의합니다
            </button>
          </div>
        </ViewerModal>
      )}
    </div>
  );
}
