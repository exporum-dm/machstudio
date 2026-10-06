/**
 * 공고 본문 섹션 — 개념 / 한눈에 보기 / 타임라인 / 신청 방법 / 자격 / 선발 방식 /
 * 심사 기준 / 상금 / 카운트다운 / FAQ / 스폰서.
 *
 * 규약은 랜딩 view-sections 와 같다:
 *  - 노출은 m.show 게이트만 믿는다(이중 게이트는 모델에서 끝났다).
 *  - id 는 전부 m.sectionId() 를 통과 — 한 문서에 공고가 둘 이상 붙어도 안 부딪히게.
 *  - 문자열 HTML 금지. 운영자 입력은 텍스트 노드로만 들어간다.
 *  - `rv` 클래스는 스크롤 리빌 대상 표시(effects.attachReveal 이 집는다).
 */
import { h, svg } from "@/lib/dom/h";
import { IMAGE_PRESETS, transformedImageUrl } from "@/lib/webinar-image";
import { bgVars, focusVars } from "./media-focus";
import type { NoticeBgKey } from "./config";
import type { NoticeModel } from "./types";
import { renderPrimaryCta } from "./view-hero";

/**
 * 섹션 배경 이미지 — **켠 섹션에만** 그린다.
 *
 * 히어로와 같은 구조(감싸는 상자 + 안쪽 img)를 쓴다. 그 구조여야 CSS 의 자손 선택자가
 * 걸려 크기·object-fit·스크림이 먹는다 — 예전에 히어로에서 클래스를 img 에 직접 걸었다가
 * 이미지가 찌그러지고 스크림이 안 생겨 "배경이 적용 안 된 것처럼" 보인 적이 있다.
 *
 * 스크림은 선택이 아니다. 사진 위에 글자를 얹는 순간 밝은 부분에서 글이 사라진다.
 */
function sectionBackground(m: NoticeModel, key: string): HTMLElement | null {
  const media = m.np.sectionMedia[key as NoticeBgKey];
  if (!media) return null;
  return h(
    "div",
    { class: "nt-bg", "aria-hidden": "true" },
    h("img", {
      src: transformedImageUrl(media.url, IMAGE_PRESETS.heroBackground),
      alt: "",
      loading: "lazy",
      style: focusVars(media.focus, media.mobileFocus),
    }),
  );
}

/** 섹션 껍데기 — 키커 + 제목 + 설명. 모든 섹션이 같은 머리 구조를 쓴다. */
function sectionShell(
  m: NoticeModel,
  key: string,
  head: { kicker: string; title: string; description?: string },
  ...body: (Node | null | false)[]
): HTMLElement {
  const titleId = m.sectionId(`nt-${key}-title`);
  return h(
    "section",
    {
      class: `section${m.np.sectionMedia[key as NoticeBgKey] ? " has-bg" : ""}`,
      id: m.sectionId(`nt-${key}`),
      // 사진 위 가독성 손잡이 두 개 — CSS 가 이 값으로 스크림과 카드 바탕을 계산한다.
      style: bgVars(m.np.sectionMedia[key as NoticeBgKey]),
      "data-bg": m.np.sectionBg[key as keyof typeof m.np.sectionBg],
      "aria-labelledby": titleId,
    },
    sectionBackground(m, key),
    h(
      "div",
      { class: "section-head rv" },
      head.kicker && h("span", { class: "section-kicker" }, head.kicker),
      h("h2", { class: "section-title", id: titleId }, head.title),
      head.description && h("p", { class: "section-desc" }, head.description),
    ),
    ...body,
  );
}

/** 개념 — 큰 카피 한 덩어리 + 본문. 원본의 "You're not watching K-pop." 자리. */
export function renderConcept(m: NoticeModel): HTMLElement | null {
  if (!m.show.concept) return null;
  const c = m.np.concept;
  const titleId = m.sectionId("nt-concept-title");
  return h(
    "section",
    {
      class: "section nt-concept",
      id: m.sectionId("nt-concept"),
      "data-bg": m.np.sectionBg.concept,
      "aria-labelledby": titleId,
    },
    h(
      "div",
      { class: "nt-concept-grid rv" },
      h(
        "div",
        null,
        c.kicker && h("span", { class: "section-kicker" }, c.kicker),
        h(
          "h2",
          { class: "nt-concept-headline", id: titleId },
          c.headline,
          // 강조구는 키컬러로 이어 붙인다 — 한 문장 안에서 색이 갈리는 게 원본의 인상이다.
          c.highlight && h("span", { class: "nt-concept-accent" }, ` ${c.highlight}`),
        ),
      ),
      c.body && h("div", { class: "nt-concept-body" }, c.body.split("\n\n").map((p) => h("p", null, p))),
    ),
  );
}

/** 한눈에 보기 — 라벨/값 카드. 값이 곧 사실이라 값을 크게 쓴다. */
export function renderSnapshot(m: NoticeModel): HTMLElement | null {
  if (!m.show.snapshot) return null;
  const s = m.np.snapshot;
  return sectionShell(
    m,
    "snapshot",
    { kicker: s.kicker, title: s.title },
    h(
      "div",
      { class: "nt-stats rv" },
      s.items.map((item) =>
        h(
          "div",
          { class: "nt-stat" },
          h("div", { class: "nt-stat-label" }, item.label),
          h(
            "div",
            { class: "nt-stat-value" },
            item.value,
            item.note && h("small", null, item.note),
          ),
        ),
      ),
    ),
  );
}

/** 타임라인 — 날짜 · 점 · 내용. emphasis 는 점을 키컬러로(마감·결선처럼 먼저 보여야 하는 날). */
export function renderTimeline(m: NoticeModel): HTMLElement | null {
  if (!m.show.timeline) return null;
  const t = m.np.timeline;
  return sectionShell(
    m,
    "timeline",
    { kicker: t.kicker, title: t.title, description: t.description },
    h(
      "ol",
      { class: "nt-timeline rv" },
      t.items.map((item) =>
        h(
          "li",
          { class: `nt-tl-row${item.emphasis ? " is-key" : ""}` },
          h("div", { class: "nt-tl-date" }, item.date),
          h("div", { class: "nt-tl-node" }, h("span", { class: "nt-tl-dot" })),
          h(
            "div",
            { class: "nt-tl-body" },
            h("b", null, item.title),
            item.description && h("p", null, item.description),
          ),
        ),
      ),
    ),
  );
}

/** 신청 방법 — 번호 카드 + 준비물 목록. */
export function renderApply(m: NoticeModel): HTMLElement | null {
  if (!m.show.apply) return null;
  const a = m.np.apply;
  return sectionShell(
    m,
    "apply",
    { kicker: a.kicker, title: a.title, description: a.description },
    h(
      "div",
      { class: "nt-steps rv" },
      a.items.map((step, index) =>
        h(
          "div",
          { class: "nt-step" },
          h("span", { class: "nt-step-no" }, String(index + 1).padStart(2, "0")),
          h("b", { class: "nt-step-title" }, step.title),
          step.items.length > 0 &&
            h("ul", { class: "nt-step-list" }, step.items.map((line) => h("li", null, line))),
        ),
      ),
    ),
  );
}

/** 자격 요건 — 체크 목록. 훑으면서 자기에게 해당하는 줄을 찾는 섹션이라 목록형. */
export function renderEligibility(m: NoticeModel): HTMLElement | null {
  if (!m.show.eligibility) return null;
  const e = m.np.eligibility;
  return sectionShell(
    m,
    "eligibility",
    { kicker: e.kicker, title: e.title },
    h(
      "ul",
      { class: "nt-elig rv" },
      e.items.map((text) =>
        h(
          "li",
          { class: "nt-elig-item" },
          h(
            "span",
            { class: "nt-elig-check", "aria-hidden": "true" },
            svg(
              "svg",
              { viewBox: "0 0 16 16", fill: "none" },
              svg("path", {
                d: "M3 8.5L6.2 11.5L13 4.5",
                stroke: "currentColor",
                "stroke-width": "1.8",
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
              }),
            ),
          ),
          h("span", null, text),
        ),
      ),
    ),
  );
}

/** 선발 방식 — 라운드별 반영 비율 막대. 숫자를 글로 적는 것보다 길이로 보는 게 빠르다. */
export function renderSelection(m: NoticeModel): HTMLElement | null {
  if (!m.show.selection) return null;
  const s = m.np.selection;
  return sectionShell(
    m,
    "selection",
    { kicker: s.kicker, title: s.title },
    h(
      "div",
      { class: "nt-rounds rv" },
      m.selectionRounds.map((round) =>
        h(
          "div",
          { class: "nt-round" },
          h("h3", null, round.title),
          round.note && h("p", { class: "nt-round-note" }, round.note),
          round.bars.map((bar) =>
            h(
              "div",
              { class: "nt-bar-row" },
              h(
                "div",
                { class: "nt-bar-label" },
                h("span", null, bar.label),
                h("span", null, `${bar.percent}%`),
              ),
              h(
                "div",
                { class: "nt-bar-track" },
                h("div", { class: "nt-bar-fill", style: { width: `${bar.percent}%` } }),
              ),
            ),
          ),
        ),
      ),
    ),
    s.footnote ? h("p", { class: "section-desc nt-foot rv" }, s.footnote) : null,
  );
}

/** 심사 기준 — 항목 · 설명 · 배점. 총점은 모델이 합산해 둔다. */
export function renderCriteria(m: NoticeModel): HTMLElement | null {
  if (!m.show.criteria) return null;
  const c = m.np.criteria;
  return sectionShell(
    m,
    "criteria",
    {
      kicker: c.kicker || (m.criteriaTotal > 0 ? `${m.criteriaTotal}점 만점 · ${m.criteriaItems.length}개 항목` : ""),
      title: c.title,
      description: c.description,
    },
    h(
      "div",
      { class: "nt-crit rv" },
      m.criteriaItems.map((item) =>
        h(
          "div",
          { class: "nt-crit-row" },
          h("div", { class: "nt-crit-name" }, item.name),
          h("div", { class: "nt-crit-desc" }, item.description),
          h("div", { class: "nt-crit-pts" }, `/ ${item.points}`),
        ),
      ),
    ),
  );
}

/** 상금 — 첫 카드가 자동으로 강조된다(대상). */
export function renderPrizes(m: NoticeModel): HTMLElement | null {
  if (!m.show.prizes) return null;
  const p = m.np.prizes;
  return sectionShell(
    m,
    "prizes",
    { kicker: p.kicker, title: p.title },
    h(
      "div",
      { class: "nt-prizes rv" },
      p.items.map((item, index) =>
        h(
          "div",
          { class: `nt-prize${index === 0 ? " is-top" : ""}` },
          item.rank && h("div", { class: "nt-prize-rank" }, item.rank),
          h("div", { class: "nt-prize-title" }, item.title),
          item.description && h("div", { class: "nt-prize-desc" }, item.description),
          item.amount && h("div", { class: "nt-prize-amount" }, item.amount),
        ),
      ),
    ),
  );
}

/**
 * 마감 카운트다운.
 *
 * 숫자는 여기서 채우지 않는다 — 자리만 만들고 mount 가 타이머를 건다. 서버가 렌더한 값을
 * 굳혀 두면 탭을 오래 열어 둔 방문자에게 **틀린 남은 시간**이 계속 보인다.
 */
export function renderCountdown(m: NoticeModel, onApply: () => void): HTMLElement | null {
  if (!m.show.countdown) return null;
  const c = m.np.countdown;
  const box = (key: string, label: string) =>
    h(
      "div",
      { class: "nt-cd-box" },
      h("div", { class: "nt-cd-num", "data-cd": key }, "–"),
      h("div", { class: "nt-cd-label" }, label),
    );

  return h(
    "section",
    {
      class: "section nt-final",
      id: m.sectionId("nt-countdown"),
      "data-bg": m.np.sectionBg.countdown,
      "aria-labelledby": m.sectionId("nt-countdown-title"),
    },
    h(
      "div",
      { class: "nt-final-inner rv" },
      c.kicker && h("span", { class: "section-kicker" }, c.kicker),
      h("h2", { class: "section-title", id: m.sectionId("nt-countdown-title") }, c.title),
      c.description && h("p", { class: "section-desc" }, c.description),
      h(
        "div",
        { class: "nt-countdown", "data-countdown": m.deadline ?? "" },
        box("days", m.t.cdDays),
        box("hours", m.t.cdHours),
        box("mins", m.t.cdMins),
        box("secs", m.t.cdSecs),
      ),
      m.ctaEnabled && renderPrimaryCta(m, onApply, "hero-cta nt-final-cta", c.ctaLabel.trim() || m.ctaLabel),
    ),
  );
}

/** FAQ — 껍데기의 아코디언 스타일을 그대로 쓴다(effects.attachAccordion 이 집는다). */
export function renderFaq(m: NoticeModel): HTMLElement | null {
  if (!m.show.faq) return null;
  const f = m.np.faq;
  return sectionShell(
    m,
    "faq",
    { kicker: f.kicker, title: f.title },
    h(
      "div",
      { class: "nt-faq rv" },
      f.items.map((item) =>
        h(
          "details",
          { class: "nt-faq-item" },
          h("summary", { class: "nt-faq-q" }, item.question),
          h("div", { class: "nt-faq-a" }, item.answer),
        ),
      ),
    ),
  );
}

/** 스폰서 — 최하단 로고 벽. 로고가 없으면 이름을 글자 칩으로 그린다. */
export function renderSponsors(m: NoticeModel): HTMLElement | null {
  if (!m.show.sponsors) return null;
  const s = m.np.sponsors;

  // tier 로 묶되 등장 순서를 유지한다 — 운영자가 정렬한 순서가 곧 노출 순서다.
  const groups: Array<{ tier: string; items: typeof s.items }> = [];
  for (const item of s.items) {
    const tier = item.tier.trim();
    const last = groups[groups.length - 1];
    if (last && last.tier === tier) last.items.push(item);
    else groups.push({ tier, items: [item] });
  }

  return sectionShell(
    m,
    "sponsors",
    { kicker: s.kicker, title: s.title },
    h(
      "div",
      { class: "nt-sponsors rv" },
      groups.map((group) =>
        h(
          "div",
          { class: "nt-sponsor-group" },
          group.tier && h("div", { class: "nt-sponsor-tier" }, group.tier),
          h(
            "div",
            { class: "nt-sponsor-wall" },
            group.items.map((item) => {
              const inner = item.logoUrl
                ? h("img", { src: item.logoUrl, alt: item.name, loading: "lazy" })
                : h("span", { class: "nt-sponsor-name" }, item.name);
              return item.url
                ? h(
                    "a",
                    { class: "nt-sponsor", href: item.url, target: "_blank", rel: "noopener noreferrer" },
                    inner,
                  )
                : h("div", { class: "nt-sponsor" }, inner);
            }),
          ),
        ),
      ),
    ),
  );
}
