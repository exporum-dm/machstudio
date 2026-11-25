"use client";

import { Fragment, useState, type ReactNode } from "react";
import { applyGridLayout, creatorGridLayout, type CreatorAction } from "@/lib/creator/model";
import type { CreatorProgramView, CreatorView } from "@/lib/creator/types";
import { ApplicantDetail, applicantName } from "./Recruitment";
import { ColumnPicker, GridHead, RowToggle, layoutFrom } from "./Grid";
import { button, input, dateTime, Empty, Text } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
type App = CreatorView["applications"][number];
type Candidate = CreatorProgramView["candidates"][number];

/**
 * 신청서 한 건 = 한 행.
 *
 * 선발 폼과 답변 전체는 **행을 펼쳤을 때** 나온다. 예전에는 신청서마다 카드가 펼쳐져 있어
 * 서른 건만 돼도 누가 왔는지 훑기 어려웠다.
 */
type ApplicantColumn = {
  key: string; label: string; width?: number; hidden?: boolean;
  cell: (context: { record: App; candidate?: Candidate; selected: boolean }) => ReactNode;
};

const applicantColumns: ApplicantColumn[] = [
  {
    key: "name", label: "이름", width: 160,
    cell: ({ record, candidate }) => {
      const name = applicantName(record, (candidate?.cells ?? {}) as Record<string, unknown>);
      return <span className="block truncate font-medium" title={name}>{name || "이름 없음"}</span>;
    },
  },
  {
    key: "contact", label: "연락처", width: 220,
    cell: ({ record }) => <span className="block truncate text-muted-foreground" title={record.emailNormalized ?? record.phoneE164 ?? ""}>
      {record.emailNormalized || record.phoneE164 || "—"}
    </span>,
  },
  {
    key: "createdAt", label: "신청일", width: 140,
    cell: ({ record }) => <span className="text-muted-foreground">{dateTime(record.createdAt)}</span>,
  },
  {
    key: "source", label: "경로", width: 110,
    cell: ({ candidate }) => <span className="text-muted-foreground">{candidate ? "발굴 후보" : "공개 모집"}</span>,
  },
  {
    key: "selected", label: "선발", width: 90,
    cell: ({ selected }) => selected
      ? <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">선발됨</span>
      : <span className="text-xs text-muted-foreground">미선발</span>,
  },
];

export function ApplicantsTable({ program, applications, save, labels }: {
  program: CreatorProgramView; applications: App[]; save: Save; labels: Record<string, string>;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(false);

  const columns = applyGridLayout(applicantColumns, creatorGridLayout(program.tableLayout, "applicants"));
  const visible = columns.filter((column) => !column.hidden);
  const selected = new Set(program.participants.map(({ applicationId }) => applicationId));
  const candidates = new Map(program.candidates.map((row) => [row.invite, row]));
  const filtered = applications.filter((record) =>
    (filter === "all" || selected.has(record.id) === (filter === "selected"))
    && [record.emailNormalized, record.phoneE164, JSON.stringify(record.data)]
      .some((value) => value?.toLowerCase().includes(search.toLowerCase())));

  function saveLayout(next: typeof columns) {
    void save({ action: "gridLayout", table: "applicants", layout: layoutFrom(next) });
  }

  function reorder(key: string, toVisibleIndex: number) {
    const target = visible[toVisibleIndex];
    if (!target || target.key === key) return;
    const list = [...columns];
    const from = list.findIndex((column) => column.key === key);
    const to = list.findIndex((column) => column.key === target.key);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    saveLayout(list);
  }

  return <section className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">모집 신청서</h2>
        <p className="mt-1 text-sm text-muted-foreground">행을 펼치면 답변 전체와 선발 폼이 나와요.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Text value={search} aria-label="신청서 검색" onChange={(event) => setSearch(event.target.value)} placeholder="신청서 검색" />
        <select className={input} aria-label="선발 상태" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">전체</option><option value="unselected">미선발</option><option value="selected">선발</option>
        </select>
        <span className="text-sm text-muted-foreground">{filtered.length}/{applications.length}건</span>
        <button className={button} aria-expanded={showColumns} onClick={() => setShowColumns(!showColumns)}>열 설정</button>
      </div>
    </div>

    {showColumns && <ColumnPicker columns={columns}
      onToggle={(key) => saveLayout(columns.map((column) => column.key === key ? { ...column, hidden: !column.hidden } : column))}
      onReset={() => void save({ action: "gridLayout", table: "applicants", layout: [] })} />}

    {!filtered.length
      ? <Empty>{program.applicationSourceId ? "조건에 맞는 신청서가 없어요." : "설정에서 모집 폼을 연결하면 여기에 신청서가 표시돼요."}</Empty>
      : <div className="max-w-full overflow-x-auto rounded-xl shadow-sm">
        <table className="w-full min-w-max table-fixed text-left text-sm">
          <colgroup>
            <col style={{ width: "44px" }} />
            {visible.map((column) => <col key={column.key} style={{ width: (column.width ?? 160) + "px" }} />)}
          </colgroup>
          <GridHead columns={visible} onReorder={reorder}
            onResize={(key, width) => saveLayout(columns.map((column) => column.key === key ? { ...column, width } : column))}
            leading={<th scope="col" className="w-11 px-2 py-3"><span className="sr-only">자세히</span></th>} />
          <tbody>
            {filtered.map((record) => {
              const candidate = record.utmId ? candidates.get(record.utmId) : undefined;
              const isSelected = selected.has(record.id);
              const expanded = open.has(record.id);
              const name = applicantName(record, (candidate?.cells ?? {}) as Record<string, unknown>);
              return <Fragment key={record.id}>
                <tr className="border-t border-border/50">
                  <td className="px-2 py-2 align-middle">
                    <RowToggle open={expanded} label={name || "신청서"} onToggle={() => setOpen((set) => {
                      const next = new Set(set);
                      if (!next.delete(record.id)) next.add(record.id);
                      return next;
                    })} />
                  </td>
                  {visible.map((column) => <td key={column.key} className="px-2 py-2 align-middle">
                    {column.cell({ record, candidate, selected: isSelected })}
                  </td>)}
                </tr>
                {expanded && <tr>
                  <td colSpan={visible.length + 1} className="p-0">
                    <ApplicantDetail record={record} candidate={candidate} selected={isSelected} save={save} labels={labels} />
                  </td>
                </tr>}
              </Fragment>;
            })}
          </tbody>
        </table>
      </div>}
  </section>;
}
