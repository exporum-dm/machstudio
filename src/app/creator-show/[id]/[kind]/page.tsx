import { notFound } from "next/navigation";
import { CreatorPublication } from "@/components/creator/Publication";
import { isPublicationKind, loadPublication } from "@/lib/creator/publication-server";
import { ReportFrameHeight } from "@/components/creator/ReportFrameHeight";

export const metadata = { robots: { index: false, follow: true }, referrer: "no-referrer" };

export default async function PublicCreatorAnnouncement({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isPublicationKind(kind)) notFound();
  const publication = await loadPublication(id, kind);
  if (!publication) return <ReportFrameHeight empty />;
  return <><CreatorPublication publication={publication} awards={kind === "awards"} /><ReportFrameHeight /></>;
}
