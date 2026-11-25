-- 발굴 후보 행을 끌어서 순서를 바꾼다. 순수 추가라 재실행해도 안전하다.
ALTER TABLE "CreatorCandidate" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "CreatorCandidate_programId_position_createdAt_idx"
  ON "CreatorCandidate"("programId", "position", "createdAt");
