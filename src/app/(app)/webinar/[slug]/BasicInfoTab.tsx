"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";
import WebinarSchedulePicker, { EntryOpenField, type EntryOpenValue } from "@/components/webinar/WebinarSchedulePicker";
import { parseEntryOpenSetting } from "@/lib/webinar-status";
import { useAutosave, useExternalSync } from "@/components/ui/use-autosave";
import { useReportAutosave } from "@/components/ui/autosave-scope";
import { FIELD_CLS } from "@/components/ui/primitives";

interface Webinar {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  liveStartAt: string;
  liveEndAt: string;
  signupDeadline: string;
  components?: Record<string, unknown> | null;
}

// 만들기 › 원본 정보 안의 정체성(이름·설명) + 일정.
// 웨비나 삭제는 껍데기 ··· 메뉴가 소유한다(IA 문서: 파괴 액션은 만들기 밖으로).
export default function BasicInfoTab({ webinar, onSilentUpdate, embedded }: {
  webinar: Webinar;
  onSilentUpdate: () => void;
  /** 다른 화면 안에 얹힐 때 true — 자기 좌우 패딩을 뺀다(부모가 소유). */
  embedded?: boolean;
}) {
  const uid = useId();
  const toLocal = (iso: string) => kstDateTimeLocalInput(iso);

  /**
   * 저장 모양(ISO) ↔ 화면 모양(KST 벽시각). 상태 머신은 ISO 를 읽고 이 파일의 컨트롤은
   * 벽시각 문자열을 쓴다 — 경계를 여기 한 줄로 몰아 둔다.
   */
  const toEntryOpenValue = (components: Record<string, unknown> | null | undefined): EntryOpenValue => {
    const setting = parseEntryOpenSetting(components);
    return setting.mode === "at" ? { mode: "at", local: toLocal(setting.at) } : setting;
  };

  const [form, setForm] = useState({
    name: webinar.name,
    description: webinar.description ?? "",
    liveStartAt: toLocal(webinar.liveStartAt),
    liveEndAt: toLocal(webinar.liveEndAt),
    entryOpen: toEntryOpenValue(webinar.components),
  });

  // 자동저장 — 이름·설명·일정·마감옵션 변경 시 디바운스 후 PATCH. 이름이 비면 저장하지 않는다(필수).
  const save = async () => {
    if (!form.name.trim()) return false; // 이름 필수 — 빈 값으로 덮어쓰지 않음
    try {
      const res = await fetch(`/api/webinars/${webinar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true, // 페이지 이탈 중 flush 도 서버에 도달하도록
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          liveStartAt: kstDateTimeLocalToIso(form.liveStartAt),
          liveEndAt: kstDateTimeLocalToIso(form.liveEndAt),
          /* 입장 오픈은 일정의 일부라 이 탭이 소유한다. components 병합은 최상위 키 단위라
             `entryOpen` 만 보내도 다른 설정(배너·폼 등)은 그대로 남는다. */
          components: {
            entryOpen:
              form.entryOpen.mode === "at"
                ? { mode: "at", at: kstDateTimeLocalToIso(form.entryOpen.local) }
                : form.entryOpen,
          },
          // 마감·라이브 중 접수는 등록 폼 탭이 소유한다 — 여기서 보내면 서로 덮어쓴다.
        }),
      });
      if (!res.ok) { toast.error("자동 저장 실패 — 잠시 후 다시 시도돼요", { id: "autosave-error" }); return false; }
      onSilentUpdate();
      return true;
    } catch { return false; }
  };
  const { state: saveState, dirty, retry } = useAutosave(form, save);
  // 표시는 껍데기 한 곳에서 그린다(만들기 화면당 1개) — 저장 경로는 그대로 각자.
  useReportAutosave(saveState, retry);

  // 다른 창·다른 기기에서 이름·일정이 바뀌면 이 폼도 따라간다(편집 중이면 대기).
  // 예전엔 초기값 1회라, 열어둔 창의 다음 자동저장이 낡은 값으로 상대의 수정을 되돌렸다.
  const incoming = useMemo(
    () => ({
      name: webinar.name,
      description: webinar.description ?? "",
      liveStartAt: toLocal(webinar.liveStartAt),
      liveEndAt: toLocal(webinar.liveEndAt),
      entryOpen: toEntryOpenValue(webinar.components),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [webinar.name, webinar.description, webinar.liveStartAt, webinar.liveEndAt, webinar.components],
  );
  useExternalSync(incoming, setForm, dirty);


  return (
    <div className={`max-w-2xl space-y-8 ${embedded ? "" : "p-4 sm:p-6 lg:p-8"}`}>
      {/* 기본 정보 */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">기본 정보</h3>
        <div className="space-y-3">
          <div>
            <label htmlFor={`${uid}-name`} className="text-xs text-muted-foreground mb-1 block">웨비나 이름</label>
            <input
              id={`${uid}-name`}
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={FIELD_CLS}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-desc`} className="text-xs text-muted-foreground mb-1 block">설명</label>
            <textarea
              id={`${uid}-desc`}
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={`${FIELD_CLS} resize-none leading-relaxed`}
            />
          </div>
        </div>
      </section>

      {/* 일정 */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">일정</h3>
        {/* 마감·라이브 중 접수는 '등록 폼 › 접수 창' 으로 옮겼다(IA 3단계) — 둘 다 접수 정책인데
            여기와 저기로 쪼개져 있어서 모순 조합("마감=시작" + "계속 받기")을 경고할 자리가 없었다.
            signupDeadline 은 이 탭이 더 이상 보내지 않는다(서버가 필드별로 병합하므로 안전). */}
        <WebinarSchedulePicker
          showDeadline={false}
          // 마감은 이 탭의 state 가 아니다 — props 값을 그대로 넘겨 픽커의 값 형태만 맞춘다.
          // state 로 들고 있으면 등록 폼에서 마감이 바뀔 때 useExternalSync 가 이 폼을 흔들어
          // 마감과 무관한 PATCH 가 한 번 더 나간다.
          value={{ liveStartAt: form.liveStartAt, liveEndAt: form.liveEndAt, signupDeadline: toLocal(webinar.signupDeadline) }}
          onChange={(v) => setForm((f) => ({ ...f, liveStartAt: v.liveStartAt, liveEndAt: v.liveEndAt }))}
        />
        {/* 입장 오픈 — 전까지 "시작 60분 전" 이 코드에 박혀 아무도 못 바꿨다. 일정 바로 아래가
            제 자리다: 방송 시각이 기준이고, 바꾸면 미리보기가 그 자리에서 같이 움직인다. */}
        <EntryOpenField
          liveStartAt={form.liveStartAt}
          value={form.entryOpen}
          onChange={(entryOpen) => setForm((f) => ({ ...f, entryOpen }))}
        />
      </section>

      <div className="flex items-center gap-3">
        {!form.name.trim() && <span className="text-[11px] text-destructive">이름을 입력해야 저장돼요</span>}
      </div>

    </div>
  );
}
