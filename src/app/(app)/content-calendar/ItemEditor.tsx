"use client";

/**
 * 콘텐츠 상세 — 오른쪽 패널(모바일은 전체 화면). 고치는 즉시 저장된다(글자는 잠깐 멈추면).
 * 새 항목은 제목을 적는 순간 만들어진다 — 제목 없이 닫으면 아무것도 남지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import { FieldArea, FieldSelect, FINISH, R, SELECTED, UrlField } from "@/components/ui/primitives";
import {
  CONTENT_CHANNELS, CONTENT_FORMATS, CONTENT_STATUSES, isValidDay, isValidTime,
  type ContentItemDto, type ContentMemberDto,
} from "@/lib/content-calendar";
import { StatusDot } from "./parts";

export type SaveMode = "now" | "debounce" | "local";

const LABEL = "mb-1.5 block text-xs font-medium text-muted-foreground";
const PILL = `inline-flex min-h-8 items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${R.control}`;
const pill = (on: boolean) => `${PILL} ${on ? SELECTED : `${FINISH.s2} text-muted-foreground hover:bg-secondary hover:text-foreground`}`;

const isHttpUrl = (v: string) => { try { const u = new URL(v.trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };

export default function ItemEditor({ item, isNew, projects, members, knownChannels, onChange, onClose, onDelete }: {
  item: ContentItemDto;
  /** 아직 서버에 없는 항목 */
  isNew: boolean;
  projects: { id: string; name: string }[];
  members: ContentMemberDto[];
  /** 기본 채널 밖에서 이미 쓰인 채널 */
  knownChannels: string[];
  onChange: (fields: Partial<ContentItemDto>, mode: SaveMode) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const savedTitle = useRef(item.title);
  const [customChannel, setCustomChannel] = useState("");
  const [customFormat, setCustomFormat] = useState("");
  const [timeDraft, setTimeDraft] = useState(item.time);
  // 항목이 바뀌면 부모가 key 로 새로 그린다 — 위 상태들은 항목마다 처음부터.
  useEffect(() => { if (isNew) titleRef.current?.focus(); }, [isNew]);

  const close = () => {
    // 이미 있는 항목의 제목을 다 지운 채 닫으면 마지막 제목으로 되돌린다(빈 제목은 저장되지 않으므로).
    if (!isNew && !item.title.trim() && savedTitle.current) onChange({ title: savedTitle.current }, "local");
    onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 제목 칸 높이를 글에 맞춘다
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [item.title]);

  const setTitle = (title: string) => {
    if (title.trim()) savedTitle.current = title;
    onChange({ title }, title.trim() ? "debounce" : "local");
  };
  const toggleChannel = (c: string) =>
    onChange({ channels: item.channels.includes(c) ? item.channels.filter((x) => x !== c) : [...item.channels, c] }, "now");
  const addChannel = () => {
    const c = customChannel.trim().slice(0, 30);
    if (c && !item.channels.includes(c)) onChange({ channels: [...item.channels, c] }, "now");
    setCustomChannel("");
  };
  const channelChoices = [...CONTENT_CHANNELS, ...knownChannels.filter((c) => !(CONTENT_CHANNELS as readonly string[]).includes(c))];
  const extraSelected = item.channels.filter((c) => !channelChoices.includes(c));
  const formatChoices: string[] = [...CONTENT_FORMATS];
  if (item.format && !formatChoices.includes(item.format)) formatChoices.push(item.format);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="콘텐츠 상세">
      <motion.button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={close}
        className="absolute inset-0 bg-black/30"
      />
      <motion.div
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={`relative flex h-full w-full flex-col bg-background sm:max-w-md ${FINISH.overlay}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">{isNew ? "새 콘텐츠" : "콘텐츠"}</span>
          <button type="button" onClick={close} aria-label="닫기" className={`inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground ${R.control}`}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div>
            <textarea
              ref={titleRef}
              rows={1}
              value={item.title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
              placeholder="제목"
              aria-label="제목"
              className="w-full resize-none bg-transparent text-xl font-semibold leading-snug outline-none placeholder:text-muted-foreground/50"
            />
            {!item.title.trim() && <p className="mt-1 text-[11px] text-muted-foreground">{isNew ? "제목을 적으면 저장돼요" : "제목이 비어 있으면 저장되지 않아요"}</p>}
          </div>

          <div>
            <span className={LABEL}>상태</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="상태">
              {CONTENT_STATUSES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={item.status === s.id} onClick={() => onChange({ status: s.id }, "now")} className={pill(item.status === s.id)}>
                  <StatusDot status={s.id} />{s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <label>
              <span className={LABEL}>발행일</span>
              <input
                type="date"
                value={item.date ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") onChange({ date: null }, "now");
                  else if (isValidDay(v)) onChange({ date: v }, "now");
                }}
                className={`w-full bg-background px-3 py-2 text-sm tabular-nums ${R.control} ${FINISH.s2}`}
              />
            </label>
            <label>
              <span className={LABEL}>시간</span>
              <input
                type="time"
                value={timeDraft}
                onChange={(e) => {
                  setTimeDraft(e.target.value);
                  if (isValidTime(e.target.value)) onChange({ time: e.target.value }, "debounce");
                }}
                className={`w-full bg-background px-3 py-2 text-sm tabular-nums ${R.control} ${FINISH.s2}`}
              />
            </label>
            {item.date && (
              <button type="button" onClick={() => onChange({ date: null }, "now")} className="col-span-2 justify-self-start text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                날짜 미정으로 돌리기
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={LABEL}>프로젝트</span>
              <FieldSelect value={item.projectId ?? ""} onChange={(e) => onChange({ projectId: e.target.value || null }, "now")}>
                <option value="">프로젝트 없음</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </FieldSelect>
            </label>
            <label>
              <span className={LABEL}>담당</span>
              <FieldSelect
                value={item.assigneeId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  onChange({ assigneeId: id, assigneeName: members.find((m) => m.id === id)?.name ?? "" }, "now");
                }}
              >
                <option value="">없음</option>
                {item.assigneeId && !members.some((m) => m.id === item.assigneeId) && <option value={item.assigneeId}>{item.assigneeName}</option>}
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </FieldSelect>
            </label>
          </div>

          <div>
            <span className={LABEL}>채널</span>
            <div className="flex flex-wrap gap-1.5">
              {[...channelChoices, ...extraSelected].map((c) => (
                <button key={c} type="button" aria-pressed={item.channels.includes(c)} onClick={() => toggleChannel(c)} className={pill(item.channels.includes(c))}>{c}</button>
              ))}
              <form onSubmit={(e) => { e.preventDefault(); addChannel(); }} className="inline-flex items-center">
                <input
                  value={customChannel}
                  onChange={(e) => setCustomChannel(e.target.value)}
                  onBlur={addChannel}
                  placeholder="직접 입력"
                  aria-label="채널 직접 입력"
                  className={`h-8 w-24 bg-transparent px-2 text-xs ${R.control} ${FINISH.s2}`}
                />
              </form>
            </div>
          </div>

          <div>
            <span className={LABEL}>형식</span>
            <div className="flex flex-wrap gap-1.5">
              {formatChoices.map((f) => (
                <button key={f} type="button" aria-pressed={item.format === f} onClick={() => onChange({ format: item.format === f ? "" : f }, "now")} className={pill(item.format === f)}>{f}</button>
              ))}
              <form
                onSubmit={(e) => { e.preventDefault(); const f = customFormat.trim().slice(0, 40); if (f) onChange({ format: f }, "now"); setCustomFormat(""); }}
                className="inline-flex"
              >
                <input
                  value={customFormat}
                  onChange={(e) => setCustomFormat(e.target.value)}
                  onBlur={() => { const f = customFormat.trim().slice(0, 40); if (f) onChange({ format: f }, "now"); setCustomFormat(""); }}
                  placeholder="직접 입력"
                  aria-label="형식 직접 입력"
                  className={`h-8 w-24 bg-transparent px-2 text-xs ${R.control} ${FINISH.s2}`}
                />
              </form>
            </div>
          </div>

          <label className="block">
            <span className={LABEL}>내용 · 카피</span>
            <FieldArea
              rows={8}
              value={item.body}
              onChange={(e) => onChange({ body: e.target.value }, "debounce")}
              placeholder="핵심 메시지, 캡션, 해시태그, 참고 자료…"
            />
          </label>

          <div>
            <span className={LABEL}>게시물 링크</span>
            <UrlField
              label="게시물 링크"
              value={item.link}
              onChange={(v) => onChange({ link: v }, v.trim() === "" || isHttpUrl(v) ? "debounce" : "local")}
              placeholder="발행한 뒤 게시물 주소"
              isValidHttpUrl={isHttpUrl}
            />
          </div>
        </div>

        {!isNew && (
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <span className="text-[11px] text-muted-foreground">
              {new Date(item.updatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 수정
            </span>
            <button type="button" onClick={onDelete} className={`inline-flex min-h-9 items-center gap-1.5 px-3 text-sm text-destructive hover:bg-destructive/10 ${R.control}`}>
              <Trash2 className="h-4 w-4" aria-hidden />삭제
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
