/**
 * 티켓 페이지 — `/t/{registrationNo}` (설계 §9.2·§19).
 *
 * 완료 화면을 떠난 뒤에도 **저장해 둘 수 있는 주소**다. 이메일 연동 전에는 등록자가 QR 을
 * 다시 여는 두 경로 중 하나이고(다른 하나는 등록 확인), 상당수는 이 화면을 **캡처해서**
 * 온다 — 그래서 QR 은 시간 기반 회전 코드가 아니라 정적 이미지다(§9.2).
 *
 * ── 왜 번호만으로 열리는가 ─────────────────────────────────────────────
 * 등록번호가 곧 티켓이기 때문이다. 13자리 난수 + 체크digit 이라 추측할 수 없고, 여기서
 * 보여 주는 것은 **이름·유형·번호·QR 뿐**이다(§10.2 와 같은 최소 노출 규칙). 연락처나
 * 다른 문항 답변은 넣지 않는다 — 단, 운영자가 항목별로 `showOnTicket` 을 명시적으로 켠
 * 값(예: 동반 인원 수처럼 현장에서 확인해야 하는 값)은 예외로 보여준다(view.extras).
 *
 * ── 문구가 영어인 이유 ────────────────────────────────────────────────
 * 이 화면은 등록 폼·완료 화면·등록 확인에서 이어지는 **같은 흐름의 마지막 칸**이고,
 * 그 셋이 전부 영어다(LA 파일럿, §2 "영어 단일로 만들되"). 여기만 한국어면 미국 방문자가
 * "Open my ticket page" 를 눌렀을 때 갑자기 읽을 수 없는 화면에 도착한다.
 * 다국어는 §11 에서 로케일 맵으로 한 번에 얹는다 — 그때 이 문구들도 같이 옮긴다.
 */
import { Fragment } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { isValidRegistrationNo, isDomesticRegistrationNo } from "@/lib/collect-registration-no";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { buildTicketView } from "@/lib/collect-lookup";
import { visitorBadgePalette } from "@/lib/collect-badge";
import { TicketDownloadButton } from "./TicketDownloadButton";
import { referralBoardPath } from "@/lib/collect-referral";

export const dynamic = "force-dynamic";

/** 강조 박스 배경 — accent 를 옅게 깐다. 잘못된/빈 값은 기본 accent 로 떨어뜨린다. */
function accentTint(hex: string): { border: string; background: string } {
  const valid = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#F28C18";
  const n = parseInt(valid.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return { border: valid, background: `rgba(${r},${g},${b},0.12)` };
}

/** 티켓 주소가 검색 결과에 뜨면 남의 티켓이 공개되는 것과 같다. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** 티켓 조회 — **필요한 것만 읽는다.** 레코드 전체를 가져오면 나중에 화면으로 흘러든다. */
function loadTicket(regNo: string, key?: string) {
  return prisma.collectRecord.findUnique({
    where: { registrationNo: regNo, ...(isDomesticRegistrationNo(regNo) ? {id:key ?? ""} : {}) },
    select: { registrationNo: true, data: true, sourceId: true, source: { select: { name: true, formConfig: true, deletedAt: true } } },
  });
}

export default async function TicketPage({ params, searchParams }: { params: Promise<{ regNo: string }>; searchParams?: Promise<{key?:string}> }) {
  const { regNo } = await params;

  /**
   * 형식·체크digit 이 안 맞으면 **DB 를 보지 않는다.** 오타 한 글자로 남의 티켓이 열리는 일을
   * 막는 것이 체크digit 을 넣은 이유이고(§9.1), 동시에 무작위 조회가 매번 쿼리가 되는 것도 막는다.
   */
  if (!isValidRegistrationNo(regNo)) notFound();
  const key = (await searchParams)?.key;
  if (isDomesticRegistrationNo(regNo) && (typeof key !== "string" || key.length < 16)) notFound();

  /**
   * 한도를 **IP 가 아니라 (IP, 등록번호)** 로 센다.
   *
   * 현장 와이파이와 통신사 CGNAT 뒤에서는 수백 명이 한 공인 IP 를 공유한다 — IP 만으로
   * 세면 입구 줄에서 31번째 사람부터 자기 티켓이 안 열리고, 문구는 "너무 많이 열었어요"
   * 라 본인 잘못으로 읽혀 스태프에게 몰린다. **한도가 곧 줄이 되는** 실패다.
   *
   * 막으려는 것은 "한 사람이 번호를 바꿔 가며 훑는 것" 이지 "여러 사람이 각자 티켓을
   * 여는 것" 이 아니다. 번호를 키에 넣으면 전자만 걸린다 — 무작위 탐색은 매 시도가
   * 새 번호라 애초에 체크digit 과 13자리 공간이 막고, 같은 번호 반복은 여기서 막힌다.
   */
  const h = await headers();
  const ip = getClientIp(new Request("https://x", { headers: h }));
  const { allowed } = await rateLimitAsync(`collect-ticket:${ip}:${regNo}`, { limit: 30, windowMs: 60_000 });
  if (!allowed) {
    return (
      <div className="grid min-h-dvh place-items-center bg-neutral-100 p-6">
        <div className="max-w-xs rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-neutral-900">Please try again in a moment</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            Too many requests just now. Your ticket is still here.
          </p>
        </div>
      </div>
    );
  }

  /**
   * DB 가 흔들려도 **"Application error" 흰 화면을 보여주지 않는다.**
   * 이 페이지는 현장 줄에서 여는 화면이다 — 알 수 없는 오류가 뜨면 그 사람은 줄을 벗어나
   * 스태프에게 가고, 그게 곧 대기시간이다. 다시 열어 보라고 말해 주는 편이 낫다.
   */
  let record: Awaited<ReturnType<typeof loadTicket>> = null;
  try {
    record = await loadTicket(regNo, key);
  } catch (e) {
    console.error("[ticket] 조회 실패", { regNo, error: e });
    return (
      <div className="grid min-h-dvh place-items-center bg-neutral-100 p-6" style={{ colorScheme: "light" }}>
        <div className="max-w-xs rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-neutral-900">Please try again in a moment</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            We couldn&apos;t load your ticket. Your registration is safe.
          </p>
          <p className="mt-3 font-mono text-xs tracking-widest text-neutral-400">{regNo}</p>
        </div>
      </div>
    );
  }
  /**
   * 체크digit 은 맞는데 DB 에 없는 번호 — 캡처를 보고 손으로 옮겨 적다 두 자리를 바꿔
   * 적어도 Luhn 을 통과하는 조합이 있다. Next 기본 404("This page could not be found")는
   * **무엇이 잘못됐는지도, 어디로 가야 하는지도** 알려 주지 않는다.
   */
  if (!record || record.source.deletedAt) {
    return (
      <div className="grid min-h-dvh place-items-center bg-neutral-100 p-6" style={{ colorScheme: "light" }}>
        <div className="max-w-xs rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-neutral-900">We couldn&apos;t find that ticket</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            Check the number below, or look up your registration with the email you used.
          </p>
          <p className="mt-3 font-mono text-xs tracking-widest text-neutral-400">{regNo}</p>
        </div>
      </div>
    );
  }

  const config = normalizeCollectForm(record.source.formConfig);
  // 조회 화면이 아니라 **번호로 직접 연 티켓**이다 — lookup.showQr 설정과 무관하다.
  const view = buildTicketView(config, record);
  if (!view) notFound();

  const korean = config.defaultLocale === "ko";
  const dates = config.eventInfo.enabled ? config.eventInfo.eventDates : [];
  const accent = accentTint(config.theme.accentColor);

  /**
   * **강제 라이트.** 이 화면은 테마를 따르지 않는다 — QR 카드가 다크 배경 위에 놓이면
   * 검은 모듈의 대비가 사라져 현장에서 안 읽힌다(§9.2). AGENTS.md "색 하드코딩 금지" 의
   * 의도적 예외이고, 여기 흰색은 디자인 토큰이 아니라 **스캔 가능성 요건**이다.
   */
  return (
    <div className="min-h-dvh bg-neutral-100 px-4 py-8" style={{ colorScheme: "light" }}>
      <main className="mx-auto max-w-sm">
        <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">
            {record.source.name}
          </p>
          {dates.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">{dates.join(" · ")}</p>
          )}

          {/*
            유형을 배지로 올린다 — 입장 동선이 유형마다 다르므로 이름보다 먼저 눈에 들어와야 한다.
            **연락처는 여기 넣지 않는다.** 이 화면은 번호만 알면 열린다(§10.2) — 조회 화면은
            본인이 이메일이나 전화를 직접 넣어 통과한 뒤라 가려서 보여 주지만, 여기는 그 관문이 없다.
          */}
          {view.visitorType && (
            <p
              className="mt-4 inline-flex min-w-28 items-center justify-center rounded-full px-5 py-2 text-sm font-black uppercase tracking-[0.1em] shadow-md"
              style={{
                backgroundColor: visitorBadgePalette(view.visitorType, config.badgeRules).background,
                color: visitorBadgePalette(view.visitorType, config.badgeRules).foreground,
              }}
            >
              {view.visitorType}
            </p>
          )}
          {view.name && <p className="mt-2 text-xl font-bold text-neutral-900">{view.name}</p>}

          {/*
            흰 배경·검은 모듈·200px 이상 — 세 조건 모두 §9.2 의 스캔 요건이다.
            패딩 20px(p-5)은 collect-qr.ts 의 QR_WHITE_PAD_PX — 이미지 안의 4모듈 위에
            흰색을 한 겹 더 깔아 다크 배경·축소 상태에서도 3mm 밑으로 떨어지지 않게 한다.
            폭 240px = 이미지 200px + 좌우 패딩 20px. 패딩을 고치면 폭도 같이 고칠 것.
          */}
          <div
            className="mx-auto mt-5 w-[240px] rounded-2xl bg-white p-5"
            style={{ colorScheme: "only light" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- QR 은 서버가 그린 PNG 를 그대로 쓴다(최적화 리사이즈가 모듈을 뭉갠다) */}
            <img
              src={`/api/collect/qr/${encodeURIComponent(view.registrationNo)}`}
              alt={`Registration QR ${view.registrationNo}`}
              width={200}
              height={200}
              className="block h-[200px] w-[200px]"
              style={{ colorScheme: "only light" }}
            />
          </div>

          {/* 등록 데스크에서 QR 을 보여 달라는 안내 — 등록번호 아래 캡션만으로는 놓치기 쉬워 강조한다. */}
          <div
            className="mx-auto mt-4 w-full max-w-[280px] rounded-xl border-l-4 px-3.5 py-3 text-left"
            style={{ borderColor: accent.border, backgroundColor: accent.background }}
          >
            <p className="text-[13px] font-extrabold" style={{ color: accent.border }}>
              {korean ? "등록 데스크에 이 QR코드를 보여주세요" : "Show this QR code at the check-in desk"}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-neutral-600">
              {korean ? "QR코드를 제시하고 행사장에 입장하세요." : "Present it to enter the event."}
            </p>
          </div>

          {(view.maskedPhone || view.maskedEmail || view.extras.length > 0) && (
            <dl className="mx-auto mt-4 grid w-full max-w-[280px] grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl bg-neutral-100 px-4 py-3 text-left text-xs">
              {view.maskedPhone && (
                <>
                  <dt className="font-medium text-neutral-500">{korean ? "연락처" : "Phone"}</dt>
                  <dd className="min-w-0 break-all text-right font-bold text-neutral-800">{view.maskedPhone}</dd>
                </>
              )}
              {view.maskedEmail && (
                <>
                  <dt className="font-medium text-neutral-500">{korean ? "이메일" : "E-mail"}</dt>
                  <dd className="min-w-0 break-all text-right font-bold text-neutral-800">{view.maskedEmail}</dd>
                </>
              )}
              {/* 운영자가 항목별로 켠 값(예: 동반 인원 수) — §10.2 최소 노출의 명시적 예외. */}
              {view.extras.map((extra) => (
                <Fragment key={extra.label}>
                  <dt className="font-medium text-neutral-500">{extra.label}</dt>
                  <dd className="min-w-0 break-all text-right font-bold text-neutral-800">{extra.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}

          <p className="mt-4 font-mono text-lg font-bold tracking-[0.14em] text-neutral-900">
            {view.registrationNo}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">{korean ? "현장에서 등록번호를 보여주세요" : "Show this at the venue"}</p>

          {/*
            파일로도 받게 한다 — 캡처가 막힌 기기(일부 사내폰·키오스크)가 있고,
            캡처는 화면 밝기 자동 조절 때문에 QR 대비가 낮게 저장되는 경우가 있다.
            QR만 저장하지 않고 행사명·배지·이름·연락처·등록번호를 한 장으로 만든다.
          */}
          <TicketDownloadButton korean={korean} ticket={{
            eventName: config.legal.eventName || record.source.name,
            registrationNo: view.registrationNo,
            qrUrl: `/api/collect/qr/${encodeURIComponent(view.registrationNo)}`,
            name: view.name,
            visitorType: view.visitorType,
            badgeBackgroundColor: visitorBadgePalette(view.visitorType, config.badgeRules).background,
            maskedEmail: view.maskedEmail,
            maskedPhone: view.maskedPhone,
            accentColor: config.theme.accentColor,
            extras: view.extras,
          }} />
          <p className="mt-2 text-[11px] text-neutral-500">
            {korean ? "* 저장이 안 되면 화면을 캡처해 주세요." : "* If the button doesn’t work, please take a screenshot."}
          </p>
        </div>

        {/* 친구 초대를 켠 폼만 — 순위는 여기 띄우지 않고, 궁금한 사람만 눌러서 본다 */}
        {config.referral.enabled && (
          <p className="mt-4 text-center">
            <a href={referralBoardPath(record.sourceId)} className="text-xs font-medium text-neutral-600 underline underline-offset-2">
              {korean ? "추천 순위 보기" : "See the referral ranking"}
            </a>
          </p>
        )}

        <p className="mt-4 text-center text-[11px] leading-relaxed text-neutral-500">
          {korean ? "이 페이지를 저장하면 입장권을 다시 열 수 있어요. 화면을 캡처해도 됩니다." : "Save this page to open your ticket any time. A screenshot works too."}
        </p>
      </main>
    </div>
  );
}
