import { describe, expect, it } from "vitest";
import { analyzeMention, buildPressRelease, isCollectionDue } from "../model";
import { parseNaverNews } from "../collect";

describe("홍보실 조사", () => {
  it("설정한 주기가 지난 경우에만 조사한다", () => {
    const now = new Date("2026-10-29T00:00:00Z");
    expect(isCollectionDue({ collectEveryDays: 3, lastCollectedAt: "2026-10-26T00:00:00Z" }, now)).toBe(true);
    expect(isCollectionDue({ collectEveryDays: 3, lastCollectedAt: "2026-10-27T00:00:00Z" }, now)).toBe(false);
  });
  it("부정 이슈를 보수적으로 올린다", () => expect(analyzeMention("운영 부실 논란")).toMatchObject({ sentiment: "negative", status: "issue" }));
});

it("질문 답변으로 보도자료 전체 원고를 만든다",()=>{
  const result=buildPressRelease("opening",{eventName:"코리아 엑스포 LA",datePlace:"10월 22일 LA",organizers:"엑스포럼",purpose:"한국 소비재의 미국 진출",highlights:"85개 기업 전시",audience:"바이어와 소비자",figures:"사전등록 4천 명",quote:"현지 접점을 넓히겠다",contact:"홍보팀",nextStep:"후속 상담"});
  expect(result.body).toContain("개막했다");expect(result.body).toContain("문의: 홍보팀");
});

describe("네이버 뉴스 검색",()=>{
  it("검색 결과 링크와 제목을 읽는다",()=>{
    const rows=parseNaverNews('<a href="https://news.example.com/1"><b>코리아 엑스포 LA</b> 성료 보도자료 새 창 열림</a>');
    expect(rows[0]).toMatchObject({title:"코리아 엑스포 LA 성료 보도자료",source:"네이버 뉴스"});
  });
});
