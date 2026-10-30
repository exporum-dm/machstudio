-- 업무일지는 사람 계정이 지워져도 남는다(2026-10-30).
--
-- 지금까지 WorkEntry.authorId 는 User 를 ON DELETE CASCADE 로 물고 있어서, 슈퍼어드민이 퇴사자 계정을
-- 지우면(admin/actions.ts deleteUserAction) 그 사람이 적은 일지가 전부 같이 지워졌다.
-- 지난 주간 보고의 근거가 사라지고, 다른 사람 칸에 대신 적어 준 줄까지 날아간다.
--
-- 바꾸는 것:
--   1) authorName — 칸 주인 이름을 줄마다 적어 둔다(계정이 사라져도 "누구 칸"인지 보이게). 기존 줄은 지금 이름으로 채운다.
--   2) authorId → User 외래키를 뗀다. authorId 는 그대로 남아 칸(열)을 가르는 열쇠로 쓰인다.
--      "이 워크스페이스 멤버여야 한다"는 검사는 원래 API 가 하고 있다(entries/route.ts memberIn).
-- 지우는 것도, 바꾸는 값도 없다 — 열 하나 추가 + 제약 하나 제거.
BEGIN;

ALTER TABLE "WorkEntry" ADD COLUMN IF NOT EXISTS "authorName" TEXT NOT NULL DEFAULT '';

UPDATE "WorkEntry" e
   SET "authorName" = COALESCE(NULLIF(u."name", ''), split_part(u."email", '@', 1))
  FROM "User" u
 WHERE u."id" = e."authorId"
   AND e."authorName" = '';

ALTER TABLE "WorkEntry" DROP CONSTRAINT IF EXISTS "WorkEntry_authorId_fkey";

COMMIT;
