-- 콘텐츠 캘린더 — 순수 추가 마이그레이션. 기존 테이블·데이터는 건드리지 않는다.
--
-- ContentItem : 올릴 콘텐츠 한 건(제목·발행일·채널·형식·상태·담당·내용·링크).
--               프로젝트마다 캘린더가 있고, 전체 보기는 워크스페이스의 모든 항목을 합친다.
--               projectId NULL = 프로젝트 없이 팀 공통으로 올리는 것.
-- 담당자(assigneeId)는 User 를 외래키로 물지 않는다 — 업무일지와 같은 이유(퇴사자 계정을 지워도 남아야 한다).
-- 프로젝트가 지워져도 항목은 남긴다(SET NULL).
-- 재실행 안전(IF NOT EXISTS). prisma db push 는 쓰지 않는다.

BEGIN;

CREATE TABLE IF NOT EXISTS "ContentItem" (
    "id"           TEXT         NOT NULL,
    "workspaceId"  TEXT         NOT NULL,
    "projectId"    TEXT,
    "title"        TEXT         NOT NULL,
    "date"         DATE,
    "time"         TEXT         NOT NULL DEFAULT '',
    "status"       TEXT         NOT NULL DEFAULT 'idea',
    "channels"     TEXT[]       NOT NULL DEFAULT '{}',
    "format"       TEXT         NOT NULL DEFAULT '',
    "assigneeId"   TEXT,
    "assigneeName" TEXT         NOT NULL DEFAULT '',
    "body"         TEXT         NOT NULL DEFAULT '',
    "link"         TEXT         NOT NULL DEFAULT '',
    "createdById"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ContentItem_workspaceId_date_idx" ON "ContentItem" ("workspaceId", "date");
CREATE INDEX IF NOT EXISTS "ContentItem_projectId_idx" ON "ContentItem" ("projectId");
DO $$ BEGIN
  ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
