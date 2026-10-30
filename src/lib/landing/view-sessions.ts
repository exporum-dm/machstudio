/**
 * 랜딩 Sessions / Time Table / 세션 상세 팝업 뷰 — 프레임워크 비의존.
 *
 * 원본은 `src/app/webinar/[slug]/landing/page.tsx` 의 JSX. 클래스명·DOM 구조·텍스트를 그대로 옮겼다
 * (CSS 는 이미 landing/css.ts 로 분리돼 있어 시각 회귀 0 이 목표).
 *
 * 원본과 의도적으로 달라지는 유일한 지점: 모달 위치.
 * 원본은 position:absolute + 클릭한 카드의 문서 Y 를 인라인 top 으로 박았지만, 호스트 DOM 에 직접
 * 마운트되면 조상의 position:relative/transform 이 containing block 이 되어 좌표가 어긋난다.
 * → 인라인 top/left/transform 을 일절 넣지 않고 위치는 CSS(fixed + 중앙 정렬)에 맡긴다.
 * ESC·포커스 트랩·스크롤 잠금도 여기서 하지 않는다(레이어를 소유한 mount 쪽 책임).
 */

import { isPauseSession, sessionHasSpeaker, sessionTypeMeta } from "@/lib/webinar-sessions";
import { normalizeSpeakerLinks, type SpeakerLink } from "@/lib/webinar-speaker-links";
import { safeHttpUrl } from "@/lib/webinar-config";
import { cx, h, svg } from "@/lib/dom/h";
import { parseSpeaker } from "./model";
import type { LandingModel, LandingSession } from "./types";
import { IMAGE_PRESETS, transformedImageUrl } from "@/lib/webinar-image";

/** 카드/모달에서 반복되는 "→" 화살표. */
function arrowIcon(): SVGElement {
  return svg(
    "svg",
    { viewBox: "0 0 24 24" },
    svg("path", {
      d: "M5 12h13M13 6l6 6-6 6",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
}

/** 아코디언 펼침 표시 — 열리면 CSS 가 180도 돌린다. */
function chevronIcon(): SVGElement {
  return svg(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true" },
    svg("path", {
      d: "M6 9l6 6 6-6",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
}

/**
 * SNS 아이콘 — 플랫폼별 한 글리프. 브랜드 로고를 그대로 쓰지 않고 단색 실루엣으로 통일한다
 * (테마 색 위에서 브랜드 색이 서로 싸우고, 로고 사용 조건도 플랫폼마다 다르다).
 * 모르는 호스트(kind: "link")는 일반 링크 모양.
 */
const LINK_PATHS: Record<string, string> = {
  linkedin: "M4.98 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.76-1.95 4.02 0 4.76 2.5 4.76 5.76V21h-4v-5.5c0-1.31-.02-3-1.9-3-1.9 0-2.19 1.4-2.19 2.9V21h-4z",
  instagram: "M12 2.5c2.6 0 2.9.01 3.9.06 1 .04 1.7.2 2.3.44.6.24 1.1.55 1.6 1.05.5.5.81 1 1.05 1.6.24.6.4 1.3.44 2.3.05 1 .06 1.3.06 3.9s-.01 2.9-.06 3.9c-.04 1-.2 1.7-.44 2.3a4.3 4.3 0 01-1.05 1.6c-.5.5-1 .81-1.6 1.05-.6.24-1.3.4-2.3.44-1 .05-1.3.06-3.9.06s-2.9-.01-3.9-.06c-1-.04-1.7-.2-2.3-.44a4.3 4.3 0 01-1.6-1.05 4.3 4.3 0 01-1.05-1.6c-.24-.6-.4-1.3-.44-2.3C2.51 14.9 2.5 14.6 2.5 12s.01-2.9.06-3.9c.04-1 .2-1.7.44-2.3A4.3 4.3 0 014.05 4.2c.5-.5 1-.81 1.6-1.05.6-.24 1.3-.4 2.3-.44 1-.05 1.3-.06 3.9-.06zm0 4.6a4.9 4.9 0 100 9.8 4.9 4.9 0 000-9.8zm0 8.08a3.18 3.18 0 110-6.36 3.18 3.18 0 010 6.36zm6.24-8.28a1.14 1.14 0 11-2.29 0 1.14 1.14 0 012.29 0z",
  x: "M17.53 3h3.2l-6.99 7.99L21.75 21h-5.2l-4.07-5.32L7.8 21H4.6l7.28-8.32L3.5 3h5.3l3.83 5.06zM16.4 19.2h1.77L7.68 4.72H5.8z",
  youtube: "M21.6 7.2a2.5 2.5 0 00-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.84.43A2.5 2.5 0 002.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 001.76 1.77C5.75 19 12 19 12 19s6.25 0 7.84-.43a2.5 2.5 0 001.76-1.77C22 15.2 22 12 22 12s0-3.2-.4-4.8zM10 15.5v-7l6 3.5z",
  facebook: "M22 12a10 10 0 10-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0022 12z",
  github: "M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.4 9.4 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0012 2z",
  threads: "M16.4 11.3c-.1-.05-.2-.1-.3-.14-.18-3.3-1.98-5.2-5-5.22h-.04c-1.8 0-3.3.77-4.22 2.17l1.66 1.14c.69-1.04 1.77-1.26 2.56-1.26h.03c.98 0 1.72.29 2.2.85.35.4.58.96.7 1.66a12.6 12.6 0 00-2.83-.14c-2.85.17-4.69 1.83-4.57 4.15.06 1.17.65 2.18 1.64 2.84.85.56 1.93.83 3.06.77 1.49-.08 2.64-.65 3.44-1.69.6-.79.98-1.81 1.15-3.1.7.42 1.21.98 1.5 1.65.48 1.14.51 3-1.02 4.53-1.34 1.34-2.95 1.92-5.38 1.94-2.7-.02-4.74-.88-6.06-2.56C4.65 17.19 4.01 14.98 4 12c.01-2.98.65-5.19 1.88-6.75C7.2 3.57 9.24 2.71 11.94 2.7c2.72.02 4.8.88 6.17 2.56.68.83 1.19 1.87 1.53 3.08l1.94-.52c-.41-1.49-1.05-2.78-1.92-3.84C17.9 1.85 15.28.72 11.95.7h-.01C8.62.72 6.03 1.86 4.35 4.09 2.86 6.07 2.09 8.82 2.06 12v.01c.03 3.17.8 5.92 2.29 7.9C6.03 22.14 8.62 23.28 11.94 23.3h.01c2.96-.02 5.04-.79 6.76-2.5 2.25-2.25 2.18-5.07 1.44-6.8-.53-1.24-1.55-2.25-2.95-2.9zm-4.9 5.16c-1.25.07-2.55-.49-2.61-1.68-.05-.88.62-1.87 2.69-1.99.24-.01.47-.02.7-.02.75 0 1.45.07 2.09.21-.24 2.98-1.64 3.42-2.87 3.48z",
  tistory: "M4 4h16v3.4h-6.15V20h-3.7V7.4H4z",
  brunch: "M6.5 3.5h3.1l2.4 8.2 2.4-8.2h3.1l-3.9 12.2h-3.2zM8 18h8v2.5H8z",
  naver: "M5 4h4.6l4.8 7.1V4H19v16h-4.6L9.6 12.9V20H5z",
  link: "M10.6 13.4a4 4 0 010-5.66l2.83-2.83a4 4 0 015.66 5.66l-1.42 1.41M13.4 10.6a4 4 0 010 5.66l-2.83 2.83a4 4 0 01-5.66-5.66l1.42-1.41",
};

/** kind 별 아이콘. link 만 선(stroke) 아이콘이라 채움 규칙이 다르다. */
function linkIcon(kind: string): SVGElement {
  const d = LINK_PATHS[kind] ?? LINK_PATHS.link;
  const outline = d === LINK_PATHS.link;
  return svg(
    "svg",
    { viewBox: "0 0 24 24", "aria-hidden": "true" },
    svg("path", {
      d,
      ...(outline
        ? { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" }
        : { fill: "currentColor" }),
    }),
  );
}

/** 세션 카드 내부 — article/button 어느 쪽이든 같은 내용. */
function sessionCardInner(m: LandingModel, session: LandingSession): (Node | false)[] {
  const sp = parseSpeaker(session.speaker, session.speakerCompany);
  return [
    Boolean(session.speakerPhotoUrl) &&
      h("img", { class: "session-photo", src: transformedImageUrl(session.speakerPhotoUrl, IMAGE_PRESETS.sessionCardPhoto), alt: "", loading: "lazy" }),
    h(
      "div",
      { class: "session-card-body" },
      h("span", { class: "session-time" }, session.startTime, "–", session.endTime),
      h("h3", null, session.title),
      /**
       * 연사 정보와 '자세히 보기' 를 **한 줄**에 둔다 — 이름·회사는 왼쪽, 링크는 오른쪽 하단.
       * 예전엔 세로로 쌓여서 링크가 이름 바로 아래 붙었는데, 카드 하단에서 두 정보가
       * 같은 축을 쓰다 보니 시선이 어디서 멈춰야 하는지 애매했다. 좌우로 갈라 두면
       * "누가" 와 "더 보기" 가 서로 다른 역할이라는 게 위치로 드러난다.
       */
      h(
        "div",
        { class: "session-foot" },
        h(
          "div",
          { class: "speaker" },
          Boolean(sp.name) && h("b", null, sp.name),
          Boolean(sp.company) && h("span", { class: "speaker-co" }, sp.company),
        ),
        m.detailPopup &&
          h("span", { class: "session-more", "aria-hidden": "true" }, "자세히 보기", arrowIcon()),
      ),
    ),
  ];
}

/**
 * Sessions 섹션. detailPopup 이면 카드가 버튼이 되고, 클릭 시 onOpen(세션, 누른 엘리먼트)을 부른다
 * (opener 는 모달 닫힐 때 포커스를 되돌리는 데 쓴다).
 */
export function renderSessions(
  m: LandingModel,
  onOpen: (s: LandingSession, opener: HTMLElement) => void,
): HTMLElement | null {
  if (m.sessionCards.length === 0) return null;
  const titleId = m.sectionId("lnd-sessions-title");
  return h(
    "section",
    { class: "section accent-zone", id: m.sectionId("lnd-sessions"), "aria-labelledby": titleId },
    h("h2", { class: "section-title rv", id: titleId }, "Sessions"),
    h(
      "div",
      { class: "session-cards rv" },
      m.sessionCards.map((session) =>
        m.detailPopup
          ? h(
              "button",
              {
                type: "button",
                class: "session-card is-clickable",
                "aria-haspopup": "dialog",
                "aria-label": `${session.title} — 연사 상세 보기`,
                onclick: (e: Event) => onOpen(session, e.currentTarget as HTMLElement),
              },
              sessionCardInner(m, session),
            )
          : h("article", { class: "session-card" }, sessionCardInner(m, session)),
      ),
    ),
  );
}

/**
 * Time Table 섹션 — 한 줄이 한 세션. 상세(세션 내용)가 있는 행은 펼칠 수 있다.
 *
 * 접힘/펼침을 나눈 기준: 훑을 때 필요한 건 **시각 · 무엇 · 누구** 세 개다. 그래서 접힌 줄에는
 * 로고를 두지 않는다 — 마크는 훑기에 기여하지 않으면서 줄마다 폭이 달라 눈이 걸린다
 * (같은 이유로 이름·소속은 "이름 | 소속·직책" 한 줄로 합친다). 로고와 상세는 펼쳤을 때 나온다.
 *
 * 상세가 없는 행은 details 로 만들지 않는다 — 펼쳤더니 비어 있는 것이 안 열리는 것보다 나쁘다.
 */
export function renderTimetable(m: LandingModel): HTMLElement | null {
  if (m.timetableRows.length === 0) return null;
  const titleId = m.sectionId("lnd-timetable-title");
  return h(
    "section",
    { class: "section accent-zone", id: m.sectionId("lnd-timetable"), "aria-labelledby": titleId },
    h("h2", { class: "section-title rv", id: titleId }, "Time Table"),
    h(
      "ul",
      { class: "schedule rv" },
      m.timetableRows.map((row) => {
        const meta = sessionTypeMeta(row.type);
        const sp = parseSpeaker(row.speaker, row.speakerCompany);
        const showSpeaker = sessionHasSpeaker(row.type) && Boolean(sp.name || sp.company);
        // 펼칠 거리가 있는가 — 상세 본문 또는 로고. 로고만 있어도 펼칠 값이 있다(주최 마크 확인).
        const expandable = Boolean(row.description || row.logoUrl);

        const head = [
          h("div", { class: "schedule-time" }, row.startTime, "–", row.endTime),
          h(
            "div",
            { class: "schedule-content" },
            h(
              "span",
              { class: "schedule-name" },
              row.title,
              // 태그 문구도 유형 표에서 — 여기만 "Live Q&A" 로 갈라져 있었다
              Boolean(meta?.landingTag) && h("span", { class: "tag" }, meta!.landingTag!),
            ),
            /* 연사 표시 판정을 hasSpeaker 로 통일. 예전엔 `=== "session"` 정확일치라
               **Q&A 의 "전체 연사" 가 랜딩에서만 사라졌다**(라이브는 `!== "break"` 로 보여 줬다).
               표시는 parseSpeaker 를 거친다 — 레거시 데이터의 speaker 가 "이름 | 회사" 결합형이라
               raw 로 쓰면 구분자가 두 번 나오거나 소속이 이름 안에 박혀 나온다. */
            showSpeaker &&
              h(
                "span",
                { class: "schedule-speaker" },
                Boolean(sp.name) && h("b", null, sp.name),
                Boolean(sp.name && sp.company) && h("span", { class: "sep", "aria-hidden": "true" }, "|"),
                Boolean(sp.company) && h("span", { class: "co" }, sp.company),
              ),
          ),
        ];

        const detail = h(
          "div",
          // data-acc-body: 아코디언 모션이 높이를 재는 대상(effects.attachAccordion).
          { class: "schedule-detail", "data-acc-body": "" },
          h(
            "div",
            { class: "schedule-detail-in" },
            Boolean(row.description) && h("p", { class: "schedule-desc" }, row.description),
            Boolean(row.logoUrl) &&
              h("img", { class: "schedule-logo", src: transformedImageUrl(row.logoUrl, IMAGE_PRESETS.sessionLogo), alt: "", loading: "lazy" }),
          ),
        );

        return h(
          "li",
          // 반전(어두운 행)은 **빈 시간에만**. 오프닝·클로징·Q&A 는 세션으로 세지 않지만
          // 콘텐츠라서 일반 행으로 그리고, 대신 위 태그로 종류를 말한다.
          { class: cx("schedule-row", isPauseSession(row.type) && "is-break", expandable && "is-expandable") },
          expandable
            ? h(
                "details",
                { class: "schedule-acc", "data-acc": "" },
                h("summary", { class: "schedule-summary" }, head, h("span", { class: "schedule-chev", "aria-hidden": "true" }, chevronIcon())),
                detail,
              )
            : h("div", { class: "schedule-summary is-static" }, head),
        );
      }),
    ),
  );
}

/**
 * 세션 상세 팝업(글래스모피즘). 배경/닫기 버튼 클릭만 여기서 처리하고, 위치는 CSS 가 잡는다.
 * 닫기 버튼에는 data-ms-modal-close 를 달아 통합자가 초기 포커스를 줄 수 있게 한다.
 */
export function createSessionDialog(
  m: LandingModel,
  session: LandingSession,
  opts: { onClose: () => void },
): HTMLElement {
  const sp = parseSpeaker(session.speaker, session.speakerCompany);
  const hasSpeakerInfo = Boolean(sp.name || sp.company || session.speakerBio);
  /* 링크는 여기서 한 번 더 스킴을 본다. 저장 라우트가 이미 걸렀지만, 이 뷰는 임베드 페이로드
     (남의 사이트에서 받은 JSON)로도 그려진다 — 신뢰 경계가 저장 시점과 다르다. */
  const homepage = safeHttpUrl(session.speakerHomepage);
  const snsLinks: SpeakerLink[] = normalizeSpeakerLinks(session.speakerLinks);
  // 임베드는 호스트 페이지를 떠나지 않게 새 탭으로 — 단독 페이지도 외부 링크는 새 탭이 자연스럽다.
  const linkAttrs = { target: "_blank", rel: "noopener noreferrer" };
  /**
   * 로고도 이 블록의 렌더 조건이다 — 로고는 주최·협력사 마크라 **연사가 없는 세션**
   * (오프닝·클로징)에도 있을 수 있다. 게이트를 연사 정보로만 두면 그런 세션에서 로고가
   * 통째로 사라진다. 반대로 로고만 있는 경우엔 아바타·이름 줄을 그리지 않는다(빈 원 방지).
   */
  const hasSpeaker = hasSpeakerInfo || Boolean(session.logoUrl);
  const photo = session.speakerPhotoUrl;
  const titleId = m.sectionId("modal-title");

  const closeBtn = h(
    "button",
    {
      type: "button",
      class: "lnd-modal-close",
      "aria-label": "닫기",
      "data-ms-modal-close": "",
      onclick: () => opts.onClose(),
    },
    svg(
      "svg",
      { viewBox: "0 0 24 24", "aria-hidden": "true" },
      svg("path", {
        d: "M6 6l12 12M18 6 6 18",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
      }),
    ),
  );

  const dialog = h(
    "div",
    {
      class: cx("lnd-modal", Boolean(photo) && "has-photo"),
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": titleId,
      // 카드 밖(배경) 클릭만 닫히게 — 모달 내부 클릭은 루트로 올라가지 않게 막는다.
      onclick: (e: Event) => e.stopPropagation(),
    },
    closeBtn,
    Boolean(photo) &&
      h(
        "div",
        { class: "lnd-modal-photo" },
        h("img", { src: transformedImageUrl(photo, IMAGE_PRESETS.modalPhoto), alt: sp.name || session.title }),
        Boolean(sp.name || sp.company) &&
          h(
            "div",
            { class: "lnd-modal-photo-cap" },
            Boolean(sp.name) && h("b", null, sp.name),
            Boolean(sp.company) && h("span", null, sp.company),
          ),
      ),
    h(
      "div",
      { class: "lnd-modal-main" },
      h("span", { class: "lnd-modal-time" }, session.startTime, "–", session.endTime),
      h("h3", { id: titleId }, session.title),
      Boolean(session.description) && h("p", { class: "lnd-modal-desc" }, session.description),
      hasSpeaker &&
        h(
          "div",
          { class: "lnd-modal-speaker" },
          h(
            "div",
            { class: "lnd-modal-speaker-head" },
            // 큰 연사 사진(lnd-modal-photo)이 이미 왼쪽에 떠 있으면 이 줄의 작은 사진은 중복이다
            // — photo 가 있을 땐 아바타 자체를 생략한다(사진이 없을 때만 이름 이니셜로 자리를 채운다).
            hasSpeakerInfo && !photo &&
              h(
                "span",
                { class: "lnd-modal-avatar", "aria-hidden": "true" },
                sp.name.trim().charAt(0) || "·",
              ),
            hasSpeakerInfo &&
              h(
                "div",
                { class: "lnd-modal-speaker-id" },
                Boolean(sp.name) && h("b", null, sp.name),
                Boolean(sp.company) && h("span", null, sp.company),
              ),
            /* 로고는 이 줄의 **오른쪽 끝**(margin-left:auto). 이름·소속과 같은 줄에 두면
               "누가 · 어디" 가 한눈에 읽히고, 제목 아래에 두었을 때처럼 본문 흐름을 끊지 않는다. */
            Boolean(session.logoUrl) &&
              h("img", { class: "lnd-modal-logo", src: transformedImageUrl(session.logoUrl, IMAGE_PRESETS.sessionLogo), alt: "", loading: "lazy" }),
          ),
          Boolean(session.speakerBio) &&
            h(
              "div",
              { class: "lnd-modal-bio" },
              h("h4", null, "약력"),
              h("p", null, session.speakerBio),
            ),
          /* 홈페이지는 약력 **아래**, SNS 는 모달 맨 밑(아래 별도 블록). 둘을 나눈 이유:
             홈페이지는 "이 사람/조직을 더 알아보기" 라 약력의 연장이고, SNS 는 팔로우
             행동이라 여정의 끝에 놓는 게 맞다. 한 줄에 섞으면 무엇이 주된 링크인지 흐려진다. */
          Boolean(homepage) &&
            h(
              "a",
              { class: "lnd-modal-home", href: homepage, ...linkAttrs },
              "홈페이지 바로가기",
              arrowIcon(),
            ),
        ),
    ),
    /* SNS 는 `.lnd-modal-main` 의 **형제**여야 한다. 안에 두면 스크롤 영역에 갇혀
       "맨 밑" 이 본문 중간이 되고, grid-column: 1/-1 도 의미가 없어진다(실측: main 이
       187~693 인데 SNS 가 592~663 로 본문 위에 겹쳤다). */
      // 모달 맨 밑 — 아이콘만. 라벨은 aria-label/title 로만 둔다(줄이 길어지면 밑이 무거워진다).
      snsLinks.length > 0 &&
        h(
          "div",
          { class: "lnd-modal-sns" },
          snsLinks.map((link) =>
            h(
              "a",
              {
                class: "lnd-modal-sns-link",
                href: link.url,
                "aria-label": link.label,
                title: link.label,
                ...linkAttrs,
              },
              linkIcon(link.kind),
            ),
          ),
        ),
  );

  return h(
    "div",
    { class: "lnd-modal-root", role: "presentation", onclick: () => opts.onClose() },
    h("div", { class: "lnd-modal-backdrop" }),
    dialog,
  );
}
