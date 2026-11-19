"use client";

import { useCallback } from "react";
import { PreviewFrame } from "@/components/ui/PreviewFrame";
import { mountNotice } from "@/lib/notice/mount";
import type { NoticeCompetition } from "@/lib/notice/types";

/**
 * 공고 옆칸 미리보기.
 *
 * 임베드와 **같은 mountNotice** 를 쓴다 — 어드민에서 React 로 다시 그리면 "미리보기에서는
 * 괜찮았는데"가 반드시 생긴다(공고·신청 폼 모두 같은 원칙).
 *
 * 다른 미리보기들과 달리 **URL 이 아니라 직접 그린다.** 저장을 기다리지 않기 위해서다:
 * 편집 중인 config 를 그대로 넘겨 즉시 다시 마운트한다. 웨비나 랜딩 미리보기는 저장 뒤
 * 새로고침이라 색 하나 보려고 저장을 눌러야 했는데, 그게 편집 리듬을 끊는다.
 *
 * 프레임·축소·기기 토글은 PreviewFrame 이 갖는다(투표·결과 미리보기와 같은 껍데기).
 */
export default function NoticePreviewPane({
  competition,
  config,
  locale,
}: {
  competition: NoticeCompetition;
  config: unknown;
  locale?: string;
}) {
  const onMount = useCallback(
    (doc: Document) => {
      const handle = mountNotice({
        mount: doc.body,
        competition,
        config,
        locale,
        embedded: false,
        isPreview: true,
        // 미리보기에서 신청을 눌러도 아무 일도 없어야 한다 — 여기서 참가작이 생기면 안 된다.
        onApply: () => {},
        // 목차는 position:fixed 다. 좁은 미리보기 폭에서 본문을 가리므로 끈다.
        attachToc: false,
      });
      return () => handle.destroy();
    },
    [competition, config, locale],
  );

  return <PreviewFrame title="미리보기" onMount={onMount} note="편집 중인 내용이 저장 전에도 바로 보여요" />;
}
