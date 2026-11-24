-- CreateTable
CREATE TABLE "CreatorProgram" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applicationSourceId" TEXT,
    "registrationSourceId" TEXT,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "utm" JSONB NOT NULL DEFAULT '{}',
    "roster" JSONB,
    "awards" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreatorProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorCandidate" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "invite" TEXT NOT NULL,
    "cells" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorParticipant" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "applicationId" TEXT,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "channels" JSONB NOT NULL DEFAULT '{}',
    "feeStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paidOn" TEXT,
    "owner" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "award" TEXT NOT NULL DEFAULT '',
    "awardOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreatorParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorMission" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "guide" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "platforms" TEXT[],
    "linkCount" INTEGER NOT NULL DEFAULT 1,
    "proof" TEXT NOT NULL DEFAULT 'optional',
    "draft" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CreatorMission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorAssignment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "history" JSONB NOT NULL DEFAULT '[]',
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreatorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorUpload" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorLink" (
    "code" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreatorLink_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProgram_projectId_key" ON "CreatorProgram"("projectId");

-- CreateIndex
CREATE INDEX "CreatorProgram_applicationSourceId_idx" ON "CreatorProgram"("applicationSourceId");

-- CreateIndex
CREATE INDEX "CreatorProgram_registrationSourceId_idx" ON "CreatorProgram"("registrationSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorCandidate_invite_key" ON "CreatorCandidate"("invite");

-- CreateIndex
CREATE INDEX "CreatorCandidate_programId_createdAt_idx" ON "CreatorCandidate"("programId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorParticipant_token_key" ON "CreatorParticipant"("token");

-- CreateIndex
CREATE INDEX "CreatorParticipant_applicationId_idx" ON "CreatorParticipant"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorParticipant_programId_applicationId_key" ON "CreatorParticipant"("programId", "applicationId");

-- CreateIndex
CREATE INDEX "CreatorMission_programId_dueAt_idx" ON "CreatorMission"("programId", "dueAt");

-- CreateIndex
CREATE INDEX "CreatorAssignment_participantId_idx" ON "CreatorAssignment"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAssignment_missionId_participantId_key" ON "CreatorAssignment"("missionId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorUpload_path_key" ON "CreatorUpload"("path");

-- CreateIndex
CREATE INDEX "CreatorUpload_assignmentId_createdAt_idx" ON "CreatorUpload"("assignmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorLink_participantId_platform_key" ON "CreatorLink"("participantId", "platform");

-- CreateIndex
CREATE INDEX "CollectRecord_sourceId_utmId_idx" ON "CollectRecord"("sourceId", "utmId");

-- AddForeignKey
ALTER TABLE "CreatorProgram" ADD CONSTRAINT "CreatorProgram_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProgram" ADD CONSTRAINT "CreatorProgram_applicationSourceId_fkey" FOREIGN KEY ("applicationSourceId") REFERENCES "CollectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProgram" ADD CONSTRAINT "CreatorProgram_registrationSourceId_fkey" FOREIGN KEY ("registrationSourceId") REFERENCES "CollectSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorCandidate" ADD CONSTRAINT "CreatorCandidate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "CreatorProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorParticipant" ADD CONSTRAINT "CreatorParticipant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "CreatorProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorParticipant" ADD CONSTRAINT "CreatorParticipant_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "CollectRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorMission" ADD CONSTRAINT "CreatorMission_programId_fkey" FOREIGN KEY ("programId") REFERENCES "CreatorProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAssignment" ADD CONSTRAINT "CreatorAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "CreatorMission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAssignment" ADD CONSTRAINT "CreatorAssignment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CreatorParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorUpload" ADD CONSTRAINT "CreatorUpload_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "CreatorAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorLink" ADD CONSTRAINT "CreatorLink_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CreatorParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Creator access is mediated by the app; no public PostgREST access.
ALTER TABLE "CreatorProgram" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorMission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreatorLink" ENABLE ROW LEVEL SECURITY;

-- Plain PostgreSQL installations do not have the Supabase storage schema.
DO $$
BEGIN
    IF to_regclass('storage.buckets') IS NOT NULL THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('creator-proof', 'creator-proof', false, 52428800,
                ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'])
        ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
    END IF;
END
$$;
