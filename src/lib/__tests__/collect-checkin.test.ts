import { describe, expect, it } from "vitest";
import {
  SAME_CODE_COOLDOWN_MS,
  checkinSlugError,
  normalizeCheckinSlug,
  eventDateIn,
  judgeScan,
  normalizeCheckinTimezone,
  normalizeMethod,
  normalizePin,
  isValidPin,
  pickCompany,
  resultDisplayMs,
  shouldSubmitScan,
  timeIn,
  type ScanPerson,
} from "@/lib/collect-checkin";
import { normalizeCollectForm } from "@/lib/collect-form-config";

describe("행사 시간대 기준 날짜", () => {
  /** LA 전시를 서울 시간으로 자르면 하루가 밀린다 — 현지 저녁 입장이 "다음 날" 로 집계되는 사고. */
  it("같은 순간도 시간대마다 날짜가 다르다", () => {
    const at = new Date("2026-10-22T05:30:00Z"); // LA 10/21 22:30, 서울 10/22 14:30
    expect(eventDateIn("America/Los_Angeles", at)).toBe("2026-10-21");
    expect(eventDateIn("Asia/Seoul", at)).toBe("2026-10-22");
  });

  it("모르는 시간대는 서울로", () => {
    expect(normalizeCheckinTimezone("Mars/Base")).toBe("Asia/Seoul");
    expect(eventDateIn("Mars/Base", new Date("2026-10-22T16:00:00Z"))).toBe("2026-10-23");
  });

  it("시각 표시도 그 시간대로", () => {
    expect(timeIn("America/Los_Angeles", "2026-10-22T17:12:00Z")).toMatch(/10:12/);
  });
});

describe("운영요원 링크 주소(직접 정하기)", () => {
  it("입력 시점에 정규화 — 소문자, 공백·밑줄은 하이픈, 나머지 글자는 버린다", () => {
    expect(normalizeCheckinSlug(" LA 2026_Gate A ")).toBe("la-2026-gate-a");
    expect(normalizeCheckinSlug("코리아엑스포la2026!")).toBe("la2026");
    expect(normalizeCheckinSlug("a--b")).toBe("a-b");
  });

  it("4자 미만·하이픈으로 시작/끝은 막는다", () => {
    expect(checkinSlugError("la")).not.toBe("");
    expect(checkinSlugError("-la2026")).not.toBe("");
    expect(checkinSlugError("la2026-")).not.toBe("");
    expect(checkinSlugError("la2026")).toBe("");
  });
});

describe("PIN·입력 정규화", () => {
  it("숫자만 4자리까지", () => {
    expect(normalizePin("12-34 56")).toBe("1234");
    expect(normalizePin(1234)).toBe("");
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("123")).toBe(false);
  });

  it("모르는 입력 방식은 카메라로", () => {
    expect(normalizeMethod("scanner")).toBe("scanner");
    expect(normalizeMethod("telepathy")).toBe("camera");
  });
});

describe("재스캔 판정 — 막지 않고 알린다", () => {
  const person: ScanPerson = { registrationNo: "1234567890128", name: "Jane Kim", visitorType: "General", company: "", extras: [] };
  const t = (iso: string) => new Date(iso);

  it("오늘 첫 스캔이면 first", () => {
    const now = t("2026-10-22T17:00:00Z");
    expect(judgeScan(person, [now], now)).toMatchObject({ status: "first", todayCount: 1, firstAtToday: now.toISOString() });
  });

  it("이미 있었으면 repeat — 몇 번째인지, 첫 입장 시각과 함께", () => {
    const first = t("2026-10-22T17:00:00Z");
    const now = t("2026-10-22T19:30:00Z");
    expect(judgeScan(person, [first, now], now)).toMatchObject({ status: "repeat", todayCount: 2, firstAtToday: first.toISOString() });
  });
});

describe("판정 카드 표시 시간", () => {
  /** 현장 피드백: 카드가 계속 떠 있으면 다음 사람 QR 을 비출 수 없다 — 1~2초 뒤 사라져야 한다. */
  it("카메라 스캔은 1.5~2초", () => {
    expect(resultDisplayMs("first", true)).toBe(1500);
    expect(resultDisplayMs("repeat", true)).toBe(2000);
    expect(resultDisplayMs("not_found", true)).toBe(2000);
  });

  it("카메라를 끈 직접 입력은 조금 더 길게", () => {
    expect(resultDisplayMs("first", false)).toBe(4000);
  });
});

describe("카메라 연속 인식 걸러내기", () => {
  /** QR 을 카메라 앞에 들고 있으면 1초에 여러 번 읽힌다 — 그대로 보내면 스캔 수가 부풀어 오른다. */
  it("같은 코드는 쿨다운 안에서 한 번만", () => {
    const last = { code: "1234567890128", at: 1000 };
    expect(shouldSubmitScan("1234567890128", last, 1000 + SAME_CODE_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldSubmitScan("1234567890128", last, 1000 + SAME_CODE_COOLDOWN_MS + 1)).toBe(true);
  });

  it("다른 코드는 바로", () => {
    expect(shouldSubmitScan("9999999999999", { code: "1234567890128", at: 1000 }, 1100)).toBe(true);
    expect(shouldSubmitScan("", null, 0)).toBe(false);
  });
});

describe("회사 칸 찾기", () => {
  it("회사·소속 같은 칸이 있으면 그 값, 없으면 빈 문자열", () => {
    const withCompany = normalizeCollectForm({
      fields: [
        { key: "first_name", type: "text", label: { en: "First name" } },
        { key: "company_name", type: "text", label: { en: "Company" } },
      ],
    });
    expect(pickCompany(withCompany, { company_name: " ACME Inc. " })).toBe("ACME Inc.");

    const consumer = normalizeCollectForm({ fields: [{ key: "first_name", type: "text", label: { en: "First name" } }] });
    expect(pickCompany(consumer, { first_name: "Jane" })).toBe("");
  });

  it("한국어 라벨도 알아본다", () => {
    const ko = normalizeCollectForm({ fields: [{ key: "f3", type: "text", label: { ko: "소속" } }] });
    expect(pickCompany(ko, { f3: "코리아엑스포" })).toBe("코리아엑스포");
  });
});
