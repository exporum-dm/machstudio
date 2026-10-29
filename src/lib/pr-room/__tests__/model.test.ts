import { describe, expect, it } from "vitest";
import { analyzeMention, buildPressRelease, isCollectionDue } from "../model";
import { isRelevantMention, isSimilarToExcluded, parseNaverNews, parseSocialPage, publicComments } from "../collect";

describe("홍보실 조사", () => {
  it("설정한 주기가 지난 경우에만 조사한다", () => {
    const now = new Date("2026-10-29T00:00:00Z");
    expect(isCollectionDue({ collectEveryDays: 3, lastCollectedAt: "2026-10-26T00:00:00Z" }, now)).toBe(true);
    expect(isCollectionDue({ collectEveryDays: 3, lastCollectedAt: "2026-10-27T00:00:00Z" }, now)).toBe(false);
  });
  it("부정 이슈를 보수적으로 올린다", () => expect(analyzeMention("운영 부실 논란")).toMatchObject({ sentiment: "negative", status: "issue" }));
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

it("질문 답변으로 보도자료 전체 원고를 만든다",()=>{
  const result=buildPressRelease("opening",{eventName:"코리아 엑스포 LA",datePlace:"10월 22일 LA",organizers:"엑스포럼",purpose:"한국 소비재의 미국 진출",highlights:"85개 기업 전시",audience:"바이어와 소비자",figures:"사전등록 4천 명",quote:"현지 접점을 넓히겠다",contact:"홍보팀",nextStep:"후속 상담"});
  expect(result.body).toContain("개막했다");expect(result.body).toContain("문의: 홍보팀");
});

describe("네이버 뉴스 검색",()=>{
  it("검색 결과 링크와 제목을 읽는다",()=>{
    const rows=parseNaverNews('<a href="https://news.example.com/1" data-heatmap-target=".tit"><span class="sds-comps-text sds-comps-text-type-headline1"><mark>코리아 엑스포 LA</mark> &#039;성료&#039;</span><span>새 창 열림</span></a><a href="https://news.example.com/1" data-heatmap-target=".body"><span>본문 요약</span></a>');
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({title:"코리아 엑스포 LA '성료'",source:"네이버 뉴스"});
  });
});
