// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCollectForm } from "../mount";
import { normalizeCollectForm } from "@/lib/collect-form-config";
import { isValidRegistrationNo } from "@/lib/collect-registration-no";

/**
 * 등록 폼 런타임 — **임베드·미리보기·빌더 옆칸이 전부 이 함수를 탄다.**
 * 그래서 여기서 깨지면 세 화면이 같이 깨지고, 여기서 통과하면 셋 다 같은 동작이다.
 */

const CONFIG = normalizeCollectForm({
  fields: [
    { id: "f1", key: "email", label: { en: "Email" }, type: "email", required: true, enabled: true },
    { id: "f2", key: "phone", label: { en: "Phone" }, type: "tel", enabled: true },
    {
      id: "f3", key: "type", label: { en: "Visitor type" }, type: "select", enabled: true,
      options: [{ en: "General" }, { en: "Buyer" }],
    },
    { id: "f4", key: "hidden_one", label: { en: "Hidden" }, type: "text", enabled: false },
  ],
  branch: {
    enabled: true, fieldKey: "type",
    groups: [{ value: "Buyer", fields: [{ id: "b1", key: "company", label: { en: "Company" }, type: "text", required: true, enabled: true }] }],
  },
  notices: [{ id: "portrait", enabled: true, placement: "above-consent", mode: "notice", body: { en: "첫 줄\n둘째 줄" } }],
  consent: { privacy: { enabled: true, label: { en: "Privacy" } } },
});

let host: HTMLDivElement;
let handle: { destroy(): void } | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  handle?.destroy();
  handle = null;
  host.remove();
  document.getElementById("msf-css")?.remove();
  document.querySelectorAll(".msf-overlay").forEach((el) => el.remove());
  delete (window as { dataLayer?: unknown[] }).dataLayer;
  vi.restoreAllMocks();
});

function mount(extra: Partial<Parameters<typeof mountCollectForm>[0]> = {}) {
  handle = mountCollectForm({ mount: host, config: CONFIG, origin: "", sourceId: "src1", preview: true, ...extra });
  return handle;
}
const text = () => host.textContent ?? "";
const submitBtn = () => [...host.querySelectorAll("button")].find((b) => b.className.includes("msf-submit")) as HTMLButtonElement;
const labels = () => [...host.querySelectorAll(".msf-label")].map((l) => l.textContent ?? "");

describe("등록 폼 렌더", () => {
  it("domestic tabs match canonical group values even when translated labels differ", () => {
    const config=normalizeCollectForm({...CONFIG,builderVariant:"domestic",defaultLocale:"ko",fields:CONFIG.fields.map(f=>f.key==="type"?{...f,options:[{en:"General",ko:"일반"},{en:"Buyer",ko:"바이어"}]}:f)});
    mount({config,forceType:"바이어"});
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("바이어");
    expect(labels().join("|")).toContain("Company");
    (host.querySelector('[role="tab"]') as HTMLButtonElement).click();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("일반");
    expect(labels().join("|")).not.toContain("Company");
  });
  it("domestic tabs preselect linked types, hide the duplicate type field, and preserve shared answers", () => {
    mount({config:normalizeCollectForm({...CONFIG,builderVariant:"domestic"}),forceType:"Buyer"});
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Buyer");
    expect(host.querySelector('select[data-msf-key="type"]')).toBeNull();
    expect(labels().join("|")).toContain("Company");
    const email=host.querySelector<HTMLInputElement>('[data-msf-key="email"]')!;
    email.value="test@example.com"; email.dispatchEvent(new Event("input",{bubbles:true}));
    (host.querySelector('[role="tab"]') as HTMLButtonElement).click();
    expect(labels().join("|")).not.toContain("Company");
    expect(host.querySelector<HTMLInputElement>('[data-msf-key="email"]')?.value).toBe("test@example.com");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("General");
  });
  it("표시 꺼진 항목은 그리지 않는다", () => {
    mount();
    expect(text()).toContain("Email");
    expect(text()).not.toContain("Hidden");
  });

  it("유형을 고르면 분기 문항이 기준 항목 바로 아래에 삽입된다 — 화면 순서 = 검증 순서(§4)", () => {
    mount();
    expect(labels().join("|")).not.toContain("Company");

    const sel = host.querySelector<HTMLSelectElement>("select[data-msf-key]")!;
    sel.value = "Buyer";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    const order = labels().map((l) => l.replace("*", ""));
    expect(order).toEqual(["Email", "Phone", "Visitor type", "Company"]);
  });

  it("라디오는 선택지를 바로 펼쳐 보이고 한 번의 선택으로 분기한다", () => {
    const radioConfig = normalizeCollectForm({
      fields: [{
        id: "type", key: "type", label: { en: "Visitor type" }, type: "radio", required: true, enabled: true,
        options: [{ en: "General" }, { en: "Buyer" }, { en: "Press" }],
      }],
      branch: {
        enabled: true,
        fieldKey: "type",
        groups: [{ value: "Buyer", fields: [{ id: "company", key: "company", label: { en: "Company" }, type: "text", enabled: true }] }],
      },
    });
    mount({ config: radioConfig });

    const radios = [...host.querySelectorAll<HTMLInputElement>('.msf-radio-group input[type="radio"]')];
    expect(radios.map((radio) => radio.value)).toEqual(["General", "Buyer", "Press"]);
    expect(labels()).not.toContain("Company");

    const buyer = radios.find((radio) => radio.value === "Buyer")!;
    buyer.checked = true;
    buyer.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labels().map((label) => label.replace("*", ""))).toEqual(["Visitor type", "Company"]);
    expect(host.querySelector<HTMLInputElement>('.msf-radio-group input[value="Buyer"]')?.checked).toBe(true);
  });

  it("접수 창 밖이면 폼 대신 상태 화면 — 마감 화면을 미리 볼 수 있어야 한다", () => {
    mount({ forceStatus: "closed" });
    expect(text()).toContain("closed");
    expect(host.querySelector("select[data-msf-key]")).toBeNull();

    handle?.destroy();
    mount({ forceStatus: "before" });
    expect(text()).toContain("hasn't opened");
  });

  /** AGENTS.md 공통: 사용자 텍스트는 줄바꿈을 보존한다. */
  it("안내 본문은 줄바꿈을 보존한다", () => {
    mount();
    const el = [...host.querySelectorAll(".msf-notice-body")].find((p) => p.textContent?.includes("첫 줄"));
    expect(el).toBeTruthy();
    expect(getComputedStyle(el as Element).whiteSpace).toBe("pre-wrap");
  });

  it("항목이 없으면 빈 상태를 알린다 — 빈 화면은 고장으로 보인다", () => {
    mount({ config: normalizeCollectForm({}) });
    expect(text()).toContain("no fields");
  });

  /** 설계 §16.1 — 유형을 지정한 채로 열 수 있어야 검토자가 그 화면을 본다. */
  it("forceType 을 주면 그 유형 문항이 펼쳐진 채로 열린다", () => {
    mount({ forceType: "Buyer" });
    expect(labels().join("|")).toContain("Company");
  });
});

/**
 * 기간·장소·운영시간 개요 표 — 아임웹에 따로 만들던 걸 이 안에서 대신한다는 요청으로 추가.
 * "config 토글 ON + 실제 데이터 있음" 이중 게이트를 여기서도 확인한다.
 */
describe("행사 개요 표", () => {
  const withEventInfo = normalizeCollectForm({
    eventInfo: {
      enabled: true,
      eventDates: ["2026-10-22", "2026-10-24"],
      venue: { en: "Magic Box, LA" },
      openingHours: [{ date: "2026-10-22", open: "10:00", close: "17:00", lastEntrance: "16:30" }],
      extraRows: [{ label: { en: "Organizer" }, value: { en: "Exporum Inc." } }],
    },
  });

  it("날짜·장소·운영시간·추가 행이 각자의 라벨과 함께 나온다", () => {
    mount({ config: withEventInfo });
    expect(text()).toContain("Period");
    expect(text()).toContain("2026-10-22 – 2026-10-24");
    expect(text()).toContain("Venue");
    expect(text()).toContain("Magic Box, LA");
    expect(text()).toContain("Opening Hours");
    expect(text()).toContain("10:00 ~ 17:00");
    expect(text()).toContain("Last Entrance 16:30");
    expect(text()).toContain("Organizer");
    expect(text()).toContain("Exporum Inc.");
  });

  it("행사 개요를 켰어도 값이 하나도 없으면 빈 표를 그리지 않는다", () => {
    mount({ config: normalizeCollectForm({ eventInfo: { enabled: true } }) });
    expect(host.querySelector(".msf-info")).toBeNull();
  });
});

describe("테마 색", () => {
  it("키컬러를 정하면 --msf-accent 가 그 값으로, 안 정하면 기본값이 그대로 쓰인다", () => {
    mount({ config: normalizeCollectForm({ theme: { accentColor: "#FF8500" } }) });
    const root = host.querySelector(".msf") as HTMLElement;
    expect(root.style.getPropertyValue("--msf-accent")).toBe("#FF8500");

    handle?.destroy();
    mount({ config: CONFIG });
    const root2 = host.querySelector(".msf") as HTMLElement;
    expect(root2.style.getPropertyValue("--msf-accent")).toBe("");
  });
});

describe("동의 항목", () => {
  /**
   * 법률 문구 생성기(legal-templates)가 만든 라벨은 "[Required] ..." 처럼 필수·선택
   * 표시를 이미 문장 앞에 박아서 준다. 여기서 또 "[required] "를 붙이면
   * "[required] [Required] ..."로 겹친다 — 실제로 겹쳐서 나온 화면을 보고 찾은 버그다.
   */
  it("생성된 문구가 있으면 [required]를 또 붙이지 않는다", () => {
    mount({
      config: normalizeCollectForm({
        consent: { privacy: { enabled: true, label: { en: "[Required] I have read and agree to the Privacy Policy" } } },
      }),
    });
    const label = host.querySelector(".msf-check span")?.textContent ?? "";
    expect(label).toBe("[Required] I have read and agree to the Privacy Policy");
    expect(label.toLowerCase().match(/\[required\]/g)?.length ?? 0).toBe(1);
  });

  it("문구를 아직 안 만들었으면(라벨 비어 있음) 대체 문구에 표시를 붙인다", () => {
    mount({ config: normalizeCollectForm({ consent: { privacy: { enabled: true, label: {} } } }) });
    const label = host.querySelector(".msf-check span")?.textContent ?? "";
    expect(label.startsWith("[required]")).toBe(true);
  });

  /** Details 가 라벨 아래 혼자 떨어져 있으면 그 항목과 무관한 것처럼 보인다(레이아웃 버그). */
  it("전문 보기(Details) 버튼이 라벨과 같은 줄(msf-consent-row)에 있다", () => {
    mount({
      config: normalizeCollectForm({
        consent: { privacy: { enabled: true, label: { en: "Privacy" }, body: { en: "전문 내용" } } },
      }),
    });
    const row = host.querySelector(".msf-consent-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".msf-check")).not.toBeNull();
    expect(row?.querySelector(".msf-more")).not.toBeNull();
  });

  /** 대회 폼·웨비나 로더와 같은 팝업 UX 로 통일한다 — 인라인 드롭다운이면 폼마다 동작이 다르다. */
  it("전문 보기(Details) 를 누르면 인라인 확장이 아니라 팝업이 뜬다", () => {
    mount({
      config: normalizeCollectForm({
        consent: { privacy: { enabled: true, label: { en: "Privacy" }, body: { en: "전문 내용" } } },
      }),
    });
    expect(document.querySelector(".msf-overlay")).toBeNull();

    host.querySelector<HTMLButtonElement>(".msf-more")!.click();

    const overlay = document.querySelector(".msf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("전문 내용");
    // 팝업은 host 바깥에 붙는다 — 폼 자체의 overflow/position 에 안 잘리게.
    // **빌린 자리를 안 주면** document.body 다(단독 /f · 아임웹 직접 임베드가 이 경로).
    expect(host.contains(overlay)).toBe(false);
    expect(overlay?.parentElement).toBe(document.body);

    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);
    overlay!.querySelector<HTMLButtonElement>(".msf-terms-agree")!.click();
    expect(checkbox.checked).toBe(true);
    expect(document.querySelector(".msf-overlay")).toBeNull();
  });

  it("전문 팝업도 폼의 키컬러를 이어받는다", () => {
    mount({
      config: normalizeCollectForm({
        theme: { accentColor: "#FF8500" },
        consent: { privacy: { enabled: true, label: { en: "Privacy" }, body: { en: "Policy" } } },
      }),
    });
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    const overlay = document.querySelector<HTMLElement>(".msf-overlay")!;
    expect(overlay.style.getPropertyValue("--msf-accent")).toBe("#FF8500");
  });

  it("팝업 닫기를 누르면 동의하지 않은 채로 닫힌다", () => {
    mount({
      config: normalizeCollectForm({
        consent: { privacy: { enabled: true, label: { en: "Privacy" }, body: { en: "전문 내용" } } },
      }),
    });
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    document.querySelector<HTMLButtonElement>(".msf-terms-close")!.click();

    expect(document.querySelector(".msf-overlay")).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });
});

describe("입력 정규화", () => {
  /** AGENTS.md 공통: 입력은 소스에서 정규화한다 — 안내 문구가 아니라 입력 시점에 강제. */
  it("전화 입력에서 하이픈·괄호·공백을 타이핑 즉시 지운다", () => {
    mount();
    const tel = host.querySelector<HTMLInputElement>('input[type="tel"]')!;
    tel.value = "(202) 555-0147";
    tel.dispatchEvent(new Event("input", { bubbles: true }));
    expect(tel.value).toBe("2025550147");
  });

  it("국제표기의 + 는 남긴다 — 기본 국가가 아닌 사람이 쓰는 유일한 수단이다", () => {
    mount();
    const tel = host.querySelector<HTMLInputElement>('input[type="tel"]')!;
    tel.value = "+82 10-1234-5678";
    tel.dispatchEvent(new Event("input", { bubbles: true }));
    expect(tel.value).toBe("+821012345678");
  });
});

describe("제출", () => {
  const fill = (sel: string, v: string) => {
    const el = host.querySelector<HTMLInputElement>(sel)!;
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const submit = () => submitBtn().click();
  /** fetch → res.json() → 렌더까지 두 단계라 마이크로태스크만으로는 안 끝난다. */
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
  const tickPrivacy = () => {
    const cb = [...host.querySelectorAll<HTMLInputElement>(".msf-check input")].pop()!;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
  };

  it("uses an invalid domestic preview number so a screenshot cannot match a real visitor", () => {
    const fetcher=vi.spyOn(globalThis,"fetch");
    mount({config:normalizeCollectForm({...CONFIG,builderVariant:"domestic"})});
    fill('input[type="email"]',"a@b.com");tickPrivacy();submit();
    expect(host.querySelector('.msf-regno')?.textContent).toBe("90000000");
    expect(isValidRegistrationNo(host.querySelector('.msf-regno')?.textContent)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("locks domestic type selection while a registration is being saved", async () => {
    let resolve!: (r:Response)=>void;
    const fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(()=>new Promise<Response>(r=>{resolve=r;}));
    mount({config:normalizeCollectForm({...CONFIG,builderVariant:"domestic"}),preview:false,origin:"https://machstudio.vercel.app"});
    fill('input[type="email"]',"a@b.com");tickPrivacy();submit();
    const buyer=host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    expect(buyer.disabled).toBe(true);buyer.click();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("General");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).values.type).toBe("General");
    resolve(new Response(JSON.stringify({registrationNo:"90000001",rid:"private-record-id",ticketKey:"private-record-id"}),{status:201}));
    await flush();
    expect(host.querySelector('.msf-badge')?.textContent).toBe("General");
    expect(host.querySelector<HTMLAnchorElement>('a[href*="/t/"]')?.href).toContain("key=private-record-id");
  });

  it("빈 폼은 항목 바로 아래 인라인으로 알린다(AGENTS.md 공통)", () => {
    mount();
    submitBtn().click();
    const errs = [...host.querySelectorAll(".msf-err")].map((e) => e.textContent).filter(Boolean);
    expect(errs).toContain("Required");
    expect(errs).toContain("Please agree to continue");
  });

  /**
   * 분기를 되돌리면 이전 그룹 값이 상태에 남는다(공통 입력을 유지해야 하므로 정상 동작).
   * 그 값이 검증에 실리면 **고칠 칸도 없는 오류**로 등록이 영영 막힌다.
   */
  it("분기를 되돌려도 남은 값이 제출을 막지 않는다", () => {
    mount();
    fill('input[type="email"]', "a@b.com");

    const sel = host.querySelector<HTMLSelectElement>("select[data-msf-key]")!;
    sel.value = "Buyer";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    fill('input[type="text"]', "Acme");
    sel.value = "General";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    tickPrivacy();
    submitBtn().click();

    const errs = [...host.querySelectorAll(".msf-err")].map((e) => e.textContent).filter(Boolean);
    expect(errs).toEqual([]);
  });

  /** 설계 §16.1 — 미리보기는 저장 직전에 멈추고 더미 번호로 완료 화면을 그린다. */
  it("미리보기는 아무것도 보내지 않고 완료 화면을 더미 번호로 보여준다", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    mount();
    fill('input[type="email"]', "a@b.com");
    tickPrivacy();
    submitBtn().click();

    expect(spy).not.toHaveBeenCalled();
    expect(text()).toContain("nothing was saved");

    /**
     * 표본 번호는 **체크digit 이 실제로 틀려야 한다.** 이 번호가 어딘가로 새어 나가
     * 현장 조회에 쓰이면 "없는 번호" 가 아니라 "잘못 입력하셨어요" 로 걸러져야 한다.
     * 예전 값 0000000000000 은 Luhn 을 통과했다 — 주석이 사실과 반대였다.
     */
    const shown = host.querySelector(".msf-regno")?.textContent ?? "";
    expect(shown).toMatch(/^\d{13}$/);
    expect(isValidRegistrationNo(shown)).toBe(false);
  });

  /** 미리보기 클릭이 광고 전환으로 잡히면 데이터가 오염된다(설계 §16.1·§18). */
  it("미리보기에서는 dataLayer 가 한 번도 발화하지 않는다", () => {
    mount();
    fill('input[type="email"]', "a@b.com");
    tickPrivacy();
    submitBtn().click();
    expect((window as { dataLayer?: unknown[] }).dataLayer).toBeUndefined();
  });

  /**
   * **적대적 리뷰가 잡은 치명 결함의 회귀 테스트.**
   * 안내 블록을 다시 그리지 않아서, 필수 동의(초상권 등)를 안 누른 사람에게는
   * Register 를 눌러도 **아무 일도 일어나지 않았다.** 파리(GDPR)에서는 그 폼이 통째로 막힌다.
   */
  it("필수 안내 동의를 안 누르면 그 자리에 오류가 보인다", () => {
    const withRequiredNotice = normalizeCollectForm({
      fields: [{ id: "f1", key: "email", label: { en: "Email" }, type: "email", enabled: true }],
      notices: [{ id: "portrait", enabled: true, placement: "above-consent", mode: "checkbox-required", body: { en: "Photo notice" } }],
      consent: { privacy: { enabled: false } },
    });
    mount({ config: withRequiredNotice });
    submit();

    const errs = [...host.querySelectorAll(".msf-err")].map((e) => e.textContent).filter(Boolean);
    expect(errs).toContain("Please agree to continue");
    // 그 체크박스로 데려가기까지 해야 한다 — 항목이 아니라서 id 로는 못 찾는다.
    expect(host.querySelector('[data-msf-key="notice_portrait"]')).toBeTruthy();
  });

  /** 오류는 눈에만 보이면 안 된다 — 스크린리더 사용자는 왜 막혔는지 알 수 없다. */
  it("오류가 입력과 연결되고 role=alert 로 알려진다", () => {
    mount();
    submit();
    const email = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const errId = email.getAttribute("aria-describedby")!;
    const err = host.querySelector(`#${errId}`)!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toBe("Required");
  });

  /**
   * **국가를 못 고르면 등록을 끝내지 못하는 사람이 생긴다.** LA 파일럿 기본은 US 인데
   * 한국 참관객이 오는 것이 기본 시나리오다 — 서버는 invalid_phone 을 내고 화면에는
   * 고칠 방법이 없었다(설계 §6.3 이 국가 선택 UI 를 그림으로 명시한다).
   */
  describe("전화 국가 선택", () => {
    it("설정의 기본 국가가 처음부터 선택돼 있다", () => {
      mount();
      const sel = host.querySelector<HTMLSelectElement>("select.msf-tel-cc")!;
      expect(sel.value).toBe("US");
      expect(sel.options.length).toBeGreaterThan(200);
    });

    it("고른 국가가 제출 payload 에 실린다", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ registrationNo: "1234567890128", rid: "r1" }), { status: 201 }),
      );
      mount({ preview: false });
      fill('input[type="email"]', "a@b.com");
      fill('input[type="tel"]', "01012345678");
      const sel = host.querySelector<HTMLSelectElement>("select.msf-tel-cc")!;
      sel.value = "KR";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      tickPrivacy();
      submitBtn().click();
      await flush();

      const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body));
      expect(body.phoneCountries).toEqual({ phone: "KR" });
      // 값에는 국가번호를 붙이지 않는다 — 앞 0 규칙이 나라마다 달라 붙이면 틀린다.
      expect(body.values.phone).toBe("01012345678");
    });

    /** 국가를 바꾼 건 "이 번호를 다시 봐 달라" 는 뜻이다 — 옛 오류가 남으면 고쳐도 빨간 채다. */
    it("국가를 바꾸면 그 항목의 오류 표시가 사라진다", () => {
      mount();
      submitBtn().click();  // 빈 폼 → 오류 표시
      const telRow = [...host.querySelectorAll(".msf-field")].find((r) => r.querySelector('input[type="tel"]'))!;
      const sel = telRow.querySelector<HTMLSelectElement>("select.msf-tel-cc")!;
      sel.value = "KR";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      expect((telRow.querySelector(".msf-err")?.textContent ?? "").trim()).toBe("");
    });

    /** 운영자가 GB 를 UK 로 적어 두면 목록에 없다 — 첫 항목이 조용히 선택되면 안 된다. */
    it("설정 국가가 목록에 없으면 아무거나 고르지 않는다", () => {
      const badCountry = normalizeCollectForm({
        fields: [{ id: "f1", key: "phone", label: { en: "Phone" }, type: "tel", enabled: true }],
        validation: { defaultCountry: "UK" },
      });
      mount({ config: badCountry });
      const sel = host.querySelector<HTMLSelectElement>("select.msf-tel-cc")!;
      expect(sel.value).not.toBe("UK");
      // 첫 항목(Afghanistan)이 조용히 선택된 것을 "고른 것" 으로 서버에 보내면 안 되지만,
      // 브라우저 select 는 반드시 뭔가를 선택한다 — 최소한 그 값이 무엇인지 payload 로 나간다.
      expect(sel.value).toBe(sel.options[0].value);
    });
  });

  /**
   * 완료 페이지 이동(§8). 빌더가 "완료 페이지 주소" 를 받아 두고도 런타임이 한 번도
   * 이동하지 않던 구간이다 — URL 조건으로 걸어 둔 전환이 통째로 0 으로 나온다.
   */
  describe("완료 페이지 이동", () => {
    const withRedirect = (template: string) => normalizeCollectForm({
      fields: [{ id: "f1", key: "email", label: { en: "Email" }, type: "email", required: true, enabled: true }],
      consent: { privacy: { enabled: true, label: { en: "Privacy" } } },
      completion: { redirectUrlTemplate: template },
    });

    /**
     * 실제 이동은 jsdom 이 수행하지 못하므로(navigation not implemented) **예약을 본다**.
     * 확인하려는 것은 "언제·어디로 갈 예정인가" 이고, 그게 이 결함의 내용이다.
     */
    const scheduled = (): string[] => {
      const calls = (globalThis.setTimeout as unknown as { mock?: { calls: unknown[][] } }).mock?.calls ?? [];
      return calls
        .filter((c) => c[1] === 1000)
        .map((c) => {
          const before = window.location.href;
          let target = "";
          // 콜백을 직접 돌려 어디로 가려 했는지 본다. jsdom 은 대입을 무시하고 경고만 남긴다.
          try { (c[0] as () => void)(); } catch { /* jsdom navigation */ }
          target = window.location.href !== before ? window.location.href : "(navigation attempted)";
          return target;
        });
    };

    const succeed = async (config: ReturnType<typeof normalizeCollectForm>) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ registrationNo: "1234567890128", rid: "rid-1" }), { status: 201 }),
      );
      vi.spyOn(globalThis, "setTimeout");
      mount({ config, preview: false });
      fill('input[type="email"]', "a@b.com");
      tickPrivacy();
      submitBtn().click();
      await flush();
    };

    it("완료 화면을 먼저 그리고, 1초 뒤 이동을 예약한다", async () => {
      await succeed(withRedirect("https://x.test/done?rid={rid}"));
      // 이동 전에 완료 카드가 떠 있어야 한다 — 폼이 남아 있으면 한 번 더 누른다.
      expect(text()).toContain("You're registered");
      expect(scheduled()).toHaveLength(1);
    });

    /** 미리보기에서 이동하면 편집 중이던 폼을 잃는다(§16.1 "제출해도 아무 일이 없다"). */
    it("미리보기는 이동하지 않는다", async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      vi.spyOn(globalThis, "setTimeout");
      mount({ config: withRedirect("https://x.test/done"), preview: true });
      fill('input[type="email"]', "a@b.com");
      tickPrivacy();
      submitBtn().click();
      await flush();
      expect(spy).not.toHaveBeenCalled();
      expect(text()).toContain("nothing was saved");
      expect(scheduled()).toHaveLength(0);
    });

    /** 이동할 수 없는 주소면 그냥 안 간다 — 등록은 이미 성공했다. */
    it("위험한 주소는 이동을 예약하지 않는다", async () => {
      await succeed(withRedirect("javascript:alert(1)"));
      expect(text()).toContain("You're registered");
      expect(scheduled()).toHaveLength(0);
    });

    it("템플릿이 비어 있으면 인라인 완료 카드가 그대로다", async () => {
      await succeed(withRedirect(""));
      expect(text()).toContain("You're registered");
      expect(scheduled()).toHaveLength(0);
    });
  });

  /** iOS numeric 키패드에는 + 키가 없다 — 기본 국가가 아닌 사람이 국제표기를 못 친다. */
  it("전화 입력은 inputMode=tel 이다", () => {
    mount();
    expect(host.querySelector<HTMLInputElement>('input[type="tel"]')!.inputMode).toBe("tel");
  });

  /**
   * 서버가 403 으로 마감을 확정했는데 화면이 안 바뀌면 방문자는 계속 누르고 계속 403 을
   * 받는다. 런타임에는 config 폴링이 없어서 **서버 응답이 유일한 갱신 신호**다.
   */
  describe("서버가 확정한 접수 상태", () => {
    const openConfig = normalizeCollectForm({
      fields: [{ id: "f1", key: "email", label: { en: "Email" }, type: "email", required: true, enabled: true }],
      consent: { privacy: { enabled: true, label: { en: "Privacy" } } },
    });

    const submitWith = async (status: string) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "closed", status }), { status: 403 }),
      );
      mount({ config: openConfig, preview: false });
      fill('input[type="email"]', "a@b.com");
      tickPrivacy();
      submitBtn().click();
      await flush();
    };

    it("403 이 마감이라고 하면 폼 대신 마감 화면이 된다", async () => {
      await submitWith("closed");
      // 입력칸과 제출 버튼이 남아 있으면 방문자는 계속 시도한다.
      expect(submitBtn()).toBeUndefined();
      expect(host.querySelector('input[type="email"]')).toBeNull();
    });

    /** before 인데 "just closed" 라고 하면 아직 안 열린 폼을 닫힌 것으로 오해한다. */
    it("403 이 접수 전이라고 하면 마감이 아니라 '아직'이라고 말한다", async () => {
      await submitWith("before");
      expect(text()).toContain("hasn't opened yet");
      expect(text()).not.toContain("just closed");
    });

    /** 서버가 모르는 값을 보내면 로컬 판정으로 돌아가야 한다 — 폼이 통째로 사라지면 안 된다. */
    it("알 수 없는 상태값은 무시한다", async () => {
      await submitWith("weird");
      expect(submitBtn()).toBeDefined();
    });
  });

  /**
   * 이메일 항목이 둘인 폼에서 서버는 **값이 채워진** 칸으로 중복을 본다.
   * 클라이언트가 "첫 이메일 항목" 을 다시 추측하면 안내가 빈 칸 밑에 붙는다.
   */
  it("409 안내는 서버가 알려 준 항목 밑에 붙는다", async () => {
    const twoEmails = normalizeCollectForm({
      fields: [
        { id: "f1", key: "email_self", label: { en: "Your email" }, type: "email", enabled: true },
        { id: "f2", key: "email_rep", label: { en: "Company email" }, type: "email", required: true, enabled: true },
      ],
      consent: { privacy: { enabled: true, label: { en: "Privacy" } } },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "dup", duplicateField: "email", duplicateKey: "email_rep" }), { status: 409 }),
    );
    mount({ config: twoEmails, preview: false });
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="email"]')];
    inputs[1].value = "taken@x.com";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    tickPrivacy();
    submitBtn().click();
    await flush();

    // 안내가 **글자와 함께** 붙은 칸이 방금 채운 두 번째 칸이어야 한다
    // (.msf-err 자리는 모든 항목에 늘 있고, 오류가 없으면 비어 있다).
    const rows = [...host.querySelectorAll(".msf-field")];
    const withErr = rows
      .map((r, i) => [i, (r.querySelector(".msf-err")?.textContent ?? "").trim()] as const)
      .filter(([, t]) => t !== "");
    expect(withErr).toEqual([[1, "This email is already registered."]]);
  });

  /**
   * 서버가 준 시각을 **단조 시계**로 이어간다(§17). 기기 벽시계를 기준으로 오프셋을 잡으면
   * 시계가 앞선 기기에서 보정이 통째로 버려져, 서버는 접수 중인데 화면만 마감이 된다.
   */
  it("기기 시계가 크게 앞서도 서버 시각으로 판정한다", () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const openConfig = normalizeCollectForm({
      fields: [{ id: "f1", key: "email", label: { en: "Email" }, type: "email", enabled: true }],
      eventInfo: { enabled: true, registrationWindow: { closesAt } },
    });
    // 서버는 "지금" 이라고 말한다. 기기 시계는 2시간 앞서 있다고 가정한다.
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => realNow.call(Date) + 2 * 60 * 60 * 1000);
    try {
      mount({ config: openConfig, serverNow: new Date(realNow.call(Date)).toISOString() });
      expect(text()).not.toContain("Registration is closed");
      expect(submitBtn()).toBeDefined();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("실제 모드에서는 폼 노출·시작·제출이 dataLayer 로 나간다(§18)", () => {
    mount({ preview: false });
    const events = () => ((window as { dataLayer?: Array<{ event: string }> }).dataLayer ?? []).map((e) => e.event);
    expect(events()).toContain("ms_form_view");

    fill('input[type="email"]', "a@b.com");
    expect(events()).toContain("ms_form_start");
  });

  /** §18 "동의 연동" — 이 값이 없으면 GTM 이 미동의자에게 Consent Mode v2 를 못 내린다. */
  it("성공 이벤트에 마케팅 동의 상태가 실린다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ registrationNo: "1234567890128", rid: "r1" }), { status: 201 }),
    );
    mount({ preview: false });
    fill('input[type="email"]', "a@b.com");
    tickPrivacy();
    submitBtn().click();
    await flush();

    const dl = ((window as { dataLayer?: Array<Record<string, unknown>> }).dataLayer ?? []);
    const lead = dl.find((e) => e.event === "generate_lead")!;
    expect(lead.ms_consent).toBe("denied");
  });

  /**
   * §18 이벤트 계약 — visitor_type 은 로케일 화면 라벨이 아니라 canonical group.value 여야 한다.
   * 아니면 같은 세그먼트가 언어별로 다른 값("바이어" vs "Buyer")으로 갈라져 GTM 트리거가
   * 언어마다 따로 깨진다.
   */
  it("한국어 라벨로 골라도 visitor_type 은 canonical 값(Buyer)으로 나간다", async () => {
    const bilingual = normalizeCollectForm({
      fields: [
        { id: "f1", key: "email", label: { en: "Email" }, type: "email", required: true, enabled: true },
        {
          id: "f2", key: "type", label: { en: "Visitor type" }, type: "select", enabled: true,
          options: [{ en: "General", ko: "일반" }, { en: "Buyer", ko: "바이어" }],
        },
      ],
      branch: { enabled: true, fieldKey: "type", groups: [{ value: "Buyer", fields: [] }] },
      consent: { privacy: { enabled: true, label: { en: "Privacy" } } },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ registrationNo: "1234567890128", rid: "r1" }), { status: 201 }),
    );
    mount({ config: bilingual, preview: false, locale: "ko" });
    fill('input[type="email"]', "a@b.com");
    const sel = host.querySelector<HTMLSelectElement>("select[data-msf-key]")!;
    sel.value = "바이어";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    tickPrivacy();
    submitBtn().click();
    await flush();

    const dl = ((window as { dataLayer?: Array<Record<string, unknown>> }).dataLayer ?? []);
    expect(dl.find((e) => e.event === "ms_visitor_type_selected")?.visitor_type).toBe("Buyer");
    expect(dl.find((e) => e.event === "ms_form_submit")?.visitor_type).toBe("Buyer");
    expect(dl.find((e) => e.event === "generate_lead")?.visitor_type).toBe("Buyer");
  });
});

/**
 * **동의 전문 팝업이 Shadow 밖으로 새지 않는가.**
 *
 * 팝업이 `document.body` 로 나가는 것 자체는 정당하다 — 폼이 호스트 문서 흐름 안에 있어서
 * 오버레이가 그 안에 있으면 부모의 overflow/position 에 잘린다. 문제는 **홈페이지 경로**다:
 * 거기서는 스타일이 그 구획의 ShadowRoot 안에만 들어가므로, body 에 붙은 팝업은
 * `position:fixed` 도 배경도 `.msf` 리셋도 서체도 **하나도 못 받는다** — 파트너 페이지
 * 맨 아래에 서식 없는 약관 텍스트 덩어리가 그려진다.
 *
 * 그래서 자리를 **예약한 쪽이 실어 보낸다**. 폼은 그 자리가 어디서 왔는지 모른다.
 */
describe("전문 팝업 — 빌린 자리", () => {
  function makeSlot() {
    const shadowHost = document.createElement("div");
    document.body.appendChild(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const layer = document.createElement("div");
    root.appendChild(layer);
    let released = 0;
    return { layer, root, release: () => { released += 1; }, released: () => released, shadowHost };
  }

  function openTerms(overlayOpt?: Parameters<typeof mount>[0] extends never ? never : unknown) {
    return mount({
      overlay: overlayOpt,
      config: normalizeCollectForm({
        consent: { privacy: { enabled: true, label: { en: "Privacy" }, body: { en: "전문 내용" } } },
      }),
    } as Parameters<typeof mount>[0]);
  }

  it("자리를 주면 그 안에 붙는다 — document.body 로 새지 않는다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();

    const overlay = slot.layer.querySelector(".msf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("전문 내용");
    // body 직계에는 없어야 한다.
    expect([...document.body.children].some((el) => el.classList.contains("msf-overlay"))).toBe(false);
  });

  /** 이게 이 수정의 핵심 — 빌린 자리에 **스타일이 닿아야** 한다. */
  it("빌린 자리에 폼 스타일을 넣는다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    expect(slot.root.querySelector("style")).not.toBeNull();
  });

  /**
   * 레이어는 이미 화면을 덮는 스크림이다. 여기서 또 깔면 두 겹이 되므로 **레이어를 중화**하고
   * `.msf-overlay` 자신의 fixed·스크림·max-height 는 건드리지 않는다 — 두 경로가 같아야 한다.
   */
  it("레이어를 중화하되 오버레이 자신은 그대로 둔다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    expect(slot.layer.getAttribute("data-msx-bare")).toBe("1");
    const overlay = slot.layer.querySelector(".msf-overlay")!;
    expect(overlay.getAttribute("style") ?? "").not.toContain("position");
  });

  it("닫으면 자리를 반납한다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    slot.layer.querySelector<HTMLButtonElement>(".msf-terms-close")!.click();
    expect(slot.released()).toBe(1);
    expect(slot.layer.querySelector(".msf-overlay")).toBeNull();
  });

  it("동의해도 자리를 반납한다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    slot.layer.querySelector<HTMLButtonElement>(".msf-terms-agree")!.click();
    expect(slot.released()).toBe(1);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  /** 자리를 못 빌리면(null) 문서 경로로 떨어진다 — 팝업이 아예 안 뜨면 안 된다. */
  it("자리를 못 빌리면 document.body 로 떨어진다", () => {
    openTerms(() => null);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    const overlay = document.querySelector(".msf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.parentElement).toBe(document.body);
  });

  /** Escape 로도 닫힌다 — 모달 안에 있을 때 아무것도 안 하는 공백을 남기지 않는다. */
  it("Escape 로 닫힌다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    host.querySelector<HTMLButtonElement>(".msf-more")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(slot.layer.querySelector(".msf-overlay")).toBeNull();
    expect(slot.released()).toBe(1);
  });

  /** 두 번 눌러도 팝업이 겹치지 않는다. */
  it("두 번 열면 앞엣것을 닫는다", () => {
    const slot = makeSlot();
    openTerms(() => slot);
    const btn = host.querySelector<HTMLButtonElement>(".msf-more")!;
    btn.click();
    btn.click();
    expect(slot.layer.querySelectorAll(".msf-overlay")).toHaveLength(1);
  });
});
