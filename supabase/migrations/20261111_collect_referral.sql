-- 등록 폼 친구 초대(추천) — 등록자마다 추천 코드, 누구의 추천으로 왔는지.
-- 컬럼만 더한다(기존 행은 둘 다 NULL). 기능은 폼 설정(formConfig.referral.enabled)으로 켠다.
ALTER TABLE "CollectRecord" ADD COLUMN IF NOT EXISTS "shareCode" TEXT;
ALTER TABLE "CollectRecord" ADD COLUMN IF NOT EXISTS "referredById" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CollectRecord_shareCode_key" ON "CollectRecord" ("shareCode");
CREATE INDEX IF NOT EXISTS "CollectRecord_sourceId_referredById_idx" ON "CollectRecord" ("sourceId", "referredById");

-- 추천한 등록자를 지우면 추천 관계만 끊는다(추천으로 들어온 사람의 등록은 남는다).
DO $$ BEGIN
  ALTER TABLE "CollectRecord"
    ADD CONSTRAINT "CollectRecord_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "CollectRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
