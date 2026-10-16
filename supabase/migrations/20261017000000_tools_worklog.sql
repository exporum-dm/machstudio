-- 도구(이벤트 택소노미) · 업무일지 — 순수 추가 마이그레이션. 기존 테이블·데이터는 건드리지 않는다.
--
-- EventTaxonomy : 워크스페이스 공통 이벤트 이름 규칙(GA4/GTM). UTM 값은 기존 UTMPreset 을 그대로 쓴다.
-- WorkGroup     : 주간업무보고의 "행사" 줄(예: 코리아 엑스포 LA 2026.10.22-24). 프로젝트와 1:1 이 아니다
--                 — 한 프로젝트(Korea Expo)에 LA·도쿄·파리 행사가 따로 있다.
-- WorkEntry     : 업무일지 한 줄(날짜·행사·분류·내역·상태·결과). 주간 보고는 이 줄들로 만든다.
-- 재실행 안전(IF NOT EXISTS). prisma db push 는 쓰지 않는다.

BEGIN;

CREATE TABLE IF NOT EXISTS "EventTaxonomy" (
    "id"          TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "category"    TEXT         NOT NULL DEFAULT '',
    "description" TEXT         NOT NULL DEFAULT '',
    "trigger"     TEXT         NOT NULL DEFAULT '',
    "parameters"  JSONB        NOT NULL DEFAULT '[]',
    "platforms"   TEXT[]       NOT NULL DEFAULT '{}',
    "status"      TEXT         NOT NULL DEFAULT 'active',
    "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventTaxonomy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EventTaxonomy_workspaceId_name_key" ON "EventTaxonomy" ("workspaceId", "name");
DO $$ BEGIN
  ALTER TABLE "EventTaxonomy" ADD CONSTRAINT "EventTaxonomy_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "WorkGroup" (
    "id"          TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "projectId"   TEXT,
    "name"        TEXT         NOT NULL,
    "startDate"   DATE,
    "endDate"     DATE,
    "archived"    BOOLEAN      NOT NULL DEFAULT false,
    "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkGroup_workspaceId_idx" ON "WorkGroup" ("workspaceId");
DO $$ BEGIN
  ALTER TABLE "WorkGroup" ADD CONSTRAINT "WorkGroup_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkGroup" ADD CONSTRAINT "WorkGroup_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "WorkEntry" (
    "id"          TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "groupId"     TEXT,
    "authorId"    TEXT         NOT NULL,
    "date"        DATE         NOT NULL,
    "category"    TEXT         NOT NULL DEFAULT '',
    "content"     TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'done',
    "result"      TEXT         NOT NULL DEFAULT '',
    "note"        TEXT         NOT NULL DEFAULT '',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkEntry_workspaceId_date_idx" ON "WorkEntry" ("workspaceId", "date");
CREATE INDEX IF NOT EXISTS "WorkEntry_authorId_date_idx" ON "WorkEntry" ("authorId", "date");
DO $$ BEGIN
  ALTER TABLE "WorkEntry" ADD CONSTRAINT "WorkEntry_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkEntry" ADD CONSTRAINT "WorkEntry_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "WorkGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkEntry" ADD CONSTRAINT "WorkEntry_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 앱 서버(Prisma, postgres 역할)만 읽고 쓴다. anon/authenticated 키로 직접 읽히지 않게.
ALTER TABLE "EventTaxonomy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkEntry" ENABLE ROW LEVEL SECURITY;

COMMIT;
