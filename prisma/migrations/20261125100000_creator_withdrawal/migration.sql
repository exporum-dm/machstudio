-- 선발 취소. 순수 추가이며 재실행해도 안전하다.
ALTER TABLE "CreatorParticipant" ADD COLUMN IF NOT EXISTS "withdrawnAt" TIMESTAMP(3);
