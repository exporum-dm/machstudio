-- 웨비나 사전등록 폼 — 개인정보 제3자 제공 동의 컬럼 추가. 2026-10-29
--
-- CompetitionEntry.agreeThirdParty(supabase/migrations/20260820_legal_templates.sql)와 같은 이유로
-- 둔다 — privacy/marketing 은 항상 있지만 제3자 제공은 쓰는 웨비나만 켠다(config.registrationForm.
-- thirdPartyEnabled). 추가만 한다. 재실행 안전.

ALTER TABLE "WebinarRegistration" ADD COLUMN IF NOT EXISTS "agreeThirdParty" BOOLEAN NOT NULL DEFAULT false;
