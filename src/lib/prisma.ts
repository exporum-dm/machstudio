import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

function createPrismaClient() {
  // max: 2 — 인스턴스당 DB 연결 상한. pg 기본값(10)을 쓰면 live-state 의 Promise.all(쿼리 9개)이
  // 첫 요청에서 풀을 10까지 벌리고 웜인 동안 쥐고 있어, Supavisor client 한도 200 ÷ 10 = 웜 인스턴스
  // 20개가 천장이 된다 — 2026-08-11 라이브(시청자 91명)에서 실제로 (EMAXCONN) 로 터진 값.
  // 인스턴스당 연결을 두 개로 제한하고, 유휴 연결은 함수가 중단되기 전에 반환한다.
  const ca = process.env.DATABASE_CA_CERT_BASE64;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 2,
    idleTimeoutMillis: 1000,
    ...(ca && {
      ssl: { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true },
    }),
  });
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
