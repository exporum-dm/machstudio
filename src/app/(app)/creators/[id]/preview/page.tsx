import { notFound } from "next/navigation";
import Link from "next/link";
import { CreatorPortal } from "@/components/creator/CreatorPortal";
import { button } from "@/components/creator/ui";
import { buildStkCss } from "@/lib/stk-css";
import { CreatorError, getCreatorProgram } from "@/lib/creator/server";
import { prisma } from "@/lib/prisma";

export default async function CreatorPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getCreatorProgram(id).catch((error: unknown) => {
    if (error instanceof CreatorError) notFound();
    throw error;
  });
  const program = await prisma.creatorProgram.findUniqueOrThrow({
    where: { id: auth.programId },
    select: { name: true, missions: { where: { archivedAt: null }, orderBy: { dueAt: "asc" } } },
  });

  return <div className="stk-live bg-[var(--card-2)] p-4 sm:p-8">
    <style>{buildStkCss("#4338ca", "#171729", "#ffffff")}</style>
    <div className="mx-auto mb-4 max-w-3xl"><Link href={"/creators/" + id} className={button}>회차로 돌아가기</Link></div>
    <CreatorPortal token="" preview data={{
      name: "테스트 크리에이터", confirmed: true, feeStatus: "unpaid", paidOn: null, driveFolder: null,
      program: { name: program.name }, promotionLinks: [], serverNow: 0,
      assignments: program.missions.map((mission) => ({
        id: mission.id, stage: mission.draft ? "draft" : "final", status: "todo", version: 0, history: [], uploads: [],
        mission: { ...mission, startsAt: mission.startsAt?.toISOString() ?? null, dueAt: mission.dueAt?.toISOString() ?? null },
      })),
    }} />
  </div>;
}
