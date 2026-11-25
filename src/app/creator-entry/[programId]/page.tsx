import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { buildStkCss } from "@/lib/stk-css";
import { prisma } from "@/lib/prisma";
import { getPublicAppOrigin } from "@/lib/app-url";
import { creatorEntryCookie } from "@/lib/creator/entry";
import { loadPortal } from "@/lib/creator/portal";
import { CreatorEntry } from "@/components/creator/CreatorEntry";
import { CreatorPortal } from "@/components/creator/CreatorPortal";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CreatorEntryPage({ params, searchParams }: {
  params: Promise<{ programId: string }>; searchParams: Promise<{ preview?: string; entryError?: string }>;
}) {
  const [{ programId }, query] = await Promise.all([params, searchParams]);
  if (query.preview !== undefined) notFound();
  const [program, jar] = await Promise.all([
    prisma.creatorProgram.findFirst({
      where: { id: programId, deletedAt: null, project: { deletedAt: null, workspace: { deletedAt: null } } },
      select: { name: true },
    }), cookies(),
  ]);
  if (!program) notFound();
  const token = jar.get(creatorEntryCookie)?.value ?? "";
  const data = await loadPortal(token, programId);

  return <main className="stk-live min-h-dvh bg-[var(--card-2)] px-4 py-8 sm:py-14">
    <style>{buildStkCss("#4338ca", "#171729", "#ffffff")}</style>
    {data ? <>
      <CreatorEntry key="exit" programId={programId} programName={program.name} entered />
      <CreatorPortal token={token} data={JSON.parse(JSON.stringify(data))} origin={getPublicAppOrigin()} preview={false} />
    </> : <CreatorEntry key="entry" programId={programId} programName={program.name} error={query.entryError === "limit"
      ? "입력 횟수를 초과했어요. 잠시 후 다시 시도해 주세요."
      : query.entryError ? "이 이메일로 활동 페이지를 열 수 없어요. 운영자에게 등록 주소를 확인해 주세요." : undefined} />}
  </main>;
}
