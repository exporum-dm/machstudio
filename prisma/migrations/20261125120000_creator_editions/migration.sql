-- 크리에이터 프로그램을 회차 단위로 — 전시 하나에 여러 해를 쌓는다.
-- 순수 추가·제약 완화라 재실행해도 안전하다.

-- 프로젝트당 1개 제한 해제. 등록(CollectSource)이 프로젝트당 여러 개인 것과 같은 모양.
DROP INDEX IF EXISTS "CreatorProgram_projectId_key";

ALTER TABLE "CreatorProgram" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CreatorProgram" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CreatorProgram_projectId_createdAt_idx" ON "CreatorProgram"("projectId", "createdAt");

-- 선발 취소 컬럼(#94)이 손으로 적용되지 않은 환경을 위해 한 번 더 — IF NOT EXISTS 라 이미 있으면 그냥 지나간다.
ALTER TABLE "CreatorParticipant" ADD COLUMN IF NOT EXISTS "withdrawnAt" TIMESTAMP(3);
