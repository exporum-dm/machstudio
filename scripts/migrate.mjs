import "dotenv/config";
import { config } from "dotenv";
import pg from "pg";

// 접속 정보는 코드에 적지 않는다 — .env.local 의 DATABASE_URL 을 쓴다(레포에 비밀번호가 남지 않게).
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 환경변수가 없어요");
  process.exit(1);
}
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "../supabase/migrations/init.sql"), "utf-8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log("✓ Connected to Supabase");
  await client.query(sql);
  console.log("✓ Migration applied successfully");
} catch (err) {
  console.error("✗ Migration failed:", err.message);
} finally {
  await client.end();
}
