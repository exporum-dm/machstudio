// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 공개 로더 — **검사 순서가 곧 안전이다.**
 *
 * ① 공개 승인(순수 문자열)  → DB 를 건드리기 전에
 * ② IP 한도               → 인증 없이 DB 를 여는 경로다
 * ③ 스키마 준비            → 준비 전에는 Expo 델리게이트를 부르지 않는다
 * ④ 공개 절대 주소          → 없으면 503. 요청 호스트로 대체하지 않는다
 * ⑤ 조회·게이트·페이로드
 *
 * DB 를 붙이지 않는다. 순서와 캐시 정책, 그리고 **무엇이 밖으로 나가지 않는지**만 본다.
 */

const prismaMock = {
  expoPage: { findFirst: vi.fn(), findMany: vi.fn() },
  collectSource: { findMany: vi.fn() },
};
const rateLimitAsync = vi.fn();
const probe = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ratelimit", () => ({
  getClientIp: () => "1.2.3.4",
  rateLimitAsync: (...args: unknown[]) => rateLimitAsync(...args),
}));
vi.mock("@/lib/expo/schema-probe", () => ({ probeExpoSchema: () => probe() }));

const SCHEMA_VERSION = "20260901-v2";
const CANONICAL = "https://machstudio.example.com";
const SID = "11111111-1111-1111-1111-111111111111";

const req = (url = "https://machstudio.example.com/h/pg1", headers: Record<string, string> = {}) =>
  new Request(url, { headers });

const page = (over: Record<string, unknown> = {}) => ({
  id: "pg1",
  published: { sections: [{ sid: SID, type: "kv", variant: "column", enabled: true, embedEnabled: false, design: {}, content: { title: { ko: "제목" } } }] },
  liveAt: new Date("2026-08-01T00:00:00Z"),
  site: { id: "s1", projectId: "p1", theme: { accent: "#1f3a5f" }, defaultLocale: "ko", deletedAt: null },
  ...over,
});

async function get(target: { pageId: string; sid?: string }, request = req()) {
  const { serveExpoRuntime } = await import("@/app/h/[pageId]/loader");
  return serveExpoRuntime(request, target);
}

/**
 * 응답 본문에서 **boot 인자만** 잘라 낸다.
 *
 * 번들 자체가 `connectionOnly` 같은 식별자를 문자열로 담고 있어서, 본문 전체에
 * `not.toContain` 을 걸면 항상 걸린다 — 무엇을 보고 있는지 정확히 좁혀야 한다.
 */
function bootArgs(body: string): string {
  const index = body.indexOf("__msExpo.boot(");
  expect(index).toBeGreaterThan(-1);
  return body.slice(index);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("EXPO_SCHEMA_CAPABILITY", SCHEMA_VERSION);
  vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", "on");
  vi.stubEnv("EXPO_CANONICAL_PUBLIC_ORIGIN", CANONICAL);
  vi.stubEnv("NEXT_PUBLIC_CANONICAL_APP_URL", CANONICAL);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
  probe.mockResolvedValue(true);
  rateLimitAsync.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  prismaMock.expoPage.findFirst.mockResolvedValue(page());
  prismaMock.expoPage.findMany.mockResolvedValue([]);
  prismaMock.collectSource.findMany.mockResolvedValue([]);
});

describe("① 공개 승인이 첫 줄", () => {
  /** 아직 아무에게도 공개하지 않은 기능이다 — 승인 전에는 한 글자도 나가지 않는다. */
  it("승인이 없으면 DB 도 한도도 건드리지 않는다", async () => {
    vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", "");
    const res = await get({ pageId: "pg1" });
    expect(res.status).toBe(404);
    expect(rateLimitAsync).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(prismaMock.expoPage.findFirst).not.toHaveBeenCalled();
  });

  /** 근사치를 받아 주지 않는다 — 실수로 켜지는 경로를 남기지 않는 것이 게이트의 존재 이유다. */
  it("ON·true·1 은 승인이 아니다", async () => {
    for (const value of ["ON", "true", "1", "yes"]) {
      vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", value);
      expect((await get({ pageId: "pg1" })).status).toBe(404);
    }
  });

  /**
   * 꺼진 상태의 응답을 엣지가 물면 켠 뒤에도 한동안 빈 스크립트가 서빙된다.
   * 그리고 그 반대(라이브 본문의 캐시를 꺼진 상태가 물려받는 것)가 더 나쁘다.
   */
  it("꺼진 응답은 절대 캐시되지 않는다", async () => {
    vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", "");
    const res = await get({ pageId: "pg1" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("CDN-Cache-Control")).toBeNull();
  });

  it("프리플라이트는 꺼져 있어도 204 다", async () => {
    vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", "");
    const { OPTIONS } = await import("@/app/h/[pageId]/route");
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("② 한도가 조회보다 먼저", () => {
  it("한도를 넘으면 조회하지 않는다", async () => {
    rateLimitAsync.mockResolvedValue({ allowed: false, retryAfterMs: 30_000 });
    const res = await get({ pageId: "pg1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(prismaMock.expoPage.findFirst).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("③ 스키마 준비", () => {
  it("테이블이 아직 없으면 델리게이트를 부르지 않는다", async () => {
    probe.mockResolvedValue(false);
    const res = await get({ pageId: "pg1" });
    expect(res.status).toBe(404);
    expect(prismaMock.expoPage.findFirst).not.toHaveBeenCalled();
  });
});

describe("④ 공개 절대 주소", () => {
  /** 이 주소는 파트너 HTML 에 박혀 회수할 수 없다 — 잘못되면 아무것도 안 내보낸다. */
  it("설정이 없으면 503 이고 캐시하지 않는다", async () => {
    vi.stubEnv("EXPO_CANONICAL_PUBLIC_ORIGIN", "");
    const res = await get({ pageId: "pg1" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(prismaMock.expoPage.findFirst).not.toHaveBeenCalled();
  });

  it("프리뷰 배포에서는 만들지 않는다", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await get({ pageId: "pg1" })).status).toBe(503);
  });

  /** 요청 호스트로 떨어지면 프리뷰 주소가 파트너 사이트에 박힌다. */
  it("요청 호스트로 대체하지 않는다", async () => {
    vi.stubEnv("EXPO_CANONICAL_PUBLIC_ORIGIN", "");
    const res = await get({ pageId: "pg1" }, req("https://partner.example.com/h/pg1"));
    expect(await res.text()).not.toContain("partner.example.com");
  });

  it("통과하면 payload 에 그 주소가 실린다", async () => {
    expect(bootArgs(await (await get({ pageId: "pg1" })).text())).toContain(CANONICAL);
  });
});

describe("⑤ 조회와 게이트", () => {
  it("없는 페이지는 404 이고 짧게만 캐시한다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(null);
    const res = await get({ pageId: "nope" });
    expect(res.status).toBe(404);
    expect(res.headers.get("CDN-Cache-Control")).toContain("s-maxage=60");
  });

  it("사이트가 삭제됐거나 미발행이면 404", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page({ site: { ...page().site, deletedAt: new Date() } }));
    expect((await get({ pageId: "pg1" })).status).toBe(404);

    prismaMock.expoPage.findFirst.mockResolvedValue(page({ published: null }));
    expect((await get({ pageId: "pg1" })).status).toBe(404);
  });

  /**
   * DB 가 흔들릴 때 404 를 캐시하면 **엣지가 살아 있는 콘텐츠를 없는 것으로 덮는다.**
   * 그래서 404 가 아니라 캐시 불가 503 이다.
   */
  it("조회가 실패하면 404 가 아니라 캐시 불가 503 이다", async () => {
    prismaMock.expoPage.findFirst.mockRejectedValue(new Error("pool exhausted"));
    const res = await get({ pageId: "pg1" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("공개 중인 페이지는 구획을 실어 보낸다", async () => {
    const args = bootArgs(await (await get({ pageId: "pg1" })).text());
    expect(args).toContain("제목");
    expect(args).toContain('"mode":"live"');
    expect(args).not.toContain("connectionOnly");
  });

  /**
   * 발행됐지만 공개 스위치가 꺼진 상태 — **의도한 호스트만 확보하고 아무것도 안 그린다.**
   * 그래야 전환일 전에 스니펫을 미리 붙여 두고 "붙었는지" 를 확인할 수 있다.
   */
  it("공개 스위치가 꺼져 있으면 연결 확인만 준다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page({ liveAt: null }));
    const args = bootArgs(await (await get({ pageId: "pg1" })).text());
    expect(args).toContain('"connectionOnly":true');
    // 초안·발행본 내용이 한 글자도 새지 않는다.
    expect(args).not.toContain("제목");
  });
});

describe("구획 단독", () => {
  /** 페이지의 liveAt·enabled 를 보지 않는다 — 그게 부분 이행의 정의다. */
  it("embedEnabled 가 켜진 구획은 페이지가 안 열려도 나간다", async () => {
    const published = { sections: [{ sid: SID, type: "kv", variant: "column", enabled: false, embedEnabled: true, design: {}, content: { title: { ko: "히어로" } } }] };
    prismaMock.expoPage.findFirst.mockResolvedValue(page({ liveAt: null, published }));
    const args = bootArgs(await (await get({ pageId: "pg1", sid: SID })).text());
    expect(args).toContain("히어로");
    expect(args).toContain(`"sectionId":"${SID}"`);
    expect(args).toContain('"mode":"live"');
  });

  it("발행본에 없는 sid 는 404", async () => {
    const res = await get({ pageId: "pg1", sid: "99999999-9999-9999-9999-999999999999" });
    expect(res.status).toBe(404);
  });

  /** 알려진 구획인데 게이트가 닫혀 있으면 같은 무해한 연결 확인이다. */
  it("알려진 구획이 꺼져 있으면 연결 확인만 준다", async () => {
    const args = bootArgs(await (await get({ pageId: "pg1", sid: SID })).text());
    expect(args).toContain('"connectionOnly":true');
    expect(args).not.toContain("제목");
  });
});

describe("사전등록 소스 확인", () => {
  const withForm = () => page({
    published: {
      sections: [{
        sid: SID, type: "register-form", variant: "inline", enabled: true, embedEnabled: false,
        design: {}, content: { sourceRef: "src-other" },
      }],
    },
  });

  /** 확인 안 된 참조가 나가면 홈페이지의 등록 폼이 **다른 전시의 등록을 받는다.** */
  it("다른 프로젝트의 소스는 비운다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(withForm());
    prismaMock.collectSource.findMany.mockResolvedValue([]);
    const args = bootArgs(await (await get({ pageId: "pg1" })).text());
    expect(args).not.toContain("src-other");
    // 같은 프로젝트인지 서버가 직접 확인한다.
    expect(prismaMock.collectSource.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ["src-other"] }, projectId: "p1", deletedAt: null, mode: "builder",
    });
  });

  it("같은 프로젝트의 소스는 그대로 싣는다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(withForm());
    prismaMock.collectSource.findMany.mockResolvedValue([{ id: "src-other" }]);
    expect(bootArgs(await (await get({ pageId: "pg1" })).text())).toContain("src-other");
  });

  it("소스 확인 조회가 실패해도 참조를 비운다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(withForm());
    prismaMock.collectSource.findMany.mockRejectedValue(new Error("catalog unavailable"));
    expect(bootArgs(await (await get({ pageId: "pg1" })).text())).not.toContain("src-other");
  });

  it("서버에서 해석한 V2 행사·캠페인·목적지를 런타임에 싣는다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page({
      published: {
        schemaVersion: 2,
        settings: {
          event: { edition: 2027, startsAt: "2027-06-01T00:00:00+09:00", endsAt: "2027-06-03T00:00:00+09:00" },
          campaigns: [{ id: "apply", label: "참가기업 모집", startsAt: "2020-01-01T00:00:00+09:00", endsAt: "2030-01-01T00:00:00+09:00", override: "auto", enabled: true }],
          destinations: [{ id: "contact", label: "문의", action: { type: "anchor", target: "contact" }, enabled: true }],
        },
        sections: [{ sid: SID, type: "kv", variant: "column", enabled: true, embedEnabled: false, design: {}, content: { title: { ko: "제목" } } }],
      },
    }));
    const args = bootArgs(await (await get({ pageId: "pg1" })).text());
    expect(args).toContain('"campaigns":[{"id":"apply","label":"참가기업 모집","active":true}]');
    expect(args).toContain('"destinations":[{"id":"contact","label":"문의","action":{"type":"anchor","target":"contact"}}]');
    // 행사 일정도 런타임이 소비하지 않는다. 저장 문자열을 스크립트에 싣지 않는다.
    expect(args).not.toContain('"event"');
    expect(args).not.toContain('"override"');
    expect(args).not.toContain('"startsAt"');
    expect(args).not.toContain('"endsAt"');
  });
});

describe("라이브 캠페인 해석", () => {
  const campaignPage = () => page({
    published: {
      schemaVersion: 2,
      settings: {
        campaigns: [{
          id: "apply", label: "참가기업 모집",
          startsAt: "2026-09-01T03:00:00.000Z", endsAt: "2026-09-01T04:00:00.000Z",
          override: "auto", enabled: true,
        }],
      },
      sections: [{
        sid: SID, type: "kv", variant: "column", enabled: true, embedEnabled: false,
        design: {}, content: { title: { ko: "제목" } },
      }],
    },
  });

  it("campaignState query를 무시하고 서버 시각만 사용한다", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-01T02:59:59.000Z"));
      prismaMock.expoPage.findFirst.mockResolvedValue(campaignPage());
      const args = bootArgs(await (await get(
        { pageId: "pg1" },
        req("https://machstudio.example.com/h/pg1?campaignState=both"),
      )).text());
      expect(args).toContain('"id":"apply","label":"참가기업 모집","active":false');
    } finally {
      vi.useRealTimers();
    }
  });

  it("같은 발행본도 활성 경계를 지나면 ETag가 바뀐다", async () => {
    vi.useFakeTimers();
    try {
      prismaMock.expoPage.findFirst.mockResolvedValue(campaignPage());
      vi.setSystemTime(new Date("2026-09-01T02:59:59.000Z"));
      const before = await get({ pageId: "pg1" });
      vi.setSystemTime(new Date("2026-09-01T03:00:00.000Z"));
      const active = await get({ pageId: "pg1" });
      expect(before.headers.get("ETag")).not.toBe(active.headers.get("ETag"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("스크립트 본문 안전", () => {
  /**
   * id 는 URL 세그먼트라 `%2F` 로 "별표+슬래시" 를 만들어 주석을 닫고 임의 JS 를 넣을
   * 수 있다(랜딩 로더에서 실제로 있었던 취약점).
   */
  it("주석에 요청한 id 를 넣지 않는다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(null);
    const evil = "*/alert(1)/*";
    const body = await (await get({ pageId: evil })).text();
    expect(body).not.toContain(evil);
    expect(body).toBe("/* mach expo: not found */\n");
  });

  /** 운영자가 쓴 문구 한 줄로 파트너 페이지에 임의 스크립트가 들어가면 안 된다. */
  it("payload 의 꺾쇠를 이스케이프한다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page({
      published: { sections: [{ sid: SID, type: "textblock", variant: "prose", enabled: true, embedEnabled: false, design: {}, content: { body: { ko: "</script><script>alert(1)</script>" } } }] },
    }));
    const args = bootArgs(await (await get({ pageId: "pg1" })).text());
    expect(args).not.toContain("</script");
    expect(args).toContain("\\u003C");
  });
});

describe("캐시 검증자", () => {
  /** 검증자가 없으면 브라우저가 재검증을 못 해 낡은 스크립트를 계속 실행한다(랜딩 실측). */
  it("ETag 를 준다", async () => {
    const res = await get({ pageId: "pg1" });
    expect(res.headers.get("ETag")).toMatch(/^W\/"[\w-]{27}"$/);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(res.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=30");
  });

  it("같은 ETag 면 304 다", async () => {
    const etag = (await get({ pageId: "pg1" })).headers.get("ETag")!;
    const res = await get({ pageId: "pg1" }, req("https://machstudio.example.com/h/pg1", { "if-none-match": etag }));
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(res.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=30");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("파트너 사이트에서 받아 갈 수 있다", async () => {
    const res = await get({ pageId: "pg1" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toContain("application/javascript");
  });
});

it("serves one multilingual embed and resolves an explicit host signal with source-language fallback", async () => {
  prismaMock.expoPage.findFirst.mockResolvedValue(page({ published: { sections: [{
    sid: SID, type: "kv", variant: "column", enabled: true, embedEnabled: true, design: {},
    content: { title: { ko: "Title KO", ja: "Title JA" }, subtitle: { en: "Subtitle EN", ko: "Subtitle KO" } },
  }] } }));
  const automatic = bootArgs(await (await get({ pageId: "pg1" })).text());
  expect(automatic).toContain('"defaultLocale":"ko"');
  expect(automatic).toContain('"translations":');
  expect(automatic).toContain('"title":"Title JA"');

  const explicit = bootArgs(await (await get({ pageId: "pg1", sid: SID }, req(`${CANONICAL}/h/pg1/${SID}?hl=%7C%7C%7Cjp%7Cko`))).text());
  expect(explicit).toContain('"title":"Title JA"');
  expect(explicit).toContain('"subtitle":"Subtitle KO"');
  expect(explicit).not.toContain('"translations":');
});
