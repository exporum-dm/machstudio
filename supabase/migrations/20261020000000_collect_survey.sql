-- 사전등록 연동 만족도 조사(2026-10-20).
--
-- Survey         : 사전등록 폼(CollectSource) 하나에 붙는 조사. 공개 주소 /q/{token} — 인쇄된 QR 이 가리키므로
--                  token 은 운영자가 직접 바꾸지 않는 한 그대로 둔다. 문항·분기·안내·완료 문구는 config(JSON).
-- SurveyResponse : 응답. 등록자는 이메일/전화로 본인 확인 → recordId 로 등록 정보(유형·성별·연령…)와 이어진다.
--                  같은 등록자는 1인 1응답(다시 내면 덮어쓴다). 등록 없이 참여(walk-in)는 recordId 가 비어 있다.
-- 순수 추가. 재실행 안전. prisma db push 는 쓰지 않는다.

BEGIN;

CREATE TABLE IF NOT EXISTS "Survey" (
    "id"          TEXT         NOT NULL,
    "sourceId"    TEXT         NOT NULL,
    "projectId"   TEXT         NOT NULL,
    "workspaceId" TEXT         NOT NULL,
    "name"        TEXT         NOT NULL,
    "token"       TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'draft',
    "config"      JSONB        NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Survey_token_key" ON "Survey" ("token");
CREATE INDEX IF NOT EXISTS "Survey_sourceId_idx" ON "Survey" ("sourceId");

CREATE TABLE IF NOT EXISTS "SurveyResponse" (
    "id"        TEXT         NOT NULL,
    "surveyId"  TEXT         NOT NULL,
    "recordId"  TEXT,
    "audience"  TEXT         NOT NULL DEFAULT '',
    "answers"   JSONB        NOT NULL DEFAULT '{}',
    "channel"   TEXT         NOT NULL DEFAULT '',
    "locale"    TEXT         NOT NULL DEFAULT '',
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyResponse_surveyId_recordId_key" ON "SurveyResponse" ("surveyId", "recordId");
CREATE INDEX IF NOT EXISTS "SurveyResponse_surveyId_createdAt_idx" ON "SurveyResponse" ("surveyId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Survey" ADD CONSTRAINT "Survey_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CollectSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "CollectRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
