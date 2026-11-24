"use client";

import { Loader2, UsersRound } from "lucide-react";
import { useWorkspace } from "@/contexts/workspace";
import { CreatorAdmin } from "@/components/creator/CreatorAdmin";

/**
 * 크리에이터 관리는 **사이드바에서 이미 고른 프로젝트**의 메뉴다. 여기서 프로젝트를 다시
 * 고르게 하지 않는다 — 워크스페이스 → 프로젝트(전시) → 메뉴 순서가 이 앱의 계층이고,
 * 메뉴 화면은 그 마지막 칸이다(등록·웨비나·광고 성과와 같은 모양).
 */
export default function CreatorsPage() {
  const { currentProject, isLoading } = useWorkspace();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="불러오는 중" />
    </div>;
  }

  if (!currentProject) {
    return <div className="flex h-64 flex-col items-center justify-center text-center">
      <UsersRound className="mb-3 h-10 w-10 text-muted-foreground/30" aria-hidden />
      <p className="text-sm text-muted-foreground">프로젝트를 먼저 선택해주세요</p>
    </div>;
  }

  return <CreatorAdmin key={currentProject.id} projectId={currentProject.id} projectName={currentProject.name} />;
}
