"use client";

import Link from "next/link";
import { useWorkspace } from "@/contexts/workspace";
import { Empty, panel, primary } from "@/components/creator/ui";

export default function CreatorsIndex() {
  const { currentProject, projects, isLoading } = useWorkspace();
  return <div className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-8">
    <header><h1 className="text-2xl font-semibold tracking-tight">크리에이터 관리</h1>
      <p className="mt-1 text-sm text-muted-foreground">프로젝트의 모집·미션·성과를 관리하세요.</p></header>
    {isLoading ? <Empty>프로젝트를 불러오는 중이에요.</Empty> : projects.length ? <ul className="grid gap-3 sm:grid-cols-2">
      {[...projects].sort((a, b) => Number(b.id === currentProject?.id) - Number(a.id === currentProject?.id)).map((project) => (
        <li key={project.id} className={panel + " flex flex-wrap items-center justify-between gap-3"}>
          <h2 className="break-words font-semibold">{project.name}</h2>
          <Link href={"/creators/" + project.id} className={primary}>열기<span className="sr-only"> {project.name}</span></Link>
        </li>
      ))}
    </ul> : <Empty>프로젝트를 만든 뒤 크리에이터 관리를 시작하세요.</Empty>}
  </div>;
}
