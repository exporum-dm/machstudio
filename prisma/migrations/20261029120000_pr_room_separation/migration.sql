CREATE TABLE "PrRoom" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "collectEveryDays" INTEGER NOT NULL DEFAULT 3,
  "lastCollectedAt" TIMESTAMP(3),
  "keywords" JSONB NOT NULL DEFAULT '[]',
  "mentions" JSONB NOT NULL DEFAULT '[]',
  "pressReleases" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrRoom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrRoom_projectId_key" ON "PrRoom"("projectId");
CREATE INDEX "PrRoom_workspaceId_idx" ON "PrRoom"("workspaceId");
ALTER TABLE "PrRoom" ADD CONSTRAINT "PrRoom_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
