-- 업무일지를 시트처럼 — 날짜(행) × 사람(열) 칸에 줄을 적고, 끝나면 취소선(2026-10-18).
-- 순수 추가/완화 마이그레이션. 기존 줄은 그대로 보인다(공통=false, 순서=0, 날짜 그대로).
--
--  date      : NULL 이면 "먼 미래"(날짜 없이 미리 적어 둔 일). 주간 보고에는 들어가지 않는다.
--  common    : 시트의 "공통" 열(주간업무회의처럼 팀 전체 일). 누구나 고칠 수 있다.
--  sortOrder : 한 칸 안의 줄 순서 — 사이에 끼워 넣을 수 있게 실수.
-- 재실행 안전. prisma db push 는 쓰지 않는다.

BEGIN;

ALTER TABLE "WorkEntry" ALTER COLUMN "date" DROP NOT NULL;
ALTER TABLE "WorkEntry" ADD COLUMN IF NOT EXISTS "common" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkEntry" ADD COLUMN IF NOT EXISTS "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "WorkEntry_workspaceId_common_idx" ON "WorkEntry" ("workspaceId", "common");

COMMIT;
