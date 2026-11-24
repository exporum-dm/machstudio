-- 안내 메일 발송 기록. 순수 추가이며 재실행해도 안전하다.
ALTER TABLE "CreatorParticipant" ADD COLUMN IF NOT EXISTS "lastEmailedAt" TIMESTAMP(3);
