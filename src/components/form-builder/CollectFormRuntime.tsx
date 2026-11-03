"use client";

/**
 * 등록 폼 런타임을 React 화면에 올리는 **얇은 껍데기**.
 *
 * 빌더 옆칸 미리보기와 미리보기 페이지(/p/{token})가 이걸 쓴다. 그리는 일은 전부
 * `mountCollectForm` 이 한다 — 임베드가 파트너 사이트에서 돌리는 바로 그 함수다.
 * React 로 한 벌 더 그리면 "미리보기에선 괜찮았는데" 가 반드시 생긴다(설계 §16.1).
 */
import { useEffect, useRef } from "react";
import { mountCollectForm } from "@/lib/collect-form/mount";
import type { CollectFormConfig, RegistrationStatus } from "@/lib/collect-form-config";

export function CollectFormRuntime({
  config,
  sourceId,
  locale,
  forceStatus,
  forceType,
  forcePhase,
  serverNow,
  preview = true,
}: {
  config: CollectFormConfig;
  sourceId: string;
  locale?: string;
  forceStatus?: RegistrationStatus;
  forceType?: string;
  /** 미리보기 "사전 마감" — 사전등록이 끝나고 현장등록 전 화면 */
  forcePhase?: "between";
  /**
   * 서버 시각(ISO). 없으면 검토자 기기 시계로 접수 창을 판정한다 — 시계가 틀어진 기기에서
   * "왜 마감으로 보이죠?" 라는 오해가 생기고, 그건 폼 설정 문제로 오인된다.
   */
  serverNow?: string;
  /** 기본이 미리보기다 — 이 컴포넌트를 쓰는 두 자리 모두 저장하면 안 되는 화면이다. */
  preview?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = mountCollectForm({
      mount: host,
      config,
      // 미리보기는 우리 오리진에서 열리므로 상대경로로 충분하다(중복확인 조회만 나간다).
      origin: "",
      sourceId,
      preview,
      forceStatus,
      forceType,
      forcePhase,
      locale,
      serverNow,
    });
    return () => handle.destroy();
    // config 는 빌더가 타이핑할 때마다 새 객체다 — 그때마다 다시 그리는 게 의도다(실시간 미리보기).
  }, [config, sourceId, locale, forceStatus, forceType, forcePhase, preview, serverNow]);

  return <div ref={hostRef} />;
}
