-- 재실행 안전. 이 저장소는 배포가 마이그레이션을 적용하지 않아 DDL을 손으로 넣는다.
ALTER TABLE "CreatorParticipant" ADD COLUMN IF NOT EXISTS "withdrawnAt" TIMESTAMP(3);
