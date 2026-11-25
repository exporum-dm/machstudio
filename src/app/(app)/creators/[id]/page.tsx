import { notFound } from "next/navigation";
import { CreatorAdmin } from "@/components/creator/CreatorAdmin";
import { CreatorError, getCreatorProgram } from "@/lib/creator/server";

/**
 * `[id]` 는 **회차**다 — 이 메뉴가 만든 자원이지 프로젝트가 아니다(AGENTS.md「이 앱의 계층」).
 * 소속과 권한은 사이드바 컨텍스트가 아니라 URL 의 회차를 기준으로 서버에서 확인한다.
 */
export default async function CreatorEditionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getCreatorProgram(id).catch((error: unknown) => {
    if (error instanceof CreatorError) notFound();
    throw error;
  });
  return <CreatorAdmin key={auth.programId} programId={auth.programId} projectName={auth.project.name} />;
}
