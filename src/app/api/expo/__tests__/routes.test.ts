// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 라우트 관문 — **순서가 곧 안전이다.**
 *
 *  ① 기능이 열려 있나 → 아니면 Expo 델리게이트를 부르지도 않는다
 *  ② 쓰기면 출처·형식 → 본문을 읽기 전에
 *  ③ 로그인 → ④ 소유권(URL 이 지목한 자원 기준)
 *
 * DB 를 붙이지 않는다. Prisma·Supabase·스키마 조회를 전부 가짜로 두고, **관문이 실제로
 * 그 순서로 막는지**만 본다. 규칙 자체는 site-service·auth 테스트가 따로 지킨다.
 */

const prismaMock = {
  workspaceMember: { findMany: vi.fn() },
  projectMember: { findMany: vi.fn() },
  expoSite: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  expoPage: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
    updateManyAndReturn: vi.fn(),
  },
  expoPageRevision: {
    aggregate: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(),
  },
  project: { findUnique: vi.fn() },
  collectSource: { findFirst: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
};
const getUser = vi.fn();
const probe = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/expo/schema-probe", () => ({ probeExpoSchema: () => probe() }));

const SCHEMA_VERSION = "20260901-v2";

/** 우리 화면에서 온 JSON 쓰기 요청. */
const write = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://machstudio.vercel.app/api/expo", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });

const read = () => new Request("https://machstudio.vercel.app/api/expo");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("EXPO_SCHEMA_CAPABILITY", SCHEMA_VERSION);
  vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", "");
  probe.mockResolvedValue(true);
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  prismaMock.workspaceMember.findMany.mockResolvedValue([{ workspaceId: "w1", role: "OWNER" }]);
  prismaMock.projectMember.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([{ id: "pg1" }]);
  prismaMock.expoPage.findUnique.mockImplementation(async () => {
    const latest = prismaMock.expoPage.findFirst.mock.results.at(-1);
    return latest ? await latest.value : null;
  });
  prismaMock.expoPageRevision.aggregate.mockResolvedValue({ _max: { sequence: null } });
  prismaMock.expoPageRevision.findFirst.mockResolvedValue(null);
  prismaMock.expoPageRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "rev-created", createdAt: new Date(), ...data,
  }));
  prismaMock.expoPageRevision.findMany.mockResolvedValue([]);
  prismaMock.expoPageRevision.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.$transaction.mockImplementation(async (work: unknown) =>
    typeof work === "function"
      ? (work as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
      : work);
});

describe("① 기능 게이트가 첫 줄", () => {
  /**
   * 스키마가 없는 배포에서 Expo 델리게이트를 부르면 던진다. 게이트가 먼저 막아야
   * 어드민이 500 대신 "아직 없는 화면" 으로 보인다.
   */
  it("플래그가 없으면 조회를 시작하지 않는다", async () => {
    vi.stubEnv("EXPO_SCHEMA_CAPABILITY", "");
    const { GET } = await import("@/app/api/expo/route");

    const res = await GET(read());
    expect(res.status).toBe(404);
    expect(prismaMock.expoSite.findMany).not.toHaveBeenCalled();
    // 카탈로그 조회조차 안 한다 — 가장 싼 검사가 먼저다.
    expect(probe).not.toHaveBeenCalled();
  });

  it("테이블이 아직 없으면 닫힌 채로 답한다", async () => {
    probe.mockResolvedValue(false);
    const { GET } = await import("@/app/api/expo/route");

    expect((await GET(read())).status).toBe(404);
    expect(prismaMock.expoSite.findMany).not.toHaveBeenCalled();
  });

  /** 503 은 "그 기능이 존재한다" 를 알려 준다 — 아직 공개 전이라 그 사실도 안 나간다. */
  it("닫혔을 때 404 로 답한다 — 503 이 아니다", async () => {
    probe.mockResolvedValue(false);
    const { GET } = await import("@/app/api/expo/route");
    const res = await GET(read());
    expect(res.status).toBe(404);
    expect(await res.json()).not.toHaveProperty("capability");
  });
});

describe("② 쓰기 출처 가드 — 본문을 읽기 전에", () => {
  /**
   * 쿠키는 브라우저가 자동으로 붙는다. 다른 사이트가 로그인한 운영자의 브라우저를 시켜
   * 이 API 를 부르면 인증을 통과한다 — 발행·공개를 다루는 API 라 위험하다.
   */
  it("다른 사이트에서 온 쓰기를 막는다", async () => {
    const { POST } = await import("@/app/api/expo/route");
    const res = await POST(write({ projectId: "p1", name: "x" }, { "sec-fetch-site": "cross-site" }));

    expect(res.status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();      // 인증까지 가지도 않는다
    expect(prismaMock.expoSite.create).not.toHaveBeenCalled();
  });

  /** 폼 전송 형식은 프리플라이트 없이 교차 출처로 날아온다. */
  it("JSON 이 아닌 본문은 415", async () => {
    const { POST } = await import("@/app/api/expo/route");
    const res = await POST(write({ projectId: "p1", name: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(prismaMock.expoSite.create).not.toHaveBeenCalled();
  });

  it("읽기에는 출처 가드를 걸지 않는다", async () => {
    prismaMock.expoSite.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/expo/route");
    const res = await GET(new Request("https://x.test/api/expo", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(200);
  });
});

describe("③ 로그인", () => {
  it("비로그인은 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("@/app/api/expo/route");
    expect((await GET(read())).status).toBe(401);
  });
});

describe("④ 소유권 — 남의 것은 404", () => {
  it("남의 워크스페이스 사이트는 없는 것으로 답한다", async () => {
    prismaMock.expoSite.findFirst.mockResolvedValue({ id: "s1", workspaceId: "남의워크스페이스", projectId: "p9" });
    const { GET } = await import("@/app/api/expo/[siteId]/route");

    const res = await GET(read(), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(404);
  });

  /** 소속은 프로젝트 레코드에서 온다 — 클라이언트가 보낸 워크스페이스를 믿지 않는다. */
  it("남의 전시에는 사이트를 만들 수 없다", async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: "p9", workspaceId: "남의워크스페이스" });
    const { POST } = await import("@/app/api/expo/route");

    const res = await POST(write({ projectId: "p9", name: "새 사이트" }));
    expect(res.status).toBe(404);
    expect(prismaMock.expoSite.create).not.toHaveBeenCalled();
  });
});

describe("사이트 상세 — 사전등록 소스 후보", () => {
  /**
   * 후보는 **URL 이 지목한 사이트의 전시**에서 온다. 사이드바 문맥으로 뽑으면 딥링크로
   * 남의 전시 사이트를 열었을 때 엉뚱한 전시의 폼이 후보로 뜬다(AGENTS.md ②).
   *
   * 그리고 조건이 로더의 수용 조건과 **같아야** 한다 — 편집기가 고를 수 있는데 공개
   * 로더가 거절하면(`h/[pageId]/loader.ts`) 운영자는 "골랐는데 폼이 안 나온다" 를 겪는다.
   */
  it("사이트의 전시에 속한 빌더 폼만 후보로 싣는다", async () => {
    prismaMock.expoSite.findFirst.mockResolvedValue({
      id: "s1", workspaceId: "w1", projectId: "p1", name: "사이트",
      theme: null, collectSourceId: null, defaultLocale: "ko", previewToken: "tok", siteUrl: null,
    });
    prismaMock.expoPage.findMany.mockResolvedValue([]);
    prismaMock.collectSource.findMany.mockResolvedValue([
      { id: "src-1", name: "관람 신청", isActive: true },
    ]);
    const { GET } = await import("@/app/api/expo/[siteId]/route");

    const res = await GET(read(), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).sources).toEqual([{ id: "src-1", name: "관람 신청", isActive: true }]);

    expect(prismaMock.collectSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "p1", deletedAt: null, mode: "builder" },
      }),
    );
  });

  /** 이름만 필요하다 — fieldMappings·formConfig 를 실으면 응답이 폼 하나당 수십 KB 가 된다. */
  it("후보에는 이름과 활성 여부만 싣는다", async () => {
    prismaMock.expoSite.findFirst.mockResolvedValue({
      id: "s1", workspaceId: "w1", projectId: "p1", name: "사이트",
      theme: null, collectSourceId: null, defaultLocale: "ko", previewToken: "tok", siteUrl: null,
    });
    prismaMock.expoPage.findMany.mockResolvedValue([]);
    prismaMock.collectSource.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/expo/[siteId]/route");
    await GET(read(), { params: Promise.resolve({ siteId: "s1" }) });

    expect(prismaMock.collectSource.findMany.mock.calls[0][0].select)
      .toEqual({ id: true, name: true, isActive: true });
  });
});

describe("draft 저장 — 편집 충돌", () => {
  const page = {
    id: "pg1", siteId: "s1", slug: "home", title: "홈", isHome: true, sortOrder: 0,
    draft: { sections: [] }, draftRevision: 7, published: null, publishedAt: null,
    liveAt: null, imwebUrl: null, updatedAt: new Date(),
    site: { id: "s1", workspaceId: "w1", projectId: "p1" },
  };

  const patch = (body: unknown) =>
    new Request("https://machstudio.vercel.app/api/expo/pages/pg1", {
      method: "PATCH",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(body),
    });

  it("번호가 맞으면 저장한다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    prismaMock.expoPage.updateManyAndReturn.mockResolvedValue([{
      id: "pg1", slug: "home", title: "홈", imwebUrl: null, draftRevision: 8, updatedAt: new Date(),
    }]);
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");

    const res = await PATCH(patch({ draft: { schemaVersion: 2, sections: [] }, draftRevision: 7 }),
      { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(200);
    expect(prismaMock.expoPage.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "pg1", siteId: "s1", deletedAt: null, draftRevision: 7,
        site: { deletedAt: null },
      }),
      data: expect.objectContaining({ draftRevision: { increment: 1 } }),
    }));
  });

  it("동일한 번호의 두 요청 중 하나만 원자적으로 저장한다", async () => {
    let stored = { ...page, draft: { schemaVersion: 2, sections: [] }, draftRevision: 7 };
    let initialReads = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
    prismaMock.expoPage.findFirst.mockImplementation(async () => {
      if (initialReads < 2) {
        initialReads += 1;
        const captured = structuredClone(stored);
        if (initialReads === 2) releaseReads();
        await bothRead;
        return captured;
      }
      return structuredClone(stored);
    });
    prismaMock.expoPage.updateManyAndReturn.mockImplementation(async ({ where, data }) => {
      if (stored.draftRevision !== where.draftRevision) return [];
      stored = {
        ...stored,
        draft: structuredClone(data.draft),
        draftRevision: stored.draftRevision + Number(data.draftRevision.increment),
      };
      return [{
        id: stored.id, slug: stored.slug, title: stored.title, imwebUrl: stored.imwebUrl,
        draftRevision: stored.draftRevision, updatedAt: stored.updatedAt,
      }];
    });
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");
    const firstDraft = { schemaVersion: 2, sections: [], preset: "first" };
    const secondDraft = { schemaVersion: 2, sections: [], preset: "second" };

    const responses = await Promise.all([
      PATCH(patch({ draft: firstDraft, draftRevision: 7 }), { params: Promise.resolve({ pageId: "pg1" }) }),
      PATCH(patch({ draft: secondDraft, draftRevision: 7 }), { params: Promise.resolve({ pageId: "pg1" }) }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect(await conflict.json()).toMatchObject({ draft: stored.draft, draftRevision: 8 });
    expect(stored.draftRevision).toBe(8);
    expect(stored.draft).toEqual(expect.objectContaining({ preset: expect.stringMatching(/^(first|second)$/) }));
    expect(prismaMock.expoPage.updateManyAndReturn).toHaveBeenCalledTimes(2);
  });

  /** 409 에 **최신 값을 함께** 준다 — 화면이 그걸로 다시 읽는다. 자동 재시도는 안 한다. */
  it("그 사이 다른 곳에서 저장했으면 409 + 최신 값", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");

    const res = await PATCH(patch({ draft: { schemaVersion: 2, sections: [] }, draftRevision: 3 }),
      { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.draftRevision).toBe(7);
    expect(body.draft).toEqual({ schemaVersion: 2, sections: [] });
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 넘치는 값은 자르지 않고 어느 칸인지 알려 준다. */
  it("너무 긴 값은 422 + 필드 오류", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");

    const res = await PATCH(patch({
      draft: { schemaVersion: 2, sections: [{
        sid: "00000000-0000-4000-8000-000000000001",
        type: "kv", variant: "column", content: { title: "가".repeat(600) },
      }] },
      draftRevision: 7,
    }), { params: Promise.resolve({ pageId: "pg1" }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fields[0].path).toBe("sections[0].content.title");
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });
});

/**
 * **버튼을 숨기는 것은 인가가 아니다.**
 *
 * 화면은 MEMBER 에게 `canPublish: false`·`canManageSite: false` 라고 말한다
 * (`permissions.ts`). 그런데 라우트가 멤버십만 보면 숨긴 버튼을 API 로는 누를 수 있다 —
 * MEMBER 가 발행하고, 공개 스위치를 켜고, 사이트를 지울 수 있는 상태였다.
 *
 * 여기서 그 다섯 자리를 못 박는다. 초안 편집은 MEMBER 도 되어야 하므로 함께 확인한다.
 */
describe("역할 — 화면이 숨긴 것은 API 도 막는다", () => {
  const page = {
    id: "pg1", siteId: "s1", slug: "home", title: "홈", isHome: false, sortOrder: 1,
    draft: { sections: [] }, draftRevision: 3, published: { sections: [] }, publishedAt: null,
    liveAt: null, imwebUrl: null, updatedAt: new Date(),
    site: { id: "s1", workspaceId: "w1", projectId: "p1" },
  };
  const site = { id: "s1", workspaceId: "w1", projectId: "p1", name: "사이트", theme: null,
    collectSourceId: null, defaultLocale: "ko", previewToken: "t", siteUrl: null };

  const asMember = () =>
    prismaMock.workspaceMember.findMany.mockResolvedValue([{ workspaceId: "w1", role: "MEMBER" }]);
  const asProjectRole = (role: "VIEWER" | "EDITOR" | "ADMIN") =>
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1", role }]);

  it("MEMBER 도 배정 없이 발행을 시도한다", async () => {
    asMember();
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");
    const res = await POST(write({}), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(422);
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 끄는 것도 막는다 — 남이 켠 것을 아무나 끄면 전시 기간 중에 파트너 사이트가 빈다. */
  it("MEMBER 도 공개를 중지할 수 있다", async () => {
    asMember();
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { POST } = await import("@/app/api/expo/pages/[pageId]/live/route");
    const res = await POST(write({ live: false }), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(200);
    expect(prismaMock.expoPage.update).toHaveBeenCalled();
  });

  it("MEMBER 는 미리보기 토큰을 재발급할 수 없다", async () => {
    asMember();
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    const { POST } = await import("@/app/api/expo/[siteId]/regenerate-preview-token/route");
    const res = await POST(write({}), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(403);
    expect(prismaMock.expoSite.update).not.toHaveBeenCalled();
  });

  it("PROJECT EDITOR 는 미리보기 토큰을 재발급할 수 없다", async () => {
    asMember();
    asProjectRole("EDITOR");
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    const { POST } = await import("@/app/api/expo/[siteId]/regenerate-preview-token/route");
    const res = await POST(write({}), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(403);
    expect(prismaMock.expoSite.update).not.toHaveBeenCalled();
  });

  it("MEMBER 는 사이트를 지울 수 없다", async () => {
    asMember();
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    const { DELETE } = await import("@/app/api/expo/[siteId]/route");
    const res = await DELETE(write({}), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(403);
    expect(prismaMock.expoSite.update).not.toHaveBeenCalled();
  });

  it("MEMBER 는 페이지를 지울 수 없다", async () => {
    asMember();
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { DELETE } = await import("@/app/api/expo/pages/[pageId]/route");
    const res = await DELETE(write({}), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(403);
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 색은 이미 공개된 것을 바꾼다 — 공개 로더가 사이트 테마를 실시간으로 읽는다. */
  it("MEMBER 도 색을 바꿀 수 있다", async () => {
    asMember();
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    prismaMock.expoSite.update.mockResolvedValue({ ...site, theme: { accent: "#ff0000" } });
    const { PATCH } = await import("@/app/api/expo/[siteId]/route");
    const res = await PATCH(write({ theme: { accent: "#ff0000" } }), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(200);
    expect(prismaMock.expoSite.update).toHaveBeenCalled();
  });

  /** 초안 편집은 MEMBER 도 된다 — 좁히려다 편집까지 막으면 안 된다. */
  it("MEMBER 도 초안은 저장할 수 있다", async () => {
    asMember();
    asProjectRole("EDITOR");
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    prismaMock.expoPage.updateManyAndReturn.mockResolvedValue([{
      id: "pg1", slug: "home", title: "홈", imwebUrl: null, draftRevision: 4, updatedAt: new Date(),
    }]);
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");
    const res = await PATCH(
      write({ draft: { schemaVersion: 2, sections: [] }, draftRevision: 3 }),
      { params: Promise.resolve({ pageId: "pg1" }) },
    );
    expect(res.status).toBe(200);
    expect(prismaMock.expoPage.updateManyAndReturn).toHaveBeenCalled();
  });

  /** 사이트 이름 바꾸기도 편집 쪽이다. */
  it("MEMBER 도 사이트 이름은 바꿀 수 있다", async () => {
    asMember();
    asProjectRole("EDITOR");
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    prismaMock.expoSite.update.mockResolvedValue({ ...site });
    const { PATCH } = await import("@/app/api/expo/[siteId]/route");
    const res = await PATCH(write({ name: "새 이름" }), { params: Promise.resolve({ siteId: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("PROJECT EDITOR 는 발행을 시도할 수 있다", async () => {
    asMember();
    asProjectRole("EDITOR");
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");
    // 빈 초안이라 검증은 실패하지만, 권한 때문에 거절된 것은 아니다.
    expect((await POST(write({}), { params: Promise.resolve({ pageId: "pg1" }) })).status).toBe(422);
  });

  it("PROJECT ADMIN 은 사이트를 지울 수 있다", async () => {
    asMember();
    asProjectRole("ADMIN");
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    prismaMock.expoSite.update.mockResolvedValue({ ...site });
    const { DELETE } = await import("@/app/api/expo/[siteId]/route");
    expect((await DELETE(write({}), { params: Promise.resolve({ siteId: "s1" }) })).status).toBe(200);
  });

  it("프로젝트 VIEWER 표기가 있어도 현재 워크스페이스 정책대로 편집한다", async () => {
    asMember();
    asProjectRole("VIEWER");
    prismaMock.expoPage.findFirst.mockResolvedValue(page);
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");
    expect((await PATCH(write({ title: "x" }), { params: Promise.resolve({ pageId: "pg1" }) })).status).toBe(200);
  });
});

describe("프로젝트 목록 노출", () => {
  it("같은 워크스페이스의 미배정 프로젝트 사이트도 조회한다", async () => {
    prismaMock.workspaceMember.findMany.mockResolvedValue([{ workspaceId: "w1", role: "MEMBER" }]);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1", role: "VIEWER" }]);
    prismaMock.expoSite.findMany.mockResolvedValue([
      { id: "s1", workspaceId: "w1", projectId: "p1", name: "보이는 사이트", siteUrl: null, updatedAt: new Date(), _count: { pages: 1 } },
      { id: "s2", workspaceId: "w1", projectId: "p2", name: "숨긴 사이트", siteUrl: null, updatedAt: new Date(), _count: { pages: 1 } },
    ]);
    const { GET } = await import("@/app/api/expo/route");
    const body = await (await GET(read())).json();
    expect(body.sites.map((site: { id: string }) => site.id)).toEqual(["s1", "s2"]);
  });

  it("명시한 미배정 프로젝트도 현재 워크스페이스 권한으로 조회한다", async () => {
    prismaMock.workspaceMember.findMany.mockResolvedValue([{ workspaceId: "w1", role: "MEMBER" }]);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: "p1", role: "VIEWER" }]);
    prismaMock.project.findUnique.mockResolvedValue({ id: "p2", workspaceId: "w1" });
    const { GET } = await import("@/app/api/expo/route");
    const res = await GET(new Request("https://machstudio.vercel.app/api/expo?projectId=p2"));
    expect(res.status).toBe(200);
    expect(prismaMock.expoSite.findMany).toHaveBeenCalled();
    expect((await res.json()).permissions.canEdit).toBe(true);
  });
});

describe("살아 있는 부모 사이트 경계", () => {
  const knownPage = {
    id: "pg-deleted-site", siteId: "deleted-site", slug: "known", title: "알려진 페이지",
    isHome: false, sortOrder: 1, draft: { schemaVersion: 2, sections: [] }, draftRevision: 3,
    published: null, publishedAt: null, liveAt: null, imwebUrl: null, updatedAt: new Date(),
    site: { id: "deleted-site", workspaceId: "w1", projectId: "p1", deletedAt: new Date() },
  };
  const activeOnly = async (args: { where?: { site?: { deletedAt?: null } } }) =>
    args.where?.site?.deletedAt === null ? null : knownPage;

  it.each([
    ["읽기", async () => {
      const { GET } = await import("@/app/api/expo/pages/[pageId]/route");
      return GET(read(), { params: Promise.resolve({ pageId: knownPage.id }) });
    }],
    ["편집", async () => {
      const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");
      return PATCH(write({ title: "수정" }), { params: Promise.resolve({ pageId: knownPage.id }) });
    }],
    ["삭제", async () => {
      const { DELETE } = await import("@/app/api/expo/pages/[pageId]/route");
      return DELETE(write({}), { params: Promise.resolve({ pageId: knownPage.id }) });
    }],
    ["공개 전환", async () => {
      const { POST } = await import("@/app/api/expo/pages/[pageId]/live/route");
      return POST(write({ live: false }), { params: Promise.resolve({ pageId: knownPage.id }) });
    }],
    ["발행", async () => {
      const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");
      return POST(write({}), { params: Promise.resolve({ pageId: knownPage.id }) });
    }],
  ])("부모가 소프트 삭제된 알려진 page id의 %s를 404로 숨긴다", async (_label, invoke) => {
    prismaMock.expoPage.findFirst.mockImplementation(activeOnly);
    const response = await invoke();
    expect(response.status).toBe(404);
    expect(prismaMock.expoPage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: knownPage.id, deletedAt: null, site: { deletedAt: null } }),
    }));
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
    expect(prismaMock.expoPage.updateManyAndReturn).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * 색은 **되돌리지 않고 거절한다.**
 *
 * `normalizeExpoTheme` 는 색이 아닌 값을 기본 남색으로 되돌린다 — 읽는 경로에서는 그게
 * 맞지만, 쓰는 경로에서 그러면 저장돼 있던 브랜드 색이 파괴되고 그 결과가 즉시 공개
 * 페이지로 나간다. 화면에는 "색을 적용했어요" 만 뜨고 옛 값은 어디에도 안 남는다.
 */
describe("사이트 색 저장", () => {
  const site = {
    id: "s1", workspaceId: "w1", projectId: "p1", name: "사이트",
    theme: { accent: "#e2532c", lightBg: "#fffdf8", darkBg: "#161310" },
    collectSourceId: null, defaultLocale: "ko", previewToken: "t", siteUrl: null,
  };

  const patchTheme = async (theme: unknown) => {
    prismaMock.expoSite.findFirst.mockResolvedValue(site);
    prismaMock.expoSite.update.mockResolvedValue({ ...site });
    const { PATCH } = await import("@/app/api/expo/[siteId]/route");
    return PATCH(write({ theme }), { params: Promise.resolve({ siteId: "s1" }) });
  };

  it("색이 아닌 값은 400 이고 아무것도 바꾸지 않는다", async () => {
    // Figma 에서 복사하면 알파가 붙은 8자리가 온다.
    const res = await patchTheme({ accent: "#E2532CFF", lightBg: "#ffffff", darkBg: "#111318" });
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toEqual(["accent"]);
    expect(prismaMock.expoSite.update).not.toHaveBeenCalled();
  });

  it("저장된 색을 기본값으로 되돌리지 않는다", async () => {
    const res = await patchTheme({ accent: "지금은맛있는", lightBg: "", darkBg: "#111318" });
    expect(res.status).toBe(400);
    expect(prismaMock.expoSite.update).not.toHaveBeenCalled();
  });

  /** 빠뜨린 칸까지 기본값으로 채우면 부분 저장이 나머지를 지운다. */
  it("보낸 칸만 바꾼다", async () => {
    const res = await patchTheme({ accent: "#00aa55" });
    expect(res.status).toBe(200);
    expect(prismaMock.expoSite.update.mock.calls[0][0].data.theme).toEqual({
      accent: "#00aa55", lightBg: "#fffdf8", darkBg: "#161310",
    });
  });

  it("3자리 HEX 도 받아서 6자리로 편다", async () => {
    const res = await patchTheme({ accent: "#f80" });
    expect(res.status).toBe(200);
    expect(prismaMock.expoSite.update.mock.calls[0][0].data.theme.accent).toBe("#ff8800");
  });
});

/**
 * 페이지 상세가 **"왜 아직 안 나가는가" 와 "붙일 코드"** 를 함께 준다.
 *
 * 화면이 따로 판단하면 버튼은 눌리는데 아무 일도 안 일어나는 상태가 생긴다
 * (`readiness.ts` 머리말). 그리고 코드의 주소는 **파트너 사이트 HTML 에 박혀 회수할 수
 * 없으므로**, 못 만들 상황이면 만들지 않고 이유를 준다(`origin.ts`).
 */
describe("페이지 상세 — 내보내기 정보", () => {
  const page = {
    id: "pg1", siteId: "s1", slug: "home", title: "홈", isHome: true, sortOrder: 0,
    draftRevision: 3, publishedAt: null, liveAt: null, imwebUrl: null, updatedAt: new Date(),
    lastSeenAt: new Date("2026-09-01T02:59:00.000Z"), lastSeenOrigin: "https://smarttechkorea.com",
    site: { id: "s1", workspaceId: "w1", projectId: "p1" },
    draft: { sections: [] }, published: null,
  };

  const get = async (over: Record<string, unknown> = {}) => {
    prismaMock.expoPage.findFirst.mockResolvedValue({ ...page, ...over });
    const { GET } = await import("@/app/api/expo/pages/[pageId]/route");
    const res = await GET(read(), { params: Promise.resolve({ pageId: "pg1" }) });
    return { res, body: await res.json() };
  };

  it("발행할 수 없으면 사유를 함께 준다", async () => {
    const { body } = await get();
    expect(body.page.readiness.canPublish).toBe(false);
    expect(body.page.readiness.publishIssues[0].code).toBe("no-sections");
  });

  it("연결 진단용 최근 시각과 origin을 함께 준다", async () => {
    const { body } = await get();
    expect(body.page.lastSeenAt).toBe("2026-09-01T02:59:00.000Z");
    expect(body.page.lastSeenOrigin).toBe("https://smarttechkorea.com");
  });

  it("발행 전에는 공개도 못 켠다고 말한다", async () => {
    const { body } = await get();
    expect(body.page.readiness.canGoLive).toBe(false);
    expect(body.page.readiness.liveIssues[0].code).toBe("not-published");
  });

  /**
   * 주소가 설정 안 됐으면 **코드를 만들지 않는다.** 빈 문자열이나 상대경로를 주면
   * 붙인 사람은 붙였다고 믿고 전시 기간에 조용히 빈 자리가 된다.
   */
  it("공개 주소가 없으면 코드 대신 이유를 준다", async () => {
    vi.stubEnv("EXPO_CANONICAL_PUBLIC_ORIGIN", "");
    const { body } = await get();
    expect(body.page.snippets.ok).toBe(false);
    expect(body.page.snippets.message).toContain("공개 주소");
    expect(JSON.stringify(body.page.snippets)).not.toContain("/h/");
  });

  it("주소가 있으면 절대주소로 코드를 만든다", async () => {
    vi.stubEnv("EXPO_CANONICAL_PUBLIC_ORIGIN", "https://machstudio.example.com");
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_APP_URL", "https://machstudio.example.com");
    const { body } = await get();
    expect(body.page.snippets.ok).toBe(true);
    expect(body.page.snippets.page.src).toBe("https://machstudio.example.com/h/pg1");
  });

  /** 따로 내보내기를 켠 구획만 목록에 오른다 — 그게 운영자의 의도다. */
  it("따로 내보내기를 켠 구획의 코드만 싣는다", async () => {
    vi.stubEnv("EXPO_CANONICAL_PUBLIC_ORIGIN", "https://machstudio.example.com");
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_APP_URL", "https://machstudio.example.com");
    const sid = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    const { body } = await get({
      draft: { sections: [
        { sid, type: "kv", variant: "column", enabled: true, embedEnabled: true,
          design: {}, content: { title: { ko: "제목" } } },
        { sid: other, type: "textblock", variant: "prose", enabled: true, embedEnabled: false,
          design: {}, content: { body: { ko: "본문" } } },
      ] },
    });

    expect(body.page.snippets.sections).toHaveLength(1);
    expect(body.page.snippets.sections[0].sid).toBe(sid);
    // 아직 발행 전이라 붙여도 안 나온다 — 그 사유가 함께 온다.
    expect(body.page.snippets.sections[0].issues[0].code).toBe("not-published");
  });

  it("백업 HTML 구획은 발행본에서 만들고 embedEnabled와 초안 차이를 무시한다", async () => {
    const publishedSid = "11111111-1111-4111-8111-111111111111";
    const draftOnlySid = "22222222-2222-4222-8222-222222222222";
    const { body } = await get({
      draft: { schemaVersion: 2, sections: [{
        sid: draftOnlySid, type: "textblock", variant: "prose", enabled: true, embedEnabled: true,
        design: {}, content: { body: { ko: "아직 발행하지 않은 초안" } },
      }] },
      published: { schemaVersion: 2, sections: [{
        sid: publishedSid, type: "kv", variant: "column", enabled: true, embedEnabled: false,
        design: {}, content: { title: { ko: "발행된 키비주얼" } },
      }] },
    });

    expect(body.page.exportSections).toEqual([{ sid: publishedSid, label: "키비주얼" }]);
  });
});

describe("발행·공개", () => {
  const base = { id: "pg1", siteId: "s1", site: { id: "s1", workspaceId: "w1", projectId: "p1" } };

  it("내보낼 섹션이 없으면 발행을 막고 이유를 준다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, draft: { schemaVersion: 2, sections: [] }, published: null, liveAt: null,
    });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");

    const res = await POST(write({}), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("publish-readiness-failed");
    expect(body.issues[0]).toEqual(expect.objectContaining({
      path: "sections", code: "no-sections", severity: "error",
    }));
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 발행본 없이 공개를 켜면 빈 화면이 파트너 사이트에 나간다. */
  it("발행 전에는 공개를 켤 수 없다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue({ ...base, published: null });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/live/route");

    const res = await POST(write({ live: true }), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(422);
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 되돌리기를 막으면 안 된다 — 끄는 것은 언제나 된다. */
  it("공개를 끄는 것은 언제나 된다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue({ ...base, published: null });
    prismaMock.expoPage.update.mockResolvedValue({ id: "pg1", liveAt: null });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/live/route");

    const res = await POST(write({ live: false }), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(200);
  });
});

/**
 * **릴리스 승인 전에는 밖으로 내보내는 것을 켤 수 없다.** 끄는 것은 언제나 된다.
 *
 * 공개 스위치만 잠그면 부족하다 — **구획 단독 임베드는 `liveAt` 을 보지 않고 발행본만
 * 본다**(`model.ts` 의 `standaloneSection`). 그래서 발행만으로 노출이 미리 장전되고,
 * 플래그를 켜는 순간 준비해 둔 구획이 그대로 나간다. 계획서가 "the flag alone cannot
 * expose prepared content" 라고 쓴 상태가 그것이다.
 *
 * 이 describe 는 릴리스가 꺼져 있는 상태를 기본으로 쓴다(beforeEach 가 이미 그렇게 둔다).
 */
describe("릴리스 잠금", () => {
  const base = { id: "pg1", siteId: "s1", site: { id: "s1", workspaceId: "w1", projectId: "p1" } };
  const sec = (sid: string, embedEnabled: boolean) => ({
    sid, type: "textblock", variant: "prose", content: { body: "본문" }, embedEnabled,
  });
  const ON = () => vi.stubEnv("EXPO_PUBLIC_EMBED_RELEASE", "on");

  it("공개 스위치를 켤 수 없다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, published: { sections: [sec("00000000-0000-4000-8000-000000000001", false)] },
    });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/live/route");

    const res = await POST(write({ live: true }), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(422);
    expect((await res.json()).issues.map((i: { code: string }) => i.code)).toContain("launch-locked-live");
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  it("릴리스가 열리면 켤 수 있다", async () => {
    ON();
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, published: { sections: [sec("00000000-0000-4000-8000-000000000001", false)] },
    });
    prismaMock.expoPage.update.mockResolvedValue({ id: "pg1", liveAt: new Date() });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/live/route");

    expect((await POST(write({ live: true }), { params: Promise.resolve({ pageId: "pg1" }) })).status).toBe(200);
  });

  /** 발행이 구획을 **새로 켜는** 경우만 막는다. */
  it("따로 내보내기를 새로 켜는 발행을 막는다", async () => {
    const sid = "00000000-0000-4000-8000-000000000001";
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, draft: { schemaVersion: 2, sections: [sec(sid, true)] },
      published: { schemaVersion: 2, sections: [sec(sid, false)] }, liveAt: null,
    });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");

    const res = await POST(write({}), { params: Promise.resolve({ pageId: "pg1" }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("public-embed-release-disabled");
    expect(body.issues[0].code).toBe("launch-locked-embed");
    expect(body.issues[0].sid).toBe(sid);
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 이미 발행본에 켜져 있던 것을 다시 발행하는 것은 **새 노출이 아니다.** */
  it("이미 켜져 있던 구획은 다시 발행해도 막지 않는다", async () => {
    const sid = "00000000-0000-4000-8000-000000000001";
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, draft: { schemaVersion: 2, sections: [sec(sid, true)] },
      published: { schemaVersion: 2, sections: [sec(sid, true)] }, liveAt: null,
    });
    prismaMock.expoPage.update.mockResolvedValue({ id: "pg1" });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");

    expect((await POST(write({}), { params: Promise.resolve({ pageId: "pg1" }) })).status).toBe(200);
  });

  /** 끄는 발행은 언제나 된다 — 되돌리기를 막으면 안 된다. */
  it("따로 내보내기를 끄는 발행은 막지 않는다", async () => {
    const sid = "00000000-0000-4000-8000-000000000001";
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, draft: { schemaVersion: 2, sections: [sec(sid, false)] },
      published: { schemaVersion: 2, sections: [sec(sid, true)] }, liveAt: null,
    });
    prismaMock.expoPage.update.mockResolvedValue({ id: "pg1" });
    const { POST } = await import("@/app/api/expo/pages/[pageId]/publish/route");

    expect((await POST(write({}), { params: Promise.resolve({ pageId: "pg1" }) })).status).toBe(200);
  });

  it("초안 저장에서도 새로 켜는 것을 막는다", async () => {
    const sid = "00000000-0000-4000-8000-000000000001";
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, draft: { sections: [sec(sid, false)] }, draftRevision: 3,
    });
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");

    const res = await PATCH(
      write({ draft: { schemaVersion: 2, sections: [sec(sid, true)] }, draftRevision: 3 }, { }),
      { params: Promise.resolve({ pageId: "pg1" }) },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).fields[0].code).toBe("launch-locked");
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });

  /** 이미 켜 둔 구획이 있는 페이지가 **영구 저장 불가**가 되면 안 된다. */
  it("이미 켜진 구획이 있어도 다른 값을 고쳐 저장할 수 있다", async () => {
    const sid = "00000000-0000-4000-8000-000000000001";
    prismaMock.expoPage.findFirst.mockResolvedValue({
      ...base, draft: { sections: [sec(sid, true)] }, draftRevision: 3,
    });
    prismaMock.expoPage.updateManyAndReturn.mockResolvedValue([{
      id: "pg1", slug: "home", title: "홈", imwebUrl: null, draftRevision: 4, updatedAt: new Date(),
    }]);
    const { PATCH } = await import("@/app/api/expo/pages/[pageId]/route");

    const next = { ...sec(sid, true), content: { body: "고친 본문" } };
    const res = await PATCH(
      write({ draft: { schemaVersion: 2, sections: [next] }, draftRevision: 3 }),
      { params: Promise.resolve({ pageId: "pg1" }) },
    );
    expect(res.status).toBe(200);
  });
});

describe("홈 페이지 보호", () => {
  it("홈은 지울 수 없다", async () => {
    prismaMock.expoPage.findFirst.mockResolvedValue({
      id: "pg1", siteId: "s1", isHome: true,
      site: { id: "s1", workspaceId: "w1", projectId: "p1" },
    });
    const { DELETE } = await import("@/app/api/expo/pages/[pageId]/route");

    const res = await DELETE(
      new Request("https://machstudio.vercel.app/api/expo/pages/pg1", {
        method: "DELETE",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      }),
      { params: Promise.resolve({ pageId: "pg1" }) },
    );
    expect(res.status).toBe(409);
    expect(prismaMock.expoPage.update).not.toHaveBeenCalled();
  });
});
