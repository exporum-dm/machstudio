ALTER TABLE "CreatorParticipant"
  ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "awardSelected" BOOLEAN;

ALTER TABLE "CreatorParticipant" ALTER COLUMN "awardSelected" SET DEFAULT false;
