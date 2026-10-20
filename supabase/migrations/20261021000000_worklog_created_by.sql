-- 업무일지 다른 사람 칸에도 쓰기(2026-10-21) — 누가 적었는지(createdById). 칸 주인은 authorId 그대로.
-- 순수 추가. 재실행 안전. prisma db push 는 쓰지 않는다.
ALTER TABLE "WorkEntry" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
