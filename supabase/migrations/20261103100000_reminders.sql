-- 정기 알림 — 순수 추가 마이그레이션(2026-11-03). 기존 테이블·데이터는 건드리지 않는다.
--
-- Reminder : 매달 기준일(마지막 업무일 / n번째 업무일)에 맞춰 업무일로 며칠 전에 정해진 사람들에게 알린다.
--            contentTemplate 이 있으면 콘텐츠 캘린더에 그 달 항목을 미리 넣어 둔다(예: 월간 엑스포럼).
--            매일 cron(/api/cron/daily, KST 09:00)이 돌린다.
-- ContentItem.recurrenceKey : 정기 알림이 만든 항목 표시("{reminderId}:YYYY-MM") — 같은 달에 두 번 만들지 않게.
-- 재실행 안전(IF NOT EXISTS). prisma db push 는 쓰지 않는다.

BEGIN;

CREATE TABLE IF NOT EXISTS "Reminder" (
    "id"                 TEXT         NOT NULL,
    "workspaceId"        TEXT         NOT NULL,
    "title"              TEXT         NOT NULL,
    "message"            TEXT         NOT NULL DEFAULT '',
    "schedule"           TEXT         NOT NULL,
    "nth"                INTEGER      NOT NULL DEFAULT 1,
    "leadBusinessDays"   INTEGER      NOT NULL DEFAULT 0,
    "recipientIds"       TEXT[]       NOT NULL DEFAULT '{}',
    "contentTemplate"    JSONB,
    "contentMonthsAhead" INTEGER      NOT NULL DEFAULT 3,
    "lastNotifiedMonth"  TEXT,
    "active"             BOOLEAN      NOT NULL DEFAULT true,
    "createdById"        TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Reminder_workspaceId_idx" ON "Reminder" ("workspaceId");
DO $$ BEGIN
  ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "recurrenceKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_recurrenceKey_key" ON "ContentItem" ("recurrenceKey");

COMMIT;
