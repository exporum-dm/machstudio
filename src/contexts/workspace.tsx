"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";

interface Project {
  id: string;
  name: string;
  description: string | null;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role?: string;
  /**
   * 등록 폼 약관 전문 템플릿 — 웨비나가 자기 값을 비워 두면 이 값을 상속한다.
   * 목록 API(/api/workspace)에는 없고 상세(/api/workspace/[id])에만 있어 optional 이다.
   */
  privacyBodyTemplate?: string | null;
  marketingBodyTemplate?: string | null;
  /** 법률 문구 생성기의 조직 정보(회사명·주소·담당 이메일) — WorkspaceLegalProfile 모양. */
  legalProfile?: unknown;
  /** 유입경로 도넛 차트 채널별 사용자 지정 색 — { "네이버": "#hex", ... }. 목록 API에는 없음. */
  channelColors?: unknown;
}

interface WorkspaceContextType {
  expoHomepageEnabled?: boolean;
  workspace: Workspace | null;
  workspaces: Workspace[];
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (project: Project) => void;
  switchWorkspace: (workspace: Workspace) => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshWorkspaces: () => Promise<Workspace[]>;
  isLoading: boolean;
  /**
   * 초기 워크스페이스 목록 로드가 실패했는지(네트워크·5xx). "워크스페이스 0개"와 다른 상태 —
   * workspaces 가 비어 있어도 이 값이 true 면 실제로는 못 불러온 것뿐이니 gate 가 "새로
   * 만들기" 화면을 띄우면 안 된다.
   */
  loadError: boolean;
  /** loadError 상태에서 재시도할 때 호출 — 마운트 시 초기 로드와 동일한 로직을 다시 수행한다. */
  loadWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children, expoHomepageEnabled = false }: { children: ReactNode; expoHomepageEnabled?: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProjectState] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const switchSequence = useRef(0);

  const setCurrentProject = (project: Project) => {
    setCurrentProjectState(project);
    localStorage.setItem("currentProjectId", project.id);
  };

  const applyProjects = (newProjects: Project[]) => {
    setProjects(newProjects);
    const savedId = localStorage.getItem("currentProjectId");
    const saved = newProjects.find((p) => p.id === savedId);
    setCurrentProjectState(saved ?? newProjects[0] ?? null);
  };

  const refreshProjects = useCallback(async () => {
    const currentWsId = localStorage.getItem("currentWorkspaceId");
    const url = currentWsId ? `/api/workspace/${currentWsId}` : "/api/workspace";
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data.workspace) setWorkspace(data.workspace);
      if (data.workspaces) setWorkspaces(data.workspaces);
      applyProjects(data.projects ?? []);
    } catch {
      // 네트워크 오류 — 직전 저장이 성공했더라도 여기서 던지면 호출부의 성공 처리(토스트 등)를
      // 덮어써 "실패했다"고 오인시킨다. 기존 프로젝트 목록을 그대로 두고 조용히 넘어간다.
    }
  }, []);

  // 워크스페이스 목록만 다시 가져오기 — 워크스페이스 생성/삭제 후 즉시 반영용.
  const refreshWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace");
      if (!res.ok) return [];
      const data = await res.json();
      const list: Workspace[] = data.workspaces ?? [];
      setWorkspaces(list);
      // 현재 선택된 워크스페이스가 사라졌으면 첫 번째로 전환.
      const currentWsId = localStorage.getItem("currentWorkspaceId");
      const stillExists = list.find((w) => w.id === currentWsId);
      if (!stillExists && list.length > 0) {
        localStorage.setItem("currentWorkspaceId", list[0].id);
        localStorage.removeItem("currentProjectId");
        setWorkspace(list[0]);
        const wsRes = await fetch(`/api/workspace/${list[0].id}`);
        if (wsRes.ok) {
          const wsData = await wsRes.json();
          applyProjects(wsData.projects ?? []);
        }
      } else if (list.length === 0) {
        setWorkspace(null);
        setProjects([]);
        setCurrentProjectState(null);
      }
      return list;
    } catch {
      // 네트워크 오류 — 호출부(초대 수락 등)의 본 작업은 이미 끝났을 수 있으니 여기서 던져
      // 그 성공 처리를 막지 않는다. 목록 갱신만 다음 기회로 미룬다.
      return [];
    }
  }, []);

  const switchWorkspace = useCallback(async (ws: Workspace) => {
    const sequence = ++switchSequence.current;
    localStorage.setItem("currentWorkspaceId", ws.id);
    localStorage.removeItem("currentProjectId");
    setWorkspace(ws);
    setProjects([]);
    setCurrentProjectState(null);
    try {
      const [wsListRes, wsRes] = await Promise.all([
        fetch("/api/workspace"),
        fetch(`/api/workspace/${ws.id}`),
      ]);
      if (sequence !== switchSequence.current) return;
      if (wsListRes.ok) {
        const listData = await wsListRes.json();
        setWorkspaces(listData.workspaces ?? []);
      }
      if (!wsRes.ok) return;
      const data = await wsRes.json();
      if (sequence !== switchSequence.current) return;
      applyProjects(data.projects ?? []);
    } catch {
      // 네트워크 오류 — 전환 자체(선택된 워크스페이스, localStorage)는 이미 반영됐고
      // 상세 데이터만 못 가져온 상태. 다음 refreshProjects 등에서 다시 채워진다.
    }
  }, []);

  // 초기 워크스페이스 목록 로드 — 마운트 시 1회, 그리고 loadError 상태에서 재시도할 때 재사용.
  // 목록 자체(list)를 못 가져온 경우만 loadError 로 표시한다 — 저장된 워크스페이스의 상세
  // 정보를 못 가져온 건 별개 문제라(목록은 이미 확보했으니) loadError 를 건드리지 않는다.
  const loadWorkspaces = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/workspace");
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);

      const savedWsId = localStorage.getItem("currentWorkspaceId");
      const savedWs = (data.workspaces ?? []).find((w: Workspace) => w.id === savedWsId);
      const activeWs = savedWs ?? data.workspace;
      if (!activeWs) return;

      setWorkspace(activeWs);
      if (activeWs.id === data.workspace?.id) {
        applyProjects(data.projects ?? []);
        return;
      }
      try {
        const wsRes = await fetch(`/api/workspace/${activeWs.id}`);
        if (!wsRes.ok) return;
        const wsData = await wsRes.json();
        applyProjects(wsData.projects ?? []);
      } catch {
        // 무시 — 워크스페이스 목록은 이미 확보됐다.
      }
    } catch {
      // 목록 자체를 못 불러온 경우 — "워크스페이스 0개"로 위장되지 않도록 표시.
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces().finally(() => setIsLoading(false));
  }, [loadWorkspaces]);

  // 마지막 활동 시각 갱신 — 하루 1회만 (localStorage throttle). 세션 유지 사용자의
  // 실제 접속을 추적하기 위함 (last_sign_in_at은 명시적 로그인만 갱신됨).
  useEffect(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem("mach_heartbeat") !== today) {
        fetch("/api/heartbeat", { method: "POST" })
          .then((r) => { if (r.ok) localStorage.setItem("mach_heartbeat", today); })
          .catch(() => {});
      }
    } catch {}
  }, []);

  return (
    <WorkspaceContext.Provider value={{
      expoHomepageEnabled,
      workspace, workspaces, projects, currentProject,
      setCurrentProject, switchWorkspace, refreshProjects, refreshWorkspaces, isLoading,
      loadError, loadWorkspaces,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
