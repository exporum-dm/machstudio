import { Prisma } from "@/generated/prisma";
import { domesticRegistrationNo } from "@/lib/collect-registration-no";

/** 등록 INSERT와 같은 트랜잭션에서 발급한다. 등록 실패 시 카운터도 롤백한다. */
export async function nextDomesticRegistrationNo(tx: Prisma.TransactionClient, prefix: string) {
  if (!/^[0-9]{2}$/.test(prefix)) throw new Error("접두번호는 숫자 2자리로 입력하세요");
  const updated = await tx.$queryRaw<Array<{lastValue:number}>>(Prisma.sql`
    UPDATE "CollectRegistrationCounter" SET "lastValue" = "lastValue" + 1
    WHERE prefix = ${prefix} AND "lastValue" < 999999 RETURNING "lastValue"`);
  if (updated.length) return domesticRegistrationNo(prefix,updated[0].lastValue);
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>(Prisma.sql`
    INSERT INTO "CollectRegistrationCounter" (prefix, "lastValue")
    SELECT ${prefix}, last + 1 FROM (
      SELECT COALESCE(MAX(RIGHT("registrationNo",6)::int),0) AS last FROM "CollectRecord"
      WHERE "registrationNo" >= ${prefix+"000001"} AND "registrationNo" <= ${prefix+"999999"}
        AND "registrationNo" ~ '^[0-9]{8}$'
    ) existing WHERE last < 999999
    ON CONFLICT (prefix) DO UPDATE SET "lastValue" = GREATEST(
      "CollectRegistrationCounter"."lastValue", EXCLUDED."lastValue" - 1
    ) + 1
    WHERE "CollectRegistrationCounter"."lastValue" < 999999
    RETURNING "lastValue"`);
  if (!rows.length) throw new Error("등록번호 발급 한도에 도달했어요");
  return domesticRegistrationNo(prefix, rows[0].lastValue);
}
