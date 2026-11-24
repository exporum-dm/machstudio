import { notFound } from "next/navigation";
import { CreatorAdmin } from "@/components/creator/CreatorAdmin";
import { CreatorError, getCreatorProject } from "@/lib/creator/server";

export default async function CreatorProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project } = await getCreatorProject(projectId).catch((error: unknown) => {
    if (error instanceof CreatorError) notFound();
    throw error;
  });
  return <CreatorAdmin key={project.id} projectId={project.id} projectName={project.name} />;
}
