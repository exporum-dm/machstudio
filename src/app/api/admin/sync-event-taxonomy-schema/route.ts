/**
 * 1회용 — EventTaxonomy 에 프로젝트별 설치 체크리스트 컬럼을 실제 DB에 적용한다.
 * 이 프로젝트는 migrations 폴더를 안 쓰고(schema.prisma 를 직접 db push 하는 방식 — 과거 커밋에
 * WorkGroup·EventTaxonomy 테이블 자체도 migration 파일 없이 생겼다) DATABASE_URL 을 로컬에서
 * 못 구해 db push 를 돌릴 수 없어서, 앱 자신의 Prisma 커넥션으로 한 번 돌리는 용도다.
 * 각 구문은 독립적으로 시도하고 "이미 있음" 류 오류는 무시한다 — 재실행해도 안전하다.
 * 다 적용되고 나면 이 라우트는 지운다(2026-11-05 적용 직후 삭제 예정).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { prisma } from "@/lib/prisma";

const STATEMENTS = [
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "projectId" TEXT`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "groupId" TEXT`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "step" INTEGER`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "triggerCondition" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "content" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "className" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "tagged" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "EventTaxonomy" ADD COLUMN IF NOT EXISTS "note" TEXT NOT NULL DEFAULT ''`,
  `DROP INDEX IF EXISTS "EventTaxonomy_workspaceId_name_key"`,
  `CREATE INDEX IF NOT EXISTS "EventTaxonomy_workspaceId_name_idx" ON "EventTaxonomy"("workspaceId", "name")`,
  `CREATE INDEX IF NOT EXISTS "EventTaxonomy_workspaceId_projectId_groupId_sortOrder_idx" ON "EventTaxonomy"("workspaceId", "projectId", "groupId", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EventTaxonomy_workspace_name_global_key" ON "EventTaxonomy"("workspaceId", "name") WHERE "projectId" IS NULL`,
  `ALTER TABLE "EventTaxonomy" ADD CONSTRAINT "EventTaxonomy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "EventTaxonomy" ADD CONSTRAINT "EventTaxonomy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "WorkGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) return NextResponse.json({ error: "최고 관리자만 쓸 수 있어요" }, { status: 403 });

  const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push({ sql, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 이미 적용된 구문(제약 중복 등)은 재실행 시 정상 — 그 외는 실패로 보고한다.
      const alreadyExists = /already exists/i.test(message);
      results.push({ sql, ok: alreadyExists, error: alreadyExists ? undefined : message });
    }
  }
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ ok: failed.length === 0, results });
}
