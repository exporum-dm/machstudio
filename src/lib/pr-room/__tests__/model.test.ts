import { describe, expect, it } from "vitest";
import { analyzeMention, buildClaudeResearchPrompt, buildPressReleasePrompt, isOwnChannel, parseClaudeResearch } from "../model";
import { dedupeByTitle, extractPublishedDate, isRelevantMention, isSimilarToExcluded, isUnresolvedGoogleNews, parseNaverNews, parseSocialPage, publicComments } from "../collect";

describe("홍보실 조사", () => {
  it("부정 이슈를 보수적으로 올린다", () => expect(analyzeMention("운영 부실 논란")).toMatchObject({ sentiment: "negative", status: "issue" }));
});

it("Claude 조사문과 결과 가져오기를 왕복한다", () => {
  expect(buildClaudeResearchPrompt({ eventNames: ["코리아 엑스포 LA"], lastCollectedAt: null })).toContain("코리아 엑스포 LA");
  expect(parseClaudeResearch('```json\n[{"title":"행사 개막","url":"https://example.com/post","source":"Example","channel":"press","publishedAt":"2026-10-30"}]\n```')).toMatchObject([{ title: "행사 개막", url: "https://example.com/post", channel: "press" }]);
});

it("Claude의 느슨한 JSON, 설명이 붙은 코드 블록과 결과 객체를 읽는다", () => {
  const item = "{title: '행사 개막', url: 'https://example.com/post', source: 'Example',}";
  expect(parseClaudeResearch(`[${item},]`)).toHaveLength(1);
  expect(parseClaudeResearch(`조사 결과입니다.\n\`\`\`json\n[${item}]\n\`\`\`\n이상입니다.`)).toHaveLength(1);
  expect(parseClaudeResearch(`{results: [${item}]}`)).toHaveLength(1);
  expect(parseClaudeResearch(item)).toHaveLength(1);
  expect(() => parseClaudeResearch('[{"title":')).toThrow("내용이 잘렸다면");
  expect(() => parseClaudeResearch('[{"title":"제목"}]')).toThrow("source");
});

it("Claude 조사는 마지막 수집일 이전 누락 자료와 여러 채널도 찾는다", () => {
  const prompt = buildClaudeResearchPrompt({ eventNames: ["Korea Expo LA"], lastCollectedAt: "2026-10-30T00:00:00Z" });
  expect(prompt).toContain("이전에 놓친 자료도 포함");
  expect(prompt).toContain("50건 이상");
  expect(prompt).toContain("참가사·참관객");
});

it("Claude 조사는 우리 채널·행사 등록 플랫폼은 제외하라고 안내한다", () => {
  const prompt = buildClaudeResearchPrompt({ eventNames: ["Korea Expo LA"], lastCollectedAt: null, ownChannels: ["https://en.k-expo.org", "https://instagram.com/koreaexpo_official"] });
  expect(prompt).toContain("en.k-expo.org");
  expect(prompt).toContain("instagram.com/koreaexpo_official");
  expect(prompt).toContain("제3자");
  expect(prompt).toContain("Eventbrite");
});

it("인스타 반응 수치를 읽는다",()=>{
  expect(parseSocialPage("https://www.instagram.com/p/ABC123/",'<meta property="og:description" content="99 likes, 3 comments - koreaexpo_global on October 25, 2026: &quot;Korea Expo LA highlights&quot;.">')).toMatchObject({author:"koreaexpo_global",metrics:{likes:99,comments:3}});
});

it("공개 댓글을 작성자와 좋아요 수까지 읽는다",()=>{
  expect(publicComments('{"text":"Great event!","username":"visitor","comment_like_count":4}')).toEqual([{text:"Great event!",author:"visitor",likes:4}]);
});

it("행사명이 없는 비슷한 축제 결과는 제외한다",()=>{
  const queries=["코리아 엑스포 LA","Korea Expo LA","Korea Expo"];
  expect(isRelevantMention("Korea Expo LA 2026 Day 2",queries)).toBe(true);
  expect(isRelevantMention("Food and Art Festival 2026 Suncheon",queries)).toBe(false);
});

it("제외한 오탐과 주제가 비슷한 새 결과도 제외한다",()=>{
  const rules=[{title:"순천 푸드앤아트 페스티벌 무료 체험",excerpt:"순천만 국가정원 축제",source:"TikTok",channel:"sns" as const}];
  expect(isSimilarToExcluded({title:"순천 푸드앤아트 페스티벌 프로그램 안내",excerpt:"순천만 국가정원에서 진행",channel:"sns"},rules,["코리아 엑스포 LA"])).toBe(true);
  expect(isSimilarToExcluded({title:"코리아 엑스포 LA K뷰티 개막",excerpt:"미국 바이어 상담",channel:"sns"},rules,["코리아 엑스포 LA"])).toBe(false);
});

it("질문 답변과 참고 보도자료로 Claude에 보낼 프롬프트를 만든다",()=>{
  const prompt=buildPressReleasePrompt({type:"opening",answers:{eventName:"코리아 엑스포 LA",datePlace:"10월 22일 LA",organizers:"엑스포럼",purpose:"한국 소비재의 미국 진출",highlights:"85개 기업 전시",audience:"바이어와 소비자",figures:"사전등록 4천 명",quote:"현지 접점을 넓히겠다",contact:"홍보팀",nextStep:"후속 상담"},references:[{id:"r1",type:"archived",title:"과거 보도자료",body:"과거 보도자료 본문",updatedAt:"2026-01-01T00:00:00Z",sourceOutlet:"동아일보"}]});
  expect(prompt).toContain("코리아 엑스포 LA");
  expect(prompt).toContain("문의처: 홍보팀");
  expect(prompt).toContain("동아일보");
  expect(prompt).toContain("과거 보도자료 본문");
});

it("참고 보도자료가 없으면 일반 형식을 따르라고 안내한다",()=>{
  const prompt=buildPressReleasePrompt({type:"advance",answers:{eventName:"행사",datePlace:"장소",organizers:"주최",purpose:"목적",highlights:"",audience:"",figures:"",quote:"",contact:"",nextStep:""},references:[]});
  expect(prompt).toContain("일반적인 국문 보도자료 형식");
});

it("Google 뉴스 리다이렉트가 안 풀린 URL을 알아본다",()=>{
  expect(isUnresolvedGoogleNews("https://news.google.com/rss/articles/CBMi...")).toBe(true);
  expect(isUnresolvedGoogleNews("https://www.donga.com/news/Economy/article/1")).toBe(false);
});

it("같은 제목(문장부호만 다름)의 글이 여러 URL로 들어오면 더 정보가 많은 쪽만 남긴다",()=>{
  const base = { source: "", channel: "press" as const, publishedAt: null };
  const rows = [
    { ...base, title: "'2026 코리아 엑스포 LA' 개막", url: "https://news.google.com/rss/articles/a", excerpt: "" },
    { ...base, title: "‘2026 코리아 엑스포 LA’ 개막", url: "https://www.donga.com/news/1", excerpt: "본문 요약이 있는 쪽" },
  ];
  const result = dedupeByTitle(rows);
  expect(result).toHaveLength(1);
  expect(result[0].url).toBe("https://www.donga.com/news/1");
});

it("우리 채널 목록에 있는 URL(그 하위 글 포함)은 걸러낸다",()=>{
  const own = ["https://en.k-expo.org", "https://www.instagram.com/koreaexpo_official"];
  expect(isOwnChannel("https://en.k-expo.org/overview", own)).toBe(true);
  expect(isOwnChannel("https://instagram.com/koreaexpo_official", own)).toBe(true);
  expect(isOwnChannel("https://instagram.com/koreaexpo_official/p/123", own)).toBe(true);
  // 경계 확인 — 비슷한 남의 계정·도메인은 안 걸려야 한다
  expect(isOwnChannel("https://instagram.com/koreaexpo_official_fan", own)).toBe(false);
  expect(isOwnChannel("https://en.k-expo.org.evil.com/", own)).toBe(false);
  expect(isOwnChannel("https://www.donga.com/news/1", own)).toBe(false);
});

it("Claude 조사가 놓친 원문 일자를 메타 태그·JSON-LD 에서 찾아낸다",()=>{
  expect(extractPublishedDate('<meta property="article:published_time" content="2026-10-25T09:00:00+09:00">')?.toISOString().slice(0,10)).toBe("2026-10-25");
  expect(extractPublishedDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-23T00:00:00Z"}</script>')?.toISOString().slice(0,10)).toBe("2026-10-23");
  expect(extractPublishedDate("<html><body>아무 날짜도 없음</body></html>")).toBeNull();
});

it("제목이 다른 글은 합치지 않는다",()=>{
  const base = { source: "", channel: "press" as const, publishedAt: null, excerpt: "" };
  const rows = [
    { ...base, title: "코리아 엑스포 LA 개막", url: "https://a.example.com/1" },
    { ...base, title: "코리아 엑스포 LA 폐막", url: "https://b.example.com/2" },
  ];
  expect(dedupeByTitle(rows)).toHaveLength(2);
});

describe("네이버 뉴스 검색",()=>{
  it("검색 결과 링크와 제목을 읽는다",()=>{
    const rows=parseNaverNews('<a href="https://news.example.com/1" data-heatmap-target=".tit"><span class="sds-comps-text sds-comps-text-type-headline1"><mark>코리아 엑스포 LA</mark> &#039;성료&#039;</span><span>새 창 열림</span></a><a href="https://news.example.com/1" data-heatmap-target=".body"><span>본문 요약</span></a>');
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({title:"코리아 엑스포 LA '성료'",source:"네이버 뉴스"});
  });
});
