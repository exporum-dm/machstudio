-- 사전등록 현장 체크인 — QR(등록번호)을 스캔하면 입장 시각을 쌓는다(설계 §12 를 휴대폰 온라인 스캔으로).
-- 추가만 한다. 기존 행·열은 건드리지 않는다.
BEGIN;

-- 소스별 켜고 끄기 · 운영요원 링크(토큰) · 4자리 PIN 해시 · 일자 판정 시간대
ALTER TABLE "CollectSource" ADD COLUMN IF NOT EXISTS "checkinEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CollectSource" ADD COLUMN IF NOT EXISTS "checkinToken"    TEXT;
ALTER TABLE "CollectSource" ADD COLUMN IF NOT EXISTS "checkinPinHash"  TEXT;
ALTER TABLE "CollectSource" ADD COLUMN IF NOT EXISTS "checkinTimezone" TEXT NOT NULL DEFAULT 'Asia/Seoul';
CREATE UNIQUE INDEX IF NOT EXISTS "CollectSource_checkinToken_key" ON "CollectSource"("checkinToken");

-- 스캔 한 번 = 한 행. 재스캔도 전부 남긴다(운영 결정 2026-10-01). 순방문은 집계에서 거른다.
CREATE TABLE IF NOT EXISTS "CollectCheckIn" (
  "id"         TEXT PRIMARY KEY,
  "sourceId"   TEXT NOT NULL,
  "recordId"   TEXT NOT NULL,
  -- 행사 시간대 기준 날짜 "2026-10-22" — 일자별 입장 집계 키
  "eventDate"  TEXT NOT NULL,
  "scannedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- camera(휴대폰 카메라) · scanner(바코드 스캐너) · manual(번호 직접 입력)
  "method"     TEXT NOT NULL DEFAULT 'camera',
  -- 운영요원이 스캔 화면에 적은 이름·입구(예: "입구 A") — 선택
  "staffLabel" TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "CollectCheckIn_sourceId_scannedAt_idx" ON "CollectCheckIn"("sourceId", "scannedAt");
CREATE INDEX IF NOT EXISTS "CollectCheckIn_sourceId_eventDate_idx" ON "CollectCheckIn"("sourceId", "eventDate");
CREATE INDEX IF NOT EXISTS "CollectCheckIn_recordId_idx" ON "CollectCheckIn"("recordId");

DO $$ BEGIN
  ALTER TABLE "CollectCheckIn" ADD CONSTRAINT "CollectCheckIn_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "CollectSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CollectCheckIn" ADD CONSTRAINT "CollectCheckIn_recordId_fkey"
    FOREIGN KEY ("recordId") REFERENCES "CollectRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 다른 테이블과 같이 RLS 를 켜 둔다(정책 0개 = 공개 키로는 0건). 앱은 서버에서만 읽는다.
ALTER TABLE "CollectCheckIn" ENABLE ROW LEVEL SECURITY;

COMMIT;
