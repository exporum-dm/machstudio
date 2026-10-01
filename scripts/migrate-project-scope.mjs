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
-- UTMLink에 projectId 추가
ALTER TABLE "UTMLink" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- 기존 데이터가 있으면 null 허용 (새 레코드는 required)
-- Project 테이블 FK
ALTER TABLE "UTMLink"
  DROP CONSTRAINT IF EXISTS "UTMLink_projectId_fkey";

ALTER TABLE "UTMLink"
  ADD CONSTRAINT "UTMLink_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
`;

try {
  await client.connect();
  console.log("✓ 연결됨");
  await client.query(sql);
  console.log("✓ UTMLink에 projectId 컬럼 추가 완료");
} catch (err) {
  console.error("✗ 실패:", err.message);
} finally {
  await client.end();
}
