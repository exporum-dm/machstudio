-- 콘텐츠 캘린더를 노션 "DM 업무 관리 › 콘텐츠" 구조에 맞춘다(2026-11-03) — 순수 추가.
--
-- formats   : 형식 여러 개(노션 multi_select). 예전 format(한 개)을 대신한다.
-- campaign  : 캠페인(사전등록 유도·티켓 판매 …)
-- assignees : 담당자 여러 명 [{ id: userId | null, name }]. id 없는 것 = 계정 없는 사람(퇴사자 등) — 이름만 남긴다.
--             예전 assigneeId/assigneeName(한 명)을 대신한다.
-- notionId  : 노션에서 가져온 항목의 페이지 id — 다시 가져와도 겹치지 않게(unique).
-- sourceUrl : 노션 원본 주소(첨부 파일은 노션에 남아 있다).
-- 상태는 노션 7단계로: waiting 대기 · planning 기획 중 · doing 진행 중 · design 디자인 중 · confirm 컨펌 대기 · done 완료 · stopped 중단.
--
-- 예전 칸(format, assigneeId, assigneeName)은 지우지 않는다 — 배포 전 코드가 읽는 동안 깨지지 않게. 새 코드는 쓰지 않는다.
-- 재실행 안전.

BEGIN;

ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "formats"   TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "campaign"  TEXT   NOT NULL DEFAULT '';
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "assignees" JSONB  NOT NULL DEFAULT '[]';
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "notionId"  TEXT;
ALTER TABLE "ContentItem" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT   NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_notionId_key" ON "ContentItem" ("notionId");

-- 예전 값 옮기기(한 번만 — 새 칸이 비어 있을 때)
UPDATE "ContentItem" SET "formats" = ARRAY["format"] WHERE "format" <> '' AND "formats" = '{}';
UPDATE "ContentItem" SET "assignees" = jsonb_build_array(jsonb_build_object('id', "assigneeId", 'name', "assigneeName"))
  WHERE "assigneeId" IS NOT NULL AND "assignees" = '[]'::jsonb;
UPDATE "ContentItem" SET "status" = CASE "status"
    WHEN 'idea' THEN 'waiting'
    WHEN 'draft' THEN 'doing'
    WHEN 'review' THEN 'confirm'
    WHEN 'scheduled' THEN 'confirm'
    WHEN 'published' THEN 'done'
    ELSE "status" END
  WHERE "status" IN ('idea', 'draft', 'review', 'scheduled', 'published');
ALTER TABLE "ContentItem" ALTER COLUMN "status" SET DEFAULT 'waiting';

COMMIT;
