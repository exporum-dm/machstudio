import { describe, expect, it } from "vitest";
import {
  buildKakaoText,
  dateSuffix,
  daysUntil,
  isHttpUrl,
  isStillVisible,
  toSlug,
  urlKey,
  type BriefItemLike,
} from "@/lib/brief/model";

/**
 * 카톡 텍스트는 운영자가 매주 복사해 붙이는 결과물이다.
 * 정답은 **오픈채팅에 실제로 나간 The Action 게시물**(2026-09 발행분)을 바탕으로, 운영자 요청에 따라
 * 공고 사이·카테고리 앞에 빈 줄을 넣은 모양이다(2026-09-23 — 붙어 있으면 읽기 어렵다).
 */
const kst = (iso: string) => new Date(`${iso}T00:00:00+09:00`);


const items: BriefItemLike[] = [
  {
    category: "support", org: "중소벤처기업부",
    title: "2026년 온라인수출 물류 지원사업 2차 참여기업 모집",
    url: "https://example.go.kr/a", dueDate: kst("2026-09-16"), dateLabel: "",
    shortUrl: "https://m.app/r/aB3x",
  },
  {
    category: "support", org: "울산경제일자리진흥원",
    title: "2026년 국제특송 해외물류비 지원사업 참가기업 모집 수정 공고",
    url: "https://example.kr/b", dueDate: null, dateLabel: "예산소진시까지",
    shortUrl: "https://m.app/r/Uu1q",
  },
  {
    category: "event", org: "이벤터스",
    title: "AI와 함께하는 무역서류 기초 클래스",
    url: "https://event-us.kr/c", dueDate: kst("2026-09-08"), dateLabel: "",
    shortUrl: "https://m.app/r/Kp9q",
  },
  {
    category: "news", org: "서울경제",
    title: "K게임 상반기 해외매출 6조…반년 만에 작년의 80% 채웠다",
    url: "https://www.sedaily.com/article/20083250", dueDate: null, dateLabel: "",
    shortUrl: "https://m.app/r/N3ws",
  },
];

describe("카톡 텍스트", () => {
  it("실제 발송된 The Action 과 같은 모양이다", () => {
    const text = buildKakaoText(items, {
      name: "The Action",
      intro: "이번주 바로 확인해야 할 실용 정보를 보내드립니다!",
    });
    expect(text).toBe(
      [
        "📢 [The Action]",
        "이번주 바로 확인해야 할 실용 정보를 보내드립니다!",
        "",
        "💵 지원사업",
        "[중소벤처기업부]",
        "2026년 온라인수출 물류 지원사업 2차 참여기업 모집(-9/16)",
        "https://m.app/r/aB3x",
        "",
        "[울산경제일자리진흥원]",
        "2026년 국제특송 해외물류비 지원사업 참가기업 모집 수정 공고 (예산소진시까지)",
        "https://m.app/r/Uu1q",
        "",
        "📚 웨비나 & 리포트",
        "[이벤터스]",
        "AI와 함께하는 무역서류 기초 클래스 (9/8)",
        "https://m.app/r/Kp9q",
        "",
        "🌍 산업 뉴스 & 이슈",
        "K게임 상반기 해외매출 6조…반년 만에 작년의 80% 채웠다",
        "https://m.app/r/N3ws",
      ].join("\n"),
    );
  });

  /** 뉴스는 원본 게시물에서 언론사 줄 없이 제목·링크만 나간다. */
  it("뉴스에는 [기관] 줄이 없다", () => {
    const text = buildKakaoText([items[3]], { name: "The Action", intro: "" });
    expect(text).not.toContain("[서울경제]");
  });

  it("비어 있는 카테고리는 머리줄째 빠진다", () => {
    const text = buildKakaoText([items[3]], { name: "The Action", intro: "" });
    expect(text).not.toContain("💵 지원사업");
    expect(text).not.toContain("📚 웨비나");
  });

  it("단축 주소가 없으면 원문 주소", () => {
    const text = buildKakaoText([{ ...items[0], shortUrl: null }], { name: "The Action", intro: "" });
    expect(text).toContain("https://example.go.kr/a");
  });

  it("공개 페이지 주소를 끝에 붙일 수 있다", () => {
    const text = buildKakaoText(items, { name: "The Action", intro: "", publicUrl: "https://m.app/b/the-action" });
    expect(text.trim().split("\n").pop()).toBe("👉 한눈에 보기: https://m.app/b/the-action");
  });

  /** 입력 순서가 뒤섞여도 카테고리 순서는 고정 — 받는 쪽이 매번 같은 자리에서 찾는다. */
  it("카테고리 순서는 지원사업 → 웨비나 → 뉴스로 고정", () => {
    const text = buildKakaoText([items[3], items[2], items[0]], { name: "X", intro: "" });
    const at = (s: string) => text.indexOf(s);
    expect(at("💵")).toBeLessThan(at("📚"));
    expect(at("📚")).toBeLessThan(at("🌍"));
  });
});

describe("날짜 괄호", () => {
  it("지원사업은 붙이고, 행사는 한 칸 띄운다 — 원본 게시물 그대로", () => {
    expect(dateSuffix({ category: "support", dueDate: kst("2026-10-16"), dateLabel: "" })).toBe("(-10/16)");
    expect(dateSuffix({ category: "event", dueDate: kst("2026-09-15"), dateLabel: "" })).toBe(" (9/15)");
  });

  /** 서버는 UTC 로 돈다. KST 자정 직후 마감이 하루 앞당겨 찍히면 안 된다. */
  it("KST 달력 기준으로 찍는다", () => {
    expect(dateSuffix({ category: "support", dueDate: new Date("2026-09-15T15:30:00Z"), dateLabel: "" })).toBe("(-9/16)");
  });

  it("자유 표기가 날짜를 이긴다", () => {
    expect(dateSuffix({ category: "support", dueDate: kst("2026-09-16"), dateLabel: "예산소진시까지" })).toBe(" (예산소진시까지)");
  });

  it("뉴스는 괄호가 없다", () => {
    expect(dateSuffix({ category: "news", dueDate: kst("2026-09-16"), dateLabel: "x" })).toBe("");
  });
});

describe("중복 판정 URL 키", () => {
  it("추적 파라미터·끝 슬래시·www·해시를 걷어 낸다", () => {
    expect(urlKey("https://www.Example.com/news/1/?utm_source=kakao&fbclid=x#top"))
      .toBe("https://example.com/news/1");
  });

  /** 공고 번호가 쿼리에 들어 있는 사이트가 많다 — 그걸 지우면 다른 공고가 한 줄로 합쳐진다. */
  it("공고 번호 같은 쿼리는 남긴다", () => {
    expect(urlKey("https://bizinfo.go.kr/view?pblancId=PBLN_1")).not.toBe(urlKey("https://bizinfo.go.kr/view?pblancId=PBLN_2"));
  });

  it("쿼리 순서가 달라도 같은 키", () => {
    expect(urlKey("https://a.kr/x?b=2&a=1")).toBe(urlKey("https://a.kr/x?a=1&b=2"));
  });
});

describe("공개 페이지에 남을지", () => {
  const now = kst("2026-09-22");

  it("마감이 지난 지원사업은 내린다 — 오늘 마감은 남긴다", () => {
    expect(isStillVisible({ category: "support", dueDate: kst("2026-09-21"), createdAt: now }, now)).toBe(false);
    expect(isStillVisible({ category: "support", dueDate: kst("2026-09-22"), createdAt: now }, now)).toBe(true);
  });

  it("뉴스는 30일 지나면 내린다", () => {
    expect(isStillVisible({ category: "news", dueDate: null, createdAt: kst("2026-08-01") }, now)).toBe(false);
    expect(isStillVisible({ category: "news", dueDate: null, createdAt: kst("2026-09-01") }, now)).toBe(true);
  });

  it("D-day", () => {
    expect(daysUntil(kst("2026-09-25"), now)).toBe(3);
    expect(daysUntil(kst("2026-09-22"), now)).toBe(0);
  });
});

describe("입력 검사", () => {
  /** 공개 페이지 링크로 javascript: 가 나가면 방문자 브라우저에서 실행된다. */
  it("http(s) 만 통과", () => {
    expect(isHttpUrl("https://a.kr")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,x")).toBe(false);
  });

  it("슬러그", () => {
    expect(toSlug("The Action")).toBe("the-action");
    expect(toSlug("코리아 엑스포")).toBe("");
  });
});
