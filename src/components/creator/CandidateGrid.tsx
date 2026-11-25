"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { baseColumns, creatorColumns, normalizeCell, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type Cells, type Column, type CreatorAction } from "@/lib/creator/model";
import { candidateCsv, pasteCandidates } from "@/lib/creator/sheet";
import type { CreatorView, CreatorProgramView } from "@/lib/creator/types";
import { button, primary, Empty, Field, panel, input, Text } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
const types = { text: "텍스트", number: "숫자", date: "날짜", select: "선택", checkbox: "체크박스", url: "주소" } as const;

function EditorCell({ column, value, save }: { column: Column; value: Cells[string]; save: (value: Cells[string]) => Promise<boolean> }) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const [error, setError] = useState("");
  async function commit(next: string | boolean) {
    try {
      const normalized = normalizeCell(column, next);
      if (normalized === (value ?? null)) return;
      setError("");
      if (!await save(normalized)) setError("저장하지 못했어요.");
    } catch (error) { setError(error instanceof Error ? error.message : "값을 확인해 주세요."); }
  }
  return <div className="grid gap-1">
    {column.type === "checkbox" ?
      <input aria-label={column.label} type="checkbox" checked={draft === "true"} onChange={(event) => { setDraft(String(event.target.checked)); void commit(event.target.checked); }} /> :
      column.type === "select" ?
        <select aria-label={column.label} value={draft} className={input} onChange={(event) => { setDraft(event.target.value); void commit(event.target.value); }}>
          <option value="">선택</option>{column.options?.map((option) => <option key={option}>{option}</option>)}
        </select> :
        column.key === "memo" || String(value ?? "").includes("\n") ?
          <textarea aria-label={column.label} className={input} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit(draft)} /> :
        <Text aria-label={column.label} value={draft} type={column.type === "date" ? "date" : "text"} inputMode={column.type === "number" ? "decimal" : undefined}
          onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit(draft)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />}
    {error && <small className="text-destructive" role="alert">{error}</small>}
  </div>;
}

/**
 * 열 경계를 끌어 너비를 바꾼다. 놓는 순간에만 저장해, 끄는 동안 서버로 요청이 쏟아지지 않게 한다.
 * 키보드만 쓰는 사람을 위해 좌우 화살표로도 20px 씩 움직인다(열 설정 패널의 숫자 칸으로도 가능).
 */
function ColumnResizer({ column, onResize }: { column: Column; onResize: (key: string, width: number) => void }) {
  const [dragging, setDragging] = useState(false);

  function start(event: React.PointerEvent<HTMLButtonElement>) {
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = column.width ?? handle.closest("th")?.getBoundingClientRect().width ?? 160;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    let latest = startWidth;

    const move = (moveEvent: PointerEvent) => {
      latest = clampWidth(startWidth + moveEvent.clientX - startX);
      // 끄는 동안은 화면만 즉시 반응시키고, 저장은 놓을 때 한 번.
      const table = handle.closest("table");
      const index = [...(handle.closest("tr")?.children ?? [])].indexOf(handle.closest("th") as Element);
      const col = table?.querySelectorAll("col")[index] as HTMLTableColElement | undefined;
      if (col) col.style.width = latest + "px";
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragging(false);
      if (latest !== startWidth) onResize(column.key, latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return <button
    type="button"
    aria-label={column.label + " 열 너비 조절"}
    className={`absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none ${dragging ? "bg-primary/60" : ""}`}
    onPointerDown={start}
    onKeyDown={(event) => {
      const step = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
      if (!step) return;
      event.preventDefault();
      onResize(column.key, clampWidth((column.width ?? 160) + step));
    }}
  />;
}

const clampWidth = (value: number) => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(value)));

export function CandidateGrid({ program, applications, origin, save, copy }: {
  program: CreatorProgramView; applications: CreatorView["applications"]; origin: string; save: Save; copy: (value: string) => void;
}) {
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");
  const [columnDraft, setColumnDraft] = useState(creatorColumns(program.columns));
  const columns = creatorColumns(program.columns);
  const visible = columns.filter((column) => !column.hidden);
  const receipts = new Set(applications.map(({ utmId }) => utmId));
  const rows = program.candidates.map((candidate) => ({ ...candidate, submitted: receipts.has(candidate.invite) }));
  const filtered = rows.filter((row) => [...Object.values(row.cells as Cells), row.submitted ? "제출 완료" : "미제출"]
    .some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase())) || !search);
  const publicForm = program.applicationSourceId && origin ? origin + "/register/" + program.applicationSourceId : "";

  async function addPaste() {
    try {
      setError("");
      const parsed = pasteCandidates(paste, visible);
      if (await save({ action: "candidateAdd", rows: parsed })) setPaste("");
    } catch (error) { setError(error instanceof Error ? error.message : "표를 확인해 주세요."); }
  }

  function editColumn(index: number, patch: Partial<Column>) {
    setColumnDraft((list) => list.map((column, slot) => slot === index ? { ...column, ...patch } : column));
  }

  /** 표에서 끌어 바꾼 너비는 그 자리에서 저장한다 — 열 설정 패널을 열지 않아도 남는다. */
  function resizeColumn(key: string, width: number) {
    const next = columns.map((column) => column.key === key ? { ...column, width } : column);
    setColumnDraft(next);
    void save({ action: "columns", columns: next });
  }

  const missingBase = baseColumns.filter(({ key }) => !columnDraft.some((column) => column.key === key));

  function moveColumn(from: number, to: number) {
    if (from < 0 || from === to) return;
    const list = [...columnDraft];
    const [column] = list.splice(from, 1);
    list.splice(to, 0, column);
    setColumnDraft(list);
  }

  function exportRows() {
    const url = URL.createObjectURL(new Blob([candidateCsv(columns, filtered)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "creator-candidates.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className={panel + " grid gap-4"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">발굴 후보</h2><p className="mt-1 text-sm text-muted-foreground">DM 답변과 신청서 접수 여부를 한 표에서 확인하세요.</p></div>
      <div className="flex flex-wrap gap-2">
        <button className={primary} onClick={() => void save({ action: "candidateAdd", rows: [{}] })}><Plus className="mr-1 size-4" />후보 추가</button>
        <button className={button} aria-expanded={showPaste} onClick={() => setShowPaste((open) => !open)}>붙여넣기</button>
        <button className={button} aria-expanded={showColumns} onClick={() => {
          if (!showColumns) setColumnDraft(columns);
          setShowColumns(!showColumns);
        }}>열 설정</button>
        <button className={button} onClick={exportRows}><Download className="mr-1 size-4" />CSV</button>
      </div>
    </div>
    {showColumns && <div className="grid gap-2 rounded-xl bg-muted/30 p-3">
      <p className="text-sm font-medium">열 구성</p>
      {columnDraft.map((column, index) => {
        return <div key={column.key} className="flex flex-wrap items-center gap-2"
          onDragOver={(event) => { if (event.dataTransfer.types.includes("text/plain")) event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            const from = columnDraft.findIndex(({ key }) => key === event.dataTransfer.getData("text/plain"));
            moveColumn(from, index);
          }}>
          <span draggable className="cursor-grab touch-none px-1 text-muted-foreground" title={column.label + " 순서 이동"}
            onDragStart={(event) => { event.dataTransfer.setData("text/plain", column.key); event.dataTransfer.effectAllowed = "move"; }}>
            <GripVertical aria-hidden="true" className="size-4" />
          </span>
          <Text aria-label="열 이름" value={column.label} onChange={(event) => editColumn(index, { label: event.target.value })} />
          <select aria-label="열 형식" className={input} value={column.type} onChange={(event) => editColumn(index, { type: event.target.value as Column["type"] })}>
            {Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {column.type === "select" && <Text aria-label="선택지" placeholder="선택지, 쉼표로 구분" defaultValue={column.options?.join(", ")}
            onChange={(event) => editColumn(index, { options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />}
          <Text aria-label={column.label + " 너비(px)"} type="number" className="w-24" placeholder="너비"
            min={MIN_COLUMN_WIDTH} max={MAX_COLUMN_WIDTH} value={column.width ?? ""}
            onChange={(event) => editColumn(index, { width: event.target.value ? Number(event.target.value) : undefined })} />
          <button className={button} aria-label={column.label + " 위로"} disabled={index === 0} onClick={() => moveColumn(index, index - 1)}><ArrowUp className="size-4" /></button>
          <button className={button} aria-label={column.label + " 아래로"} disabled={index === columnDraft.length - 1} onClick={() => moveColumn(index, index + 1)}><ArrowDown className="size-4" /></button>
          <button className={button} aria-label={column.label + (column.hidden ? " 표시" : " 숨기기")} onClick={() => editColumn(index, { hidden: !column.hidden })}>{column.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
          <button className={button + " text-destructive"} aria-label={column.label + " 삭제"} onClick={async () => {
            if (await confirm({
              title: `'${column.label}' 열을 지울까요?`,
              description: "표와 CSV에서 빠져요. 적어 둔 값은 남아 있어서, 같은 열을 다시 만들면 그대로 보입니다.",
              tone: "danger",
            })) {
              setColumnDraft((list) => list.filter(({ key }) => key !== column.key));
            }
          }}><Trash2 className="size-4" /></button>
        </div>;
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={columnDraft.length >= 80} onClick={() => setColumnDraft((list) => [...list, {
          key: "col_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), label: "새 열 " + (list.length + 1), type: "text",
        }])}>열 추가</button>
        {missingBase.length > 0 && <select className={input} aria-label="기본 열 되살리기" value=""
          onChange={(event) => {
            const base = baseColumns.find(({ key }) => key === event.target.value);
            if (base) setColumnDraft((list) => [...list, base]);
          }}>
          <option value="">기본 열 되살리기…</option>
          {missingBase.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
        </select>}
        <button className={primary} disabled={!columnDraft.length} onClick={() => void save({ action: "columns", columns: columnDraft })}>열 저장</button>
        {!columnDraft.length && <span className="text-xs text-muted-foreground">열이 하나는 있어야 해요.</span>}
      </div>
    </div>}
    {showPaste && <div className="grid gap-2 rounded-xl bg-muted/30 p-3">
      <Field label="Excel 표 또는 CSV 붙여넣기"><textarea className={input} value={paste} onChange={(event) => setPaste(event.target.value)} rows={4} placeholder="현재 표의 열 순서를 사용하거나 첫 줄에 열 이름을 포함하세요." />
        {error && <span role="alert" className="text-destructive">{error}</span>}
      </Field>
      <button className={primary + " justify-self-start"} onClick={() => void addPaste()}>후보 행 추가</button>
    </div>}
    <div className="flex flex-wrap items-center gap-3"><Text aria-label="후보 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름, 계정, 메모 검색" /><span className="text-sm text-muted-foreground">{filtered.length}/{rows.length}명</span></div>
    {!filtered.length ? <Empty>{rows.length ? "검색 결과가 없어요." : "후보를 추가하거나 Excel에서 복사한 행을 붙여 넣으세요."}</Empty> :
      <div className="max-w-full overflow-x-auto rounded-xl shadow-sm">
        <table className="w-full min-w-max table-fixed text-left text-sm">
          <colgroup>
            {visible.map((column) => <col key={column.key} style={{ width: (column.width ?? 160) + "px" }} />)}
            <col style={{ width: "120px" }} /><col style={{ width: "200px" }} />
          </colgroup>
          <thead className="bg-muted/65 text-xs font-medium text-muted-foreground"><tr>
            {visible.map((column) => <th key={column.key} scope="col" className="relative px-3 py-3">
              <span className="block truncate" title={column.label}>{column.label}</span>
              <ColumnResizer column={column} onResize={resizeColumn} />
            </th>)}
            <th scope="col" className="px-3 py-3">신청서 제출</th><th scope="col" className="px-3 py-3">작업</th>
          </tr></thead>
          <tbody>{filtered.map((row) => <tr className="border-t border-border/50" key={row.id}>
            {visible.map((column) => {
              const value = (row.cells as Cells)[column.key];
              return <td key={column.key} className="min-w-32 px-2 py-2"><EditorCell key={String(value)} column={column} value={value}
                save={(next) => save({ action: "candidateEdit", id: row.id, key: column.key, value: next })} /></td>;
            })}
            <td className="px-3 py-2"><span className={row.submitted ? "font-semibold" : "text-muted-foreground"}>{row.submitted ? "제출 완료" : "미제출"}</span></td>
            <td className="px-3 py-2"><div className="flex gap-2">
              {publicForm && !row.submitted && <button className={button} onClick={() => copy(publicForm + "?utm_id=" + row.invite)}>신청 링크 복사</button>}
              {publicForm && !row.submitted && (row.cells as Cells).interest === "참여 의향 있음" && <button className={button} onClick={() => void save({
                action: "candidateEdit", id: row.id, key: "interest", value: "신청 링크 발송",
              })}>발송 기록</button>}
              <button className={button + " text-destructive"} aria-label="후보 삭제" onClick={async () => {
                if (await confirm({ title: "이 후보를 삭제할까요?", description: "발굴 후보 표에서 삭제돼요.", tone: "danger" })) await save({ action: "candidateDelete", id: row.id });
              }}><Trash2 className="size-4" /></button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
