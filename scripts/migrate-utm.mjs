import "dotenv/config";
import { config } from "dotenv";
import pg from "pg";

// 접속 정보는 코드에 적지 않는다 — .env.local 의 DATABASE_URL 을 쓴다(레포에 비밀번호가 남지 않게).
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 환경변수가 없어요");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sql = `
CREATE TABLE IF NOT EXISTS "UTMLink" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "name"        TEXT,
  "url"         TEXT NOT NULL,
  "utmSource"   TEXT NOT NULL,
  "utmMedium"   TEXT NOT NULL,
  "utmCampaign" TEXT NOT NULL,
  "utmTerm"     TEXT,
  "utmContent"  TEXT,
  "fullUrl"     TEXT NOT NULL,
  "shortUrl"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UTMLink_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UTMLink"
  ADD CONSTRAINT "UTMLink_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UTMLink"
  ADD CONSTRAINT "UTMLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
`;

try {
  await client.connect();
  console.log("✓ Supabase 연결");
  await client.query(sql);
  console.log("✓ UTMLink 테이블 생성 완료");
} catch (err) {
  console.error("✗ 실패:", err.message);
} finally {
  await client.end();
}
