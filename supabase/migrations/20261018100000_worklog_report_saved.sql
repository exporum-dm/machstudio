-- 주간 보고를 실제 보고서처럼(2026-10-18).
--
--  WorkGroup.aliases : 일지 머리표 → 행사. 시트에서 "[코엑]" "[교박]" 처럼 줄여 쓰던 이름.
--  WeeklyReport      : 보고일마다 다듬어 저장한 보고서(자동 초안을 고친 것 · 예전 엑셀에서 불러온 것 · AI 로 다듬은 것).
--                      다음 주 보고서가 지난 보고의 흐름(금주 목표 → 전주 달성)을 이어 쓰는 데 쓴다.
-- 순수 추가. 재실행 안전. prisma db push 는 쓰지 않는다.

BEGIN;

ALTER TABLE "WorkGroup" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "WeeklyReport" (
    "id"          TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "reportDate"  DATE         NOT NULL,
    "rows"        JSONB        NOT NULL DEFAULT '[]',
    "source"      TEXT         NOT NULL DEFAULT 'edited',
    "updatedById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyReport_workspaceId_reportDate_key" ON "WeeklyReport" ("workspaceId", "reportDate");
DO $$ BEGIN
  ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
