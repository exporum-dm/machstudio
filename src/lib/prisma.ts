import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  // max: 2 — 인스턴스당 DB 연결 상한. pg 기본값(10)을 쓰면 live-state 의 Promise.all(쿼리 9개)이
  // 첫 요청에서 풀을 10까지 벌리고 웜인 동안 쥐고 있어, Supavisor client 한도 200 ÷ 10 = 웜 인스턴스
  // 20개가 천장이 된다 — 2026-08-11 라이브(시청자 91명)에서 실제로 (EMAXCONN) 로 터진 값.
  // 2로 줄이면 천장이 100 인스턴스로 5배. Promise.all 은 풀이 알아서 2개씩 큐잉하므로 코드 변경 불필요,
  // 대가는 폴 응답 수십 ms 증가뿐. DATABASE_URL 쿼리스트링(connection_limit)은 드라이버 어댑터에선
  // 무시되므로 여기가 유일한 조절 지점이다.
  const ca = process.env.DATABASE_CA_CERT_BASE64;
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: 2,
    ...(ca && {
      ssl: { ca: Buffer.from(ca, "base64").toString("utf8"), rejectUnauthorized: true },
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
