-- Meta 토큰 수명 기록 — 연동이 60일마다 저절로 풀리는 것을 막기 위한 칸들.
--
-- tokenKind            Meta 가 알려 주는 종류. "SYSTEM_USER" 는 만료가 없어 연장을 안 한다.
-- tokenExpiresAt       debug_token 의 expires_at. 25일 남으면 매일 연장을 시도한다.
-- dataAccessExpiresAt  데이터 접근 만료(90일) — 연장으로 늘지 않아 미리 예고해야 한다.
-- tokenCheckedAt       마지막 점검 시각.
-- tokenRefreshedAt     마지막으로 만료가 실제로 뒤로 밀린 시각.
--
-- 전부 NULL 허용(또는 기본값)이라 기존 연결은 동작이 그대로다 — 첫 점검이 돌면 채워진다.
-- 이 저장소는 배포 때 마이그레이션을 돌리지 않는다. 이 DDL 은 **배포 전에 손으로** 적용한다.
ALTER TABLE "MetaAdConnection" ADD COLUMN IF NOT EXISTS "tokenKind" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "MetaAdConnection" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "MetaAdConnection" ADD COLUMN IF NOT EXISTS "dataAccessExpiresAt" TIMESTAMP(3);
ALTER TABLE "MetaAdConnection" ADD COLUMN IF NOT EXISTS "tokenCheckedAt" TIMESTAMP(3);
ALTER TABLE "MetaAdConnection" ADD COLUMN IF NOT EXISTS "tokenRefreshedAt" TIMESTAMP(3);
