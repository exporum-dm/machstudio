ALTER TABLE "Survey"
  ADD COLUMN "aiSummary" TEXT,
  ADD COLUMN "aiInsights" JSONB,
  ADD COLUMN "aiGeneratedAt" TIMESTAMP(3);
