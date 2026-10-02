/**
 * 이미 들어온 등록에 **중복 판정용 이메일(emailNormalized)** 을 채워 넣는다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────
 * 중복 등록 차단은 `(sourceId, emailNormalized)` 부분 유니크에 기댄다(설계 §6.2). 그런데
 * emailNormalized 는 **제출 순간 폼에 '이메일' 유형 항목이 있을 때만** 채워진다. 운영자가 Email 칸을
 * '텍스트' 로 만들었다가 나중에 '이메일' 로 고치면, 그 전에 들어온 등록은 비어 있는 채로 남아
 * **같은 이메일로 또 등록해도 막히지 않는다**(2026-10-02 원데이클래스 실제 사례).
 *
 * 그래서 폼 정의를 저장할 때마다 비어 있는 등록만 골라 채운다. 대부분은 0건이라 비용이 거의 없다.
 * 같은 이메일이 이미 있으면(=이미 중복 등록된 상태) 채우지 않고 건수만 알려 준다 — 어느 쪽을 남길지는
 * 사람이 정한다(지우지 않는다).
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, isValidCollectEmail } from "@/lib/collect-email";
import { primaryFieldKey } from "@/lib/collect-submit";
import type { CollectFormConfig } from "@/lib/collect-form-config";

export async function backfillEmailNormalized(
  sourceId: string,
  config: CollectFormConfig,
): Promise<{ filled: number; duplicates: number }> {
  if (!config.fields.some((f) => f.type === "email")) return { filled: 0, duplicates: 0 };

  const rows = await prisma.collectRecord.findMany({
    where: { sourceId, emailNormalized: null },
    select: { id: true, data: true },
    take: 5000,
  });

  let filled = 0;
  let duplicates = 0;
  for (const row of rows) {
    const data = (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>;
    const key = primaryFieldKey(config, data, "email");
    const email = key ? normalizeEmail(data[key]) : null;
    if (!email || !isValidCollectEmail(email)) continue;
    try {
      await prisma.collectRecord.update({ where: { id: row.id }, data: { emailNormalized: email } });
      filled++;
    } catch (e) {
      if (typeof e === "object" && e && "code" in e && e.code === "P2002") duplicates++;
      else throw e;
    }
  }
  return { filled, duplicates };
}
