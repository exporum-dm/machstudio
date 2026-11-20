"use client";

import { useEffect, useRef, useState } from "react";
import { Megaphone } from "lucide-react";
import { useAutosave } from "@/components/ui/use-autosave";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { FIELD_CLS, FINISH } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { formatKstDateTime, kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";
import { nextWebinarTransition, webinarFace, type WebinarFace, type WebinarStatusInput } from "@/lib/webinar-status";
import { BANNER_TRANSITIONS, bannerPhaseAt, nextBannerTransition, parseBannerSchedule, type BannerSchedule } from "@/lib/webinar-banner-schedule";

type BannerPhase = "registration" | "live" | "upcoming" | "ended";

/** 상태 머신의 "지금 보이는 모습" → 배너 상태 탭. 배너의 'live' 는 입장이 열린 구간이다. */
const FACE_TO_PHASE: Record<WebinarFace, BannerPhase> = {
  registration: "registration",
  entryOpen: "live",
  upcoming: "upcoming",
  ended: "ended",
};

const BANNER_PHASES: Array<{ key: BannerPhase; label: string }> = [
  { key: "upcoming", label: "시작 전" },
  { key: "registration", label: "사전등록 중" },
  { key: "live", label: "라이브·입장 중" },
  { key: "ended", label: "종료 후" },
];

function scheduleFields(value: BannerSchedule | null): BannerSchedule {
  return {
    registration: value ? kstDateTimeLocalInput(value.registration) : "",
    live: value ? kstDateTimeLocalInput(value.live) : "",
    ended: value ? kstDateTimeLocalInput(value.ended) : "",
  };
}

/**
 * 배너 미리보기.
 *
 * 배너는 **파트너 사이트에만** 뜬다 — 운영자 화면에는 나오지 않아서, 무엇을 고치고 있는지
 * 볼 방법이 없었다("설정할 수 있는 부분이 아예 없고 숨겨져 있다"는 말이 여기서 나온다).
 * 로더(webinar-loader-script.ts)의 시각 언어를 그대로 따른다: 어두운 알약, 왼쪽 배지+문구,
 * 오른쪽 버튼. 색을 새로 정하지 않는다 — 미리보기가 실물과 다르면 없느니만 못하다.
 */
function BannerPreview({ phase, text, labels, showCalendar }: {
  phase: BannerPhase;
  text: string;
  labels: { registration: string; live: string; liveRegister: string; calendar: string; survey: string };
  showCalendar: boolean;
}) {
  const btn = (label: string, primary: boolean) => ({ label, primary });
  const buttons =
    phase === "ended"
      ? [btn(labels.survey, true)]
      : phase === "live"
        ? [btn(labels.liveRegister, false), btn(labels.live, true)]
        : phase === "registration"
          ? [...(showCalendar ? [btn(labels.calendar, false)] : []), btn(labels.registration, true)]
          : showCalendar
            ? [btn(labels.calendar, false)]
            : [];

  // 조건부로만 뜨는 버튼이 있다 — 미리보기가 "항상 이렇게 뜬다"고 오해시키면 안 된다.
  const note =
    phase === "live"
      ? "‘사전등록’은 라이브 중에도 등록을 받는 경우에만 함께 떠요."
      : phase === "ended"
        ? "버튼은 종료 화면 설문을 연결한 경우에만 떠요."
        : phase === "upcoming" && !showCalendar
          ? "캘린더 버튼을 끄면 이 상태 배너는 문구만 남아요."
          : phase === "registration"
            ? "‘캘린더 추가’는 PC 에서는 원래 숨겨져 모바일에만 떠요."
            : "";

  return (
    <div className="mt-4 rounded-2xl bg-secondary/40 p-4">
      <p className="mb-2.5 text-[11px] font-medium text-muted-foreground">미리보기</p>
      <div className="flex flex-col gap-2.5 rounded-2xl border border-white/15 bg-[#17171b] px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 break-keep text-[13px] font-bold leading-snug text-white/95">
          {phase === "live" && (
            <span className="mr-1.5 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 align-middle text-[11px] font-extrabold tracking-wide text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />LIVE
            </span>
          )}
          {phase === "registration" && (
            <span className="mr-1.5 inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 align-middle text-[11px] font-extrabold tracking-wide text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />사전등록
            </span>
          )}
          {text}
        </p>
        {buttons.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            {buttons.map((b) => (
              <span
                key={b.label + String(b.primary)}
                className={`rounded-xl px-3.5 py-2 text-[13px] font-medium ${
                  b.primary ? "bg-violet-500 text-white" : "border border-white/20 bg-white/10 text-white"
                }`}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {note && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function WebinarBannerSettings({ webinarId, webinarName, schedule, onSilentUpdate }: {
  webinarId: string;
  webinarName: string;
  schedule: WebinarStatusInput;
  onSilentUpdate: () => void;
}) {
  const components = schedule.components as Record<string, unknown> | null | undefined;
  // 하단 배너 — 로더가 components.banner 에서 문구·버튼 문구·표시 여부를 읽는다.
  // 비워두면 웨비나 이름 기반 기본값이 나가므로, placeholder 로 그 기본값을 그대로 보여준다.
  const bannerCfg = (components?.banner ?? {}) as Record<string, unknown>;
  const bannerTexts = (bannerCfg.textByStatus ?? {}) as Record<string, string>;
  const bannerBtns = (bannerCfg.buttonLabels ?? {}) as Record<string, string>;
  /**
   * 배너 설정 전체를 **한 상태로 묶는다** — 자동저장이 하나여야 하기 때문이다.
   * 서버의 components 병합은 최상위 키 단위 얕은 병합(`{...base, ...incoming}`)이라,
   * `components: { banner: { showCalendarButton } }` 만 따로 보내면 banner 객체가 통째로
   * 교체돼 **나머지 설정이 지워진다.** 항상 함께 보낸다.
   */
  const [banner, setBanner] = useState({
    // 로더는 `!== false` 로 읽는다(기본 표시) — 그 규약을 화면에서도 그대로 쓴다.
    enabled: bannerCfg.enabled !== false,
    upcoming: bannerTexts.upcoming ?? "",
    registration: bannerTexts.registration ?? "",
    live: bannerTexts.live ?? "",
    ended: bannerTexts.ended ?? "",
    btnRegistration: bannerBtns.registration ?? "",
    btnLive: bannerBtns.live ?? "",
    btnLiveRegister: bannerBtns.liveRegister ?? "",
    btnCalendar: bannerBtns.calendar ?? "",
    btnSurvey: bannerBtns.survey ?? "",
    showCalendarButton: bannerCfg.showCalendarButton !== false,
  });
  const [savedBanner, setSavedBanner] = useState(banner);
  const [savedSchedule, setSavedSchedule] = useState(() => parseBannerSchedule(components?.bannerSchedule));
  const [times, setTimes] = useState(() => scheduleFields(savedSchedule));
  const hasDates = Object.values(times).some(Boolean);
  const complete = Object.values(times).every(Boolean);
  let requestedSchedule: BannerSchedule | null = null;
  if (complete) {
    try {
      requestedSchedule = parseBannerSchedule({
        registration: kstDateTimeLocalToIso(times.registration),
        live: kstDateTimeLocalToIso(times.live),
        ended: kstDateTimeLocalToIso(times.ended),
      });
    } catch { /* 입력 중의 날짜는 아직 저장하지 않는다. */ }
  }
  const scheduleError = hasDates && !requestedSchedule
    ? complete ? "세 전환 시각을 순서대로 입력해주세요." : "세 전환 시각을 모두 입력하면 예약이 저장돼요."
    : "";
  const [bannerPhase, setBannerPhase] = useState<BannerPhase>("upcoming");
  const scheduleToSave = scheduleError ? savedSchedule : requestedSchedule;
  const { state: bannerSaveState, retry: bannerRetry } = useAutosave({ ...banner, schedule: scheduleToSave }, async (value) => {
    const { schedule: nextSchedule, ...bannerFields } = value;
    const res = await fetch(`/api/webinars/${webinarId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        components: {
          ...(JSON.stringify(nextSchedule) !== JSON.stringify(savedSchedule) && { bannerSchedule: nextSchedule }),
          ...(JSON.stringify(bannerFields) !== JSON.stringify(savedBanner) && { banner: {
            enabled: value.enabled,
            textByStatus: {
              upcoming: value.upcoming.trim(),
              registration: value.registration.trim(),
              live: value.live.trim(),
              ended: value.ended.trim(),
            },
            buttonLabels: {
              registration: value.btnRegistration.trim(),
              live: value.btnLive.trim(),
              liveRegister: value.btnLiveRegister.trim(),
              calendar: value.btnCalendar.trim(),
              survey: value.btnSurvey.trim(),
            },
            showCalendarButton: value.showCalendarButton,
            // 화면에 없는 설정도 **그대로 돌려보낸다** — 얕은 병합이라 빠뜨리면 지워진다.
            ...(typeof bannerCfg.dismissible === "boolean" ? { dismissible: bannerCfg.dismissible } : {}),
          } }),
        },
      }),
    });
    if (res.ok) {
      setSavedSchedule(nextSchedule);
      setSavedBanner(bannerFields);
      onSilentUpdate();
    }
    return res.ok;
  });
  useReportAutosave(bannerSaveState, bannerRetry);
  const phasePickedRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const currentPhase = savedSchedule ? bannerPhaseAt(savedSchedule, now) : FACE_TO_PHASE[webinarFace(schedule, new Date(now))];
  const nextDefault = savedSchedule ? null : nextWebinarTransition(schedule, new Date(now));
  const nextTransition = savedSchedule
    ? nextBannerTransition(savedSchedule, now)
    : nextDefault ? { phase: FACE_TO_PHASE[nextDefault.to], at: nextDefault.at } : null;
  const nextAt = nextTransition?.at.getTime();
  useEffect(() => {
    if (nextAt === undefined) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(Math.max(0, nextAt - Date.now()) + 10, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [nextAt, now]);
  useEffect(() => {
    if (phasePickedRef.current) return;
    phasePickedRef.current = true;
    setBannerPhase(currentPhase);
  }, [currentPhase]);

  return (
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Megaphone className="h-4 w-4 text-violet-500" /> 하단 배너
          </h2>
          <AutosaveIndicator state={bannerSaveState} onRetry={bannerRetry} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          아임웹 페이지 하단에 뜨는 배너예요. 상태마다 표시할 시각과 문구를 설정할 수 있어요.
        </p>

        <label className={`mt-4 flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm ${FINISH.s2}`}>
          <span>
            배너 표시
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              끄면 어느 페이지에도 배너가 뜨지 않아요. 히어로 버튼과 등록 폼은 그대로예요.
            </span>
          </span>
          <Switch
            checked={banner.enabled}
            onChange={(v) => setBanner((prev) => ({ ...prev, enabled: v }))}
            label="배너 표시"
          />
        </label>

        {banner.enabled && (() => {
          /* 상태 탭 — 배너는 한 번에 **한 상태만** 존재하므로 화면이 그 구조를 그대로 비춘다.
             네 상태를 한꺼번에 펼치지 않는 이유는 미리보기 때문이다: 지금 고치는 문구가 실제로
             어떤 모습으로 뜨는지 보여줘야 하는데, 배너는 운영자 화면에 나오지 않는다. */
          const ph = {
            registration: { text: `${webinarName} 사전등록이 진행 중입니다.`, primary: "웨비나 사전등록" },
            live: { text: `${webinarName}가 지금 진행 중입니다!`, primary: "웨비나 입장하기" },
            upcoming: { text: `${webinarName}가 곧 시작됩니다.`, primary: "" },
            ended: { text: `${webinarName}가 종료되었습니다. 참여해주셔서 감사합니다!`, primary: "만족도 조사 참여하기" },
          }[bannerPhase];
          const field = (
            label: string,
            key: "registration" | "live" | "upcoming" | "ended" | "btnRegistration" | "btnLive" | "btnLiveRegister" | "btnCalendar" | "btnSurvey",
            placeholder: string,
          ) => (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
              <input
                type="text"
                value={banner[key]}
                onChange={(e) => setBanner((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm transition-colors focus:border-violet-400 focus:outline-none"
              />
            </div>
          );

          return (
            <>
              <div className="mt-4 space-y-2.5 rounded-xl bg-secondary/40 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">상태 전환 예약 <span className="font-normal text-muted-foreground">· 한국시간</span></h3>
                  {hasDates && <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setTimes(scheduleFields(null))}>기본 일정 사용</button>}
                </div>
                {BANNER_TRANSITIONS.map(({ phase, label }) => (
                  <label key={phase} className="grid items-center gap-1.5 text-xs sm:grid-cols-[1fr_minmax(0,14rem)]">
                    <span>{label}</span>
                    <input
                      type="datetime-local"
                      value={times[phase]}
                      onChange={(event) => setTimes((previous) => ({ ...previous, [phase]: event.target.value }))}
                      aria-describedby="banner-schedule-help"
                      className={FIELD_CLS}
                    />
                  </label>
                ))}
                <p id="banner-schedule-help" role="status" className={`text-[11px] leading-relaxed ${scheduleError ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {scheduleError || (savedSchedule
                    ? "예약 시각에 배너가 바뀌어요. 등록·입장 버튼은 실제로 이용할 수 있을 때 표시돼요."
                    : "세 칸을 비워두면 기본 정보의 웨비나 일정을 따라가요.")}
                </p>
              </div>

                <div className="mt-4 rounded-xl bg-secondary/40 px-3 py-2.5">
                  <p className="text-xs">
                    지금 방문자에게 보이는 상태{" "}
                    <b className="font-semibold text-foreground">
                      {BANNER_PHASES.find((p) => p.key === currentPhase)?.label}
                    </b>
                  </p>
                  {!savedSchedule && schedule.statusOverride ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-600">
                      운영 콘솔에서 <b className="font-medium">수동 전환</b> 중이라 예정 시각과 무관하게 이 상태로 고정돼 있어요.
                      운영 콘솔에서 &lsquo;자동 판정으로 되돌리기&rsquo;를 누르면 일정대로 돌아갑니다.
                    </p>
                  ) : nextTransition ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {formatKstDateTime(nextTransition.at.toISOString())} 에{" "}
                      <b className="font-medium text-foreground">
                        {BANNER_PHASES.find((p) => p.key === nextTransition.phase)?.label}
                      </b>
                      {" "}으로 바뀝니다.
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      일정상 예정된 전환이 더 없어요.
                    </p>
                  )}
                </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {BANNER_PHASES.map((p) => {
                  const isNow = currentPhase === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={bannerPhase === p.key}
                      onClick={() => setBannerPhase(p.key)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                        bannerPhase === p.key
                          ? "bg-violet-500 text-white shadow-sm"
                          : "bg-secondary/60 hover:bg-secondary"
                      }`}
                    >
                      {/* 지금 실제로 보이는 상태에 점 — 네 탭 중 어디가 '진짜'인지 한눈에. */}
                      {isNow && (
                        <span className={`h-1.5 w-1.5 rounded-full ${bannerPhase === p.key ? "bg-white" : "bg-violet-500"}`} />
                      )}
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <BannerPreview
                phase={bannerPhase}
                text={banner[bannerPhase].trim() || ph.text}
                labels={{
                  registration: banner.btnRegistration.trim() || "웨비나 사전등록",
                  live: banner.btnLive.trim() || "웨비나 입장하기",
                  liveRegister: banner.btnLiveRegister.trim() || "사전등록",
                  calendar: banner.btnCalendar.trim() || "캘린더 추가",
                  survey: banner.btnSurvey.trim() || "만족도 조사 참여하기",
                }}
                showCalendar={banner.showCalendarButton}
              />

              <div className="mt-4 space-y-3">
                {field("문구", bannerPhase, ph.text)}

                {bannerPhase === "registration" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field("주 버튼", "btnRegistration", "웨비나 사전등록")}
                    {field("캘린더 버튼", "btnCalendar", "캘린더 추가")}
                  </div>
                )}
                {bannerPhase === "live" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {field("주 버튼 (입장)", "btnLive", "웨비나 입장하기")}
                    {field("보조 버튼 (사전등록)", "btnLiveRegister", "사전등록")}
                  </div>
                )}
                {bannerPhase === "upcoming" && field("캘린더 버튼", "btnCalendar", "캘린더 추가")}
                {bannerPhase === "ended" && field("설문 버튼", "btnSurvey", "만족도 조사 참여하기")}

                {/* 캘린더 추가 버튼 — 배너에 두 번째 액션을 둘지. 주 행동(사전등록)과 나란히 서므로
                    행사에 따라 방해가 된다. PC 에서는 로더 CSS 가 이미 숨기므로(네이티브 캘린더 연동이
                    없어 실효가 낮다) 이 스위치가 실제로 가리는 곳은 모바일이다. */}
                {(bannerPhase === "registration" || bannerPhase === "upcoming") && (
                  <label className={`flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm ${FINISH.s2}`}>
                    <span>
                      캘린더 추가 버튼 표시
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                        &lsquo;사전등록 중&rsquo;과 &lsquo;시작 전&rsquo; 두 상태에 함께 적용돼요.
                      </span>
                    </span>
                    <Switch
                      checked={banner.showCalendarButton}
                      onChange={(v) => setBanner((prev) => ({ ...prev, showCalendarButton: v }))}
                      label="캘린더 추가 버튼 표시"
                    />
                  </label>
                )}
              </div>
            </>
          );
        })()}

        <p className="mt-3 text-[11px] text-muted-foreground">
          이미 열려 있는 페이지에는 배너 설정을 다시 받을 때 반영돼요.
        </p>
      </section>

  );
}
