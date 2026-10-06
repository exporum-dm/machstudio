"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { R } from "@/components/ui/primitives";
import { transformedImageUrl, IMAGE_PRESETS } from "@/lib/webinar-image";
import type { NoticeMediaFocus } from "@/lib/notice/config";

export interface BackgroundValue {
  url: string;
  focus: NoticeMediaFocus;
  mobileFocus: NoticeMediaFocus;
  /** 배경 위에 덮는 섹션색의 진하기(0~100) */
  scrim: number;
  /** 카드·박스 바탕의 진하기(0~100) */
  panel: number;
}

/**
 * 배경 이미지 + 초점 잡기.
 *
 * **초점이 왜 필요한가.** 가로 사진을 모바일 세로 화면에 깔면 좌우가 크게 잘린다.
 * 기본값 가운데가 하필 인물이나 로고를 비껴가는 일이 흔해서, 데스크톱은 멀쩡한데
 * 모바일만 엉뚱한 데가 보인다. 잘리는 방향이 반대(가로 화면은 위아래, 세로 화면은 좌우)라
 * 값 하나로는 양쪽을 못 맞춘다 — 그래서 **두 벌**을 따로 잡는다.
 *
 * 조작은 미리보기를 **직접 찍는 것**이다. 숫자 두 개(x/y %)를 입력하게 하면 아무도
 * 안 쓴다 — 어디를 보여 줄지는 사진을 보면서 정하는 일이지 계산하는 일이 아니다.
 */
export function SectionBackgroundField({
  label,
  uploadUrl,
  value,
  onChange,
  showTone = true,
}: {
  label: string;
  /** 업로드 주소 — 대회 공고와 상세페이지가 각자의 라우트를 넘긴다. */
  uploadUrl: string;
  value: BackgroundValue | null;
  onChange: (next: BackgroundValue | null) => void;
  /**
   * 진하기 손잡이를 보일지. 히어로는 끈다 — 그 위에는 카드가 없고, 스크림은 껍데기가
   * 그라데이션으로 이미 잡아 둬서(위는 옅게, 아래는 진하게) 한 값으로 덮으면 오히려 나빠진다.
   */
  showTone?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [target, setTarget] = useState<"desktop" | "mobile">("desktop");

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(uploadUrl, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "업로드에 실패했어요"); return; }
      if (data.type !== "image") { toast.error("배경은 이미지만 넣을 수 있어요"); return; }
      onChange({
        url: data.url,
        // 사진만 바꿔 끼울 때 맞춰 둔 값이 날아가면 안 된다.
        focus: value?.focus ?? { x: 50, y: 50 },
        mobileFocus: value?.mobileFocus ?? { x: 50, y: 50 },
        scrim: value?.scrim ?? 72,
        panel: value?.panel ?? 88,
      });
      toast.success("배경을 올렸어요");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const focus = value ? (target === "desktop" ? value.focus : value.mobileFocus) : { x: 50, y: 50 };

  const setFocus = (next: NoticeMediaFocus) => {
    if (!value) return;
    onChange(target === "desktop" ? { ...value, focus: next } : { ...value, mobileFocus: next });
  };

  /** 미리보기 위 좌표 → 0~100%. 가장자리를 찍어도 밖으로 안 나가게 자른다. */
  const pick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    setFocus({
      x: clamp(((event.clientX - rect.left) / rect.width) * 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100),
    });
  };

  const chip = (active: boolean) =>
    `px-2 py-0.5 text-[11px] transition-colors ${R.control} ${
      active ? "bg-violet-500 text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`flex items-center gap-1 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 ${R.control}`}
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
          {value ? "바꾸기" : "배경 올리기"}
        </button>
        {value && (
          <button
            onClick={() => onChange(null)}
            className={`flex items-center gap-1 bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-red-500 ${R.control}`}
          >
            <Trash2 className="h-3 w-3" /> 빼기
          </button>
        )}
      </div>

      {value && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {([["desktop", "PC 초점"], ["mobile", "모바일 초점"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setTarget(v)} className={chip(target === v)}>{l}</button>
            ))}
            <span className="ml-1 text-[11px] text-muted-foreground">
              사진에서 <b>보여 줄 지점</b>을 찍으세요 · {focus.x}% {focus.y}%
            </span>
          </div>

          {/*
            비율을 기기에 맞춘다 — PC 는 넓고 모바일은 좁다. 같은 사진이라도 잘리는 곳이
            달라서, 실제 비율로 보여 줘야 "여기가 잘리는구나" 가 보인다.
          */}
          <div
            onClick={pick}
            role="presentation"
            className={`relative cursor-crosshair overflow-hidden bg-secondary ${R.control} ${
              target === "desktop" ? "aspect-[16/9]" : "mx-auto aspect-[9/16] w-1/2"
            }`}
            title="클릭한 지점이 화면 가운데에 오도록 맞춰요"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 배경 원본을 그대로 확인해야 한다 */}
            <img
              src={transformedImageUrl(value.url, IMAGE_PRESETS.adminHeroPreview)}
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: `${focus.x}% ${focus.y}%` }}
            />
            {/* 찍은 지점 표시 — 어디를 골랐는지 안 보이면 다시 찍을 수가 없다. */}
            <span
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,.4)]"
              style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
            />
          </div>

          {/*
            **사진 위에서 글이 읽히게 하는 두 손잡이.**
            카드들은 평평한 색 위에 놓일 걸 전제로 옅은 막으로 그려져 있어서, 뒤에 사진이
            깔리면 거의 사라진다. 사진마다 밝기가 달라 한 값으로는 못 맞추므로 여기서 정한다.
          */}
          {showTone && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Slider
              label="배경 어둡기"
              hint="높을수록 사진이 흐려져요"
              value={value.scrim}
              onChange={(n) => onChange({ ...value, scrim: n })}
            />
            <Slider
              label="박스 진하기"
              hint="높을수록 카드가 또렷해져요"
              value={value.panel}
              onChange={(n) => onChange({ ...value, panel: n })}
            />
          </div>
          )}
        </>
      )}
    </div>
  );
}

/** 0~100 손잡이 — 값이 곧 눈에 보이는 결과라 숫자를 옆에 붙여 둔다. */
function Slider({
  label, hint, value, onChange,
}: {
  label: string; hint: string; value: number; onChange: (next: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
      <span className="block text-[10px] text-muted-foreground">{hint}</span>
    </label>
  );
}
