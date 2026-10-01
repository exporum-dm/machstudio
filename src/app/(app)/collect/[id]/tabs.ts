/**
 * 수집 소스 상세 화면의 탭 구성 — **방식에 따라 갈린다**(설계 §3.1).
 *
 * 별도 모듈인 이유: 페이지 본문이 2,000줄 넘는 클라이언트 컴포넌트라 테스트가 가져올 수 없다.
 * 이 판정은 **연동형 화면을 그대로 두는가**를 결정하므로(레코드 52,000건이 그 화면으로
 * 운영 중이다) 회귀 테스트가 붙을 수 있는 자리에 있어야 한다.
 */
import { Activity, Code2, HardDriveDownload, Info, ScanLine, Settings2, Shield, Table2, Wrench, type LucideIcon } from "lucide-react";

export const TABS = [
  { id: "info", label: "기본 정보", icon: Info },
  { id: "records", label: "수집 데이터", icon: Table2 },
  { id: "form", label: "등록 폼", icon: Settings2 },
  { id: "checkin", label: "현장 체크인", icon: ScanLine },
  { id: "fields", label: "필드", icon: Settings2 },
  { id: "script", label: "스크립트", icon: Code2 },
  { id: "install", label: "설치", icon: Wrench },
  { id: "settings", label: "설정", icon: Shield },
  { id: "data-mgmt", label: "데이터 관리", icon: HardDriveDownload },
  { id: "activity", label: "활동", icon: Activity },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: LucideIcon }>;

export type Tab = typeof TABS[number]["id"];

/** 연동형에만 있는 탭 — 빌더형은 폼을 여기서 만드니 스크립트·매핑·설치가 의미를 잃는다. */
const CAPTURE_ONLY: ReadonlySet<Tab> = new Set(["fields", "script", "install"]);
/** 빌더형에만 있는 탭 — 현장 체크인은 등록번호·QR 이 있어야 한다(연동형 레코드에는 없다). */
const BUILDER_ONLY: ReadonlySet<Tab> = new Set(["form", "checkin"]);

/**
 * 안 쓰는 탭을 남겨 두면 운영자가 "여기서 뭘 해야 하나" 를 매번 다시 판단하게 된다.
 * 모르는 mode 는 **연동형으로 떨어뜨린다** — mode 는 DB 에서 제약 없는 String 이라
 * 예상 못 한 값이 들어와도 기존 화면이 그대로 나와야 한다.
 */
export function tabsFor(mode: string): Array<typeof TABS[number]> {
  const builder = mode === "builder";
  return TABS.filter((t) => (builder ? !CAPTURE_ONLY.has(t.id) : !BUILDER_ONLY.has(t.id)));
}
