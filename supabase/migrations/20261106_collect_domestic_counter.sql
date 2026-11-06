CREATE TABLE IF NOT EXISTS "CollectRegistrationCounter" (
  "prefix" TEXT PRIMARY KEY CHECK ("prefix" ~ '^[0-9]{2}$'),
  "lastValue" INTEGER NOT NULL DEFAULT 0 CHECK ("lastValue" BETWEEN 0 AND 999999)
);
ALTER TABLE "CollectRegistrationCounter" ENABLE ROW LEVEL SECURITY;
