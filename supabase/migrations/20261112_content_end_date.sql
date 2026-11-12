-- 콘텐츠 캘린더 기간 — 시작일(date)~종료일(endDate)을 이어진 막대로 보여 준다.
-- NULL = 하루짜리(기존 항목 전부). 되돌리기: ALTER TABLE "ContentItem" DROP COLUMN "endDate";
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "endDate" DATE;
