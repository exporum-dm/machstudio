-- 선발자·신청서 표의 열 배치(순서·숨김·너비). 순수 추가라 재실행해도 안전하다.
ALTER TABLE "CreatorProgram" ADD COLUMN IF NOT EXISTS "tableLayout" JSONB NOT NULL DEFAULT '{}';
