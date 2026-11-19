// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseDraftResponse, type DraftRequestItem } from "@/lib/translation-draft";

/**
 * **모델 응답을 칸에 꽂는 규칙.**
 *
 * 이 기능에서 가장 비싼 실패는 "번역이 엉뚱한 칸에 들어가는 것" 이다. 제목 자리에 FAQ 답이
 * 들어가 있어도 그 언어를 모르는 운영자는 알아볼 수 없고, 방문자가 제보할 때까지 간다.
 * 그래서 모델에 id 를 함께 적게 하고, **돌아온 id 가 보낸 것과 다르면 버린다** —
 * 칸이 비는 쪽은 진행률이 알려 주지만, 잘못 채워진 칸은 아무도 모른다.
 */

const SENT: DraftRequestItem[] = [
  { id: "brand", context: "브랜드 라벨", base: "코리아 엑스포" },
  { id: "cta", context: "주 버튼 문구", base: "사전 등록하기" },
  { id: "faq:0:answer", context: "비용 · 답", base: "무료입니다." },
];

const wrap = (items: unknown) => JSON.stringify({ items });

describe("정상 응답", () => {
  it("보낸 id 에 맞춰 꽂는다", () => {
    const out = parseDraftResponse(
      wrap([
        { id: "brand", text: "Korea Expo" },
        { id: "cta", text: "Register now" },
        { id: "faq:0:answer", text: "It's free." },
      ]),
      SENT,
    );
    expect(out).toEqual([
      { id: "brand", text: "Korea Expo" },
      { id: "cta", text: "Register now" },
      { id: "faq:0:answer", text: "It's free." },
    ]);
  });

  /** 모델이 설명을 앞뒤에 붙이는 일이 흔하다 — 첫 { 부터 마지막 } 까지만 읽는다. */
  it("앞뒤 군더더기를 걷어낸다", () => {
    const text = 'Here you go:\n```json\n' + wrap([{ id: "brand", text: "Korea Expo" }]) + "\n```\nLet me know!";
    expect(parseDraftResponse(text, SENT)).toEqual([{ id: "brand", text: "Korea Expo" }]);
  });

  it("줄바꿈을 보존한다 — 2줄 원문은 2줄로 돌아와야 한다", () => {
    const out = parseDraftResponse(wrap([{ id: "brand", text: "Korea\nExpo" }]), SENT);
    expect(out[0].text).toBe("Korea\nExpo");
  });
});

describe("어긋난 응답은 버린다 — 칸이 비는 쪽이 잘못 채워지는 쪽보다 낫다", () => {
  /** 지어낸 id 는 꽂을 자리가 없다. */
  it("보내지 않은 id 는 무시한다", () => {
    const out = parseDraftResponse(
      wrap([
        { id: "brand", text: "Korea Expo" },
        { id: "made-up", text: "???" },
      ]),
      SENT,
    );
    expect(out).toEqual([{ id: "brand", text: "Korea Expo" }]);
  });

  /**
   * **칸을 빼먹어도 나머지가 밀리지 않는다.** 순서가 아니라 id 로 꽂기 때문이다 —
   * 인덱스로 짝지었다면 여기서 cta 자리에 FAQ 답이 들어갔다.
   */
  it("중간을 빼먹어도 남은 칸은 제자리에 간다", () => {
    const out = parseDraftResponse(
      wrap([
        { id: "brand", text: "Korea Expo" },
        { id: "faq:0:answer", text: "It's free." },
      ]),
      SENT,
    );
    expect(out.find((i) => i.id === "faq:0:answer")?.text).toBe("It's free.");
    expect(out.find((i) => i.id === "cta")).toBeUndefined();
  });

  it("같은 id 가 두 번 오면 첫 것만 쓴다", () => {
    const out = parseDraftResponse(
      wrap([
        { id: "brand", text: "Korea Expo" },
        { id: "brand", text: "KOREA EXPO" },
      ]),
      SENT,
    );
    expect(out).toEqual([{ id: "brand", text: "Korea Expo" }]);
  });

  /** 빈 번역은 초안이 아니다 — 칸을 비워 두면 진행률이 그 사실을 알려 준다. */
  it("빈 번역은 버린다", () => {
    const out = parseDraftResponse(
      wrap([
        { id: "brand", text: "" },
        { id: "cta", text: "   " },
        { id: "faq:0:answer", text: "It's free." },
      ]),
      SENT,
    );
    expect(out).toEqual([{ id: "faq:0:answer", text: "It's free." }]);
  });

  it("모양이 깨진 응답은 통째로 빈 결과", () => {
    for (const bad of [
      "",
      "죄송해요, 번역할 수 없습니다.",
      "{ not json",
      JSON.stringify({ items: "nope" }),
      JSON.stringify({ rows: [{ id: "brand", text: "Korea Expo" }] }),
      wrap([null, 3, "x"]),
      wrap([{ id: 7, text: "Korea Expo" }]),
      wrap([{ id: "brand", text: 7 }]),
    ]) {
      expect(parseDraftResponse(bad, SENT)).toEqual([]);
    }
  });
});
