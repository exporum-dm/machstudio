-- 상세페이지(독립 공고형 페이지) — 순수 추가 마이그레이션. 기존 테이블·데이터는 건드리지 않는다.
-- 대회 공고 페이지와 같은 렌더러(src/lib/notice)를 쓰고, 아임웹 코드블럭에 /d/{id} 한 줄로 붙는다.
-- config.noticePage 에 공고와 같은 모양으로 저장한다. theme.accentColor 가 키컬러.
-- 재실행 안전(IF NOT EXISTS). prisma db push 는 쓰지 않는다.

BEGIN;

CREATE TABLE IF NOT EXISTS "DetailPage" (
    "id"          TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "projectId"   TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "config"      JSONB        NOT NULL DEFAULT '{}',
    "theme"       JSONB        NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"   TIMESTAMP(3),
    CONSTRAINT "DetailPage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DetailPage_projectId_idx" ON "DetailPage" ("projectId");
CREATE INDEX IF NOT EXISTS "DetailPage_workspaceId_idx" ON "DetailPage" ("workspaceId");

DO $$ BEGIN
  ALTER TABLE "DetailPage" ADD CONSTRAINT "DetailPage_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 앱 서버(Prisma, postgres 역할)만 읽고 쓴다. anon/authenticated 키로 직접 읽히지 않게.
ALTER TABLE "DetailPage" ENABLE ROW LEVEL SECURITY;

COMMIT;
