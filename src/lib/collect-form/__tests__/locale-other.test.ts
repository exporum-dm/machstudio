// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountCollectForm } from "../mount";
import { mergeFormConfigUpdate, normalizeCollectForm, validateSubmission } from "@/lib/collect-form-config";

/**
 * 2026-11-03 사전등록 피드백:
 *  · 기본 문구가 영어뿐 — "기본 정보 › 폼 언어"로 한국어를 고른다
 *  · 기타(직접 입력) · 복수 선택 최대 개수
 *  · "사전등록 마감 후 안내"에 적은 문구가 미리보기에서 안 보였다
 */

let host: HTMLDivElement;
let handle: { destroy(): void } | null = null;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); });
afterEach(() => { handle?.destroy(); handle = null; host.remove(); document.getElementById("msf-css")?.remove(); });

const mount = (raw: Record<string, unknown>, extra: Partial<Parameters<typeof mountCollectForm>[0]> = {}) => {
  handle = mountCollectForm({ mount: host, config: normalizeCollectForm(raw), origin: "", sourceId: "s1", preview: true, ...extra });
};
const text = () => host.textContent ?? "";
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe("폼 언어", () => {
  it("한국어면 기본 문구가 한국어", () => {
    mount({ defaultLocale: "ko", fields: [{ id: "f1", key: "name", label: { en: "이름" }, type: "text", enabled: true }] });
    expect(text()).toContain("등록하기");
    expect(text()).toContain("미리보기 — 저장되지 않아요");
    expect(text()).not.toContain("Register");
  });
  it("영어(기존 폼)는 그대로", () => {
    mount({ fields: [{ id: "f1", key: "name", label: { en: "Name" }, type: "text", enabled: true }] });
    expect(text()).toContain("Register");
  });
  it("언어는 기본 정보만 바꾼다 — 빌더 자동저장의 낡은 값이 되돌리지 않는다", () => {
    const db = { defaultLocale: "ko", fields: [] };
    expect(mergeFormConfigUpdate(db, { defaultLocale: "en", fields: [] }, undefined).defaultLocale).toBe("ko");
    expect(mergeFormConfigUpdate(db, undefined, undefined, "en")!.defaultLocale).toBe("en");
    expect(mergeFormConfigUpdate(db, undefined, undefined, "ja")!.defaultLocale).toBe("ja");
    expect(mergeFormConfigUpdate(db, undefined, undefined, "de")!.defaultLocale).toBe("ko");
  });
  it.each([["fr", "S'inscrire", "Autre"], ["ja", "登録する", "その他"]])("%s 도 기본 문구가 그 언어", (locale, submit, other) => {
    mount({ defaultLocale: locale, fields: [{ id: "f1", key: "job", label: { en: "Job" }, type: "radio", enabled: true, allowOther: true, options: [{ en: "A" }] }] });
    expect(text()).toContain(submit);
    expect(text()).toContain(other);
    expect(text()).not.toContain("Register");
  });
});

describe("기타(직접 입력)", () => {
  const radio = { id: "f1", key: "route", label: { en: "알게 된 경로" }, type: "radio", enabled: true, required: true, allowOther: true, options: [{ en: "SNS" }, { en: "지인" }] };

  it("라디오에서 기타를 고르면 입력칸이 열리고, 적은 글자가 값이 된다", () => {
    mount({ defaultLocale: "ko", fields: [radio] });
    const otherRadio = host.querySelector('input[value="__msf_other__"]') as HTMLInputElement;
    expect(otherRadio).toBeTruthy();
    const input = host.querySelector(".msf-other-input") as HTMLInputElement;
    expect(input.hidden).toBe(true);
    otherRadio.checked = true;
    fire(otherRadio, "change");
    expect(input.hidden).toBe(false);
    input.value = "유튜브 광고";
    fire(input, "input");
    // 선택지에 없는 값이어도 기타를 켠 항목이면 통과한다(서버와 같은 검증)
    const config = normalizeCollectForm({ fields: [radio] });
    const deps = { isValidEmail: () => true, isValidPhone: () => true, countryFor: () => "KR", consent: {} } as unknown as Parameters<typeof validateSubmission>[2];
    expect(validateSubmission(config, { route: "유튜브 광고" }, deps).filter((i) => i.key === "route")).toEqual([]);
    // 다른 선택지를 고르면 입력칸이 닫힌다
    const sns = host.querySelector('input[value="SNS"]') as HTMLInputElement;
    sns.checked = true;
    fire(sns, "change");
    expect(input.hidden).toBe(true);
  });

  it("복수 선택 — 기타도 최대 개수에 센다, 안내는 언어대로", () => {
    mount({ defaultLocale: "ko", fields: [{ id: "f2", key: "interest", label: { en: "관심 분야" }, type: "multiple", enabled: true, allowOther: true, maxSelect: 2, options: [{ en: "뷰티" }, { en: "푸드" }, { en: "패션" }] }] });
    expect(text()).toContain("최대 2개까지 선택할 수 있어요");
    const boxes = [...host.querySelectorAll('.msf-chip input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(4); // 3 + 기타
    boxes[0].checked = true; fire(boxes[0], "change");
    boxes[3].checked = true; fire(boxes[3], "change"); // 기타 — 글자 없이도 1개로 센다
    expect(boxes[1].disabled).toBe(true);
    expect(boxes[2].disabled).toBe(true);
  });

  it("드롭다운 — 기타를 고르면 입력칸", () => {
    mount({ fields: [{ id: "f3", key: "job", label: { en: "Job" }, type: "select", enabled: true, allowOther: true, options: [{ en: "Designer" }] }] });
    const sel = host.querySelector("select") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toContain("Other");
    sel.value = "__msf_other__";
    fire(sel, "change");
    expect((host.querySelector(".msf-other-input") as HTMLInputElement).hidden).toBe(false);
  });

  it("최대 개수는 기타까지 센 선택지 수보다 작아야 저장된다", () => {
    const base = { id: "f", key: "k", label: { en: "K" }, type: "multiple", enabled: true, options: [{ en: "a" }, { en: "b" }, { en: "c" }] };
    expect(normalizeCollectForm({ fields: [{ ...base, maxSelect: 3 }] }).fields[0].maxSelect).toBeUndefined();
    expect(normalizeCollectForm({ fields: [{ ...base, maxSelect: 3, allowOther: true }] }).fields[0].maxSelect).toBe(3);
  });
});

describe("마감 안내", () => {
  const schedule = {
    enabled: true, timezone: "Asia/Seoul", preOpensAt: null, preClosesAt: "2026-01-01T00:00",
    onsite: [{ date: "2026-03-26", open: "10:00", close: "18:00" }],
    betweenTitle: { en: "사전등록이 끝났어요" }, betweenBody: { en: "현장등록은 {next}부터예요" },
    closedTitle: { en: "올해 등록은 끝났어요" }, closedBody: { en: "내년에 만나요" },
  };
  it("미리보기 '사전 마감'에 적은 문구가 나온다 — 현장등록이 지났어도 첫 현장등록 시각을 예로", () => {
    mount({ defaultLocale: "ko", fields: [], schedule }, { forceStatus: "closed", forcePhase: "between" });
    expect(text()).toContain("사전등록이 끝났어요");
    expect(text()).toContain("현장등록은");
    expect(text()).not.toContain("{next}");
  });
  it("'마감'은 등록 종료 안내 — 적은 문구가 먼저", () => {
    mount({ defaultLocale: "ko", fields: [], schedule }, { forceStatus: "closed" });
    expect(text()).toContain("올해 등록은 끝났어요");
    expect(text()).toContain("내년에 만나요");
  });
  it("비우면 언어에 맞는 기본 문구", () => {
    mount({ defaultLocale: "ko", fields: [] }, { forceStatus: "closed" });
    expect(text()).toContain("등록이 마감됐어요");
  });
});
