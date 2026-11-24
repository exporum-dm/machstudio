import { describe, expect, it } from "vitest";
import { detectSocialAccounts, parseAccount } from "./social";

describe("parseAccount", () => {
  it("@ 를 떼고 계정만 남긴다", () => {
    expect(parseAccount("@kim.teacher119")).toEqual({ platform: null, handle: "kim.teacher119" });
  });

  it("주소를 붙여넣으면 플랫폼과 계정을 함께 읽는다", () => {
    expect(parseAccount("https://www.instagram.com/kim.teacher119/")).toEqual({ platform: "instagram", handle: "kim.teacher119" });
    expect(parseAccount("tiktok.com/@dance_kim")).toEqual({ platform: "tiktok", handle: "dance_kim" });
    expect(parseAccount("https://youtube.com/channel/UC12345")).toEqual({ platform: "youtube", handle: "UC12345" });
    expect(parseAccount("https://x.com/hoon")).toEqual({ platform: "x", handle: "hoon" });
  });

  it("문장으로 쓴 답은 계정으로 보지 않는다", () => {
    expect(parseAccount("운영 안 함")).toEqual({ platform: null, handle: "" });
    expect(parseAccount("  ")).toEqual({ platform: null, handle: "" });
  });
});

describe("detectSocialAccounts", () => {
  const labels = {
    name: "이름", phone: "연락처", email: "이메일", instagram_id: "인스타그램 계정",
    instagram_followor: "팔로워 수", target: "주 시청자 층", motivation: "지원동기",
  };

  it("칸 이름이 instagram_id 여도 인스타 계정으로 읽는다", () => {
    const answers = {
      name: "김미은", email: "kkmieun@naver.com", phone: "01040166536",
      target: "어린이집 유치원", motivation: "새로운 도전", instagram_id: "kim.teacher119",
      instagram_followor: "11950", __consent_privacy: true,
    };
    expect(detectSocialAccounts(answers, labels)).toEqual({ instagram: "kim.teacher119" });
  });

  it("팔로워 수를 계정으로 잡지 않는다", () => {
    expect(detectSocialAccounts({ instagram_followor: "11950" }, labels)).toEqual({});
  });

  it("여러 채널을 적었으면 모두 읽는다 — 링크도 채널마다 생긴다", () => {
    const answers = { sns1: "@daily.kim", sns2: "https://www.tiktok.com/@daily_kim", sns3: "https://blog.naver.com/dailykim" };
    const detected = detectSocialAccounts(answers, { sns1: "인스타그램", sns2: "틱톡 주소", sns3: "블로그" });
    expect(detected).toEqual({ instagram: "daily.kim", tiktok: "daily_kim", blog: "dailykim" });
  });

  it("라벨로만 플랫폼을 알 수 있어도 읽는다", () => {
    expect(detectSocialAccounts({ ch1: "mychannel" }, { ch1: "유튜브 채널" })).toEqual({ youtube: "mychannel" });
  });

  it("플랫폼을 짚을 수 없는 답은 계정으로 만들지 않는다", () => {
    expect(detectSocialAccounts({ name: "김미은", motivation: "도전하고싶습니다" }, labels)).toEqual({});
  });

  it("같은 플랫폼이 여러 칸에 있으면 먼저 나온 값을 쓴다", () => {
    const answers = { insta_main: "first", insta_sub: "second" };
    expect(detectSocialAccounts(answers, { insta_main: "인스타그램", insta_sub: "인스타그램 부계정" })).toEqual({ instagram: "first" });
  });
});
