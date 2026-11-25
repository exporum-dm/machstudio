"use client";

import { Fragment, useState, type ReactNode } from "react";
import { creatorEntryPath } from "@/lib/creator/entry";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  applyGridLayout, creatorDriveFolder, creatorGridLayout, creatorPromotionUrl, isCreatorAwarded, platforms, type CreatorAction,
} from "@/lib/creator/model";
import type { CreatorPerson, CreatorProgramView, CreatorView } from "@/lib/creator/types";
import { applicationText } from "./Recruitment";
import { ColumnPicker, GridHead, RowToggle, gridSelect, layoutFrom } from "./Grid";
import { button, input, dateTime, Empty, Field, Text, feeNames, statusNames } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
type Copy = (value: string) => void;
type Application = CreatorView["applications"][number];
type Patch = Extract<CreatorAction, { action: "participant" }>["patch"];

/**
 * 선발자 한 명 = 한 행.
 *
 * 예전에는 한 명이 카드 하나였고 그 안에 입력칸이 13개라, 열 명만 돼도 화면 열 개 분량을
 * 스크롤해야 명단을 훑을 수 있었다. 자주 보고 자주 고치는 값만 열로 꺼내고, 가끔 보는 긴 내용
 * (공개 프로필·신청서 답변·미션 이력)은 행을 펼쳤을 때 **그 자리에서** 보여 준다.
 */
type PeopleColumn = {
  key: string; label: string; width?: number; hidden?: boolean;
  cell: (context: CellContext) => ReactNode;
};
type CellContext = {
  person: CreatorPerson; application?: Application; program: CreatorProgramView;
  save: Save; busy: boolean; setBusy: (busy: boolean) => void;
};

/** 한 칸짜리 인라인 편집 — 칸을 벗어나면 저장한다. 발굴 후보 표와 같은 손맛. */
function CellText({ value, onSave, ...props }: {
  value: string; onSave: (value: string) => Promise<unknown>;
} & Omit<React.ComponentProps<typeof Text>, "value" | "onChange" | "onBlur">) {
  const [draft, setDraft] = useState(value);
  return <Text {...props} value={draft}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (draft !== value) void onSave(draft); }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function mainChannel(person: CreatorPerson) {
  const entries = Object.entries(person.channels as Record<string, string>).filter(([, handle]) => handle);
  if (!entries.length) return null;
  const [platform, handle] = entries[0];
  return { platform, handle, extra: entries.length - 1 };
}

const peopleColumns: PeopleColumn[] = [
  {
    key: "name", label: "이름", width: 160,
    cell: ({ person, save }) => <CellText aria-label="이름" maxLength={160} value={person.name}
      onSave={(name) => save({ action: "participant", id: person.id, patch: { name: name.trim() || person.name } })} />,
  },
  {
    key: "channel", label: "주 계정", width: 180,
    cell: ({ person }) => {
      const channel = mainChannel(person);
      return channel
        ? <span className="block truncate" title={channel.platform + " @" + channel.handle}>
          @{channel.handle}{channel.extra > 0 && <span className="text-muted-foreground"> +{channel.extra}</span>}
        </span>
        : <span className="text-xs text-destructive">계정 없음 — 링크 미발급</span>;
    },
  },
  {
    key: "contact", label: "연락처", width: 200,
    cell: ({ person, application, save }) => <CellText aria-label="연락처" maxLength={400} value={person.contact}
      placeholder={application?.emailNormalized ?? "이메일 또는 URL"}
      onSave={(contact) => save({ action: "participant", id: person.id, patch: { contact } })} />,
  },
  {
    key: "owner", label: "담당자", width: 120,
    cell: ({ person, save }) => <CellText aria-label="담당자" maxLength={160} value={person.owner}
      onSave={(owner) => save({ action: "participant", id: person.id, patch: { owner } })} />,
  },
  {
    key: "confirmed", label: "참여 확정", width: 90,
    cell: ({ person, save, busy, setBusy }) => <input type="checkbox" aria-label={person.name + " 참여 확정"}
      checked={person.confirmed} disabled={busy}
      onChange={async (event) => {
        const confirmed = event.target.checked;
        setBusy(true);
        try { await save({ action: "participant", id: person.id, patch: { confirmed } }); }
        finally { setBusy(false); }
      }} />,
  },
  {
    key: "completed", label: "수료", width: 80,
    cell: ({ person, save, busy, setBusy }) => <input type="checkbox" aria-label={person.name + " 수료"}
      checked={person.completed} disabled={busy}
      onChange={async (event) => {
        const completed = event.target.checked;
        setBusy(true);
        try { await save({ action: "participant", id: person.id, patch: { completed } }); }
        finally { setBusy(false); }
      }} />,
  },
  {
    key: "awardSelected", label: "우수자", width: 80,
    cell: ({ person, save, busy, setBusy }) => <input type="checkbox" aria-label={person.name + " 우수자 선정"}
      checked={isCreatorAwarded(person)} disabled={busy}
      onChange={async (event) => {
        const awardSelected = event.target.checked;
        setBusy(true);
        try { await save({ action: "participant", id: person.id, patch: { awardSelected } }); }
        finally { setBusy(false); }
      }} />,
  },
  {
    key: "missions", label: "미션", width: 90,
    cell: ({ person }) => {
      const done = person.assignments.filter(({ status }) => status === "done").length;
      return <span className="tabular-nums">{done}/{person.assignments.length}</span>;
    },
  },
  {
    key: "fee", label: "활동비", width: 120,
    cell: ({ person, save }) => <select className={gridSelect} aria-label="활동비 상태" defaultValue={person.feeStatus}
      onChange={(event) => void save({ action: "participant", id: person.id, patch: { feeStatus: event.target.value as "unpaid" | "scheduled" | "paid" } })}>
      {Object.entries(feeNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
    </select>,
  },
  {
    key: "paidOn", label: "지급일", width: 140,
    cell: ({ person, save }) => <CellText aria-label="지급일 또는 예정일" type="date" value={person.paidOn ?? ""}
      onSave={(paidOn) => save({ action: "participant", id: person.id, patch: { paidOn: paidOn || null } })} />,
  },
  {
    key: "award", label: "우수자 상명", width: 140,
    cell: ({ person, save }) => <CellText aria-label="우수자 상명" maxLength={160} value={person.award} placeholder="예. 최우수상"
      onSave={(award) => save({ action: "participant", id: person.id, patch: { award } })} />,
  },
  {
    key: "lastEmailedAt", label: "안내 메일", width: 130,
    cell: ({ person }) => person.lastEmailedAt
      ? <span className="text-xs text-muted-foreground">{dateTime(person.lastEmailedAt)}</span>
      : <span className="text-xs text-muted-foreground/60">보낸 적 없음</span>,
  },
];

function PersonDetail({ person, program, application, labels, origin, save, copy }: {
  person: CreatorPerson; program: CreatorProgramView; application?: Application;
  labels: Record<string, string>; origin: string; save: Save; copy: Copy;
}) {
  const confirm = useConfirm();
  const [channels, setChannels] = useState(person.channels as Partial<Record<typeof platforms[number], string>>);
  const [folderError, setFolderError] = useState("");
  const [busy, setBusy] = useState(false);
  const answers = Object.entries((application?.data ?? {}) as Record<string, unknown>).filter(([key]) => !key.startsWith("__"));
  const portal = origin + "/creator-portal/" + person.token;
  const links = person.links.filter(({ platform }) => Boolean((person.channels as Record<string, string>)[platform]));

  async function patch(patch: Patch) {
    setBusy(true);
    try { await save({ action: "participant", id: person.id, patch }); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-4 bg-muted/25 p-4">
    <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <legend className="mb-2 text-sm font-medium">홍보 계정 — 채널마다 링크가 따로 발급돼요</legend>
      {platforms.map((platform) => <Field key={platform} label={platform}>
        <Text value={channels[platform] ?? ""} maxLength={160} placeholder="@계정"
          onChange={(event) => setChannels({ ...channels, [platform]: event.target.value })}
          onBlur={() => { if (JSON.stringify(channels) !== JSON.stringify(person.channels)) void patch({ channels }); }} />
      </Field>)}
    </fieldset>

    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="활동 확인 이메일">
        <Text type="email" maxLength={254} defaultValue={person.accessEmail ?? ""} placeholder={application?.emailNormalized ?? "name@gmail.com"}
          onBlur={(event) => {
            const accessEmail = event.target.value.trim() || null;
            if (accessEmail !== (person.accessEmail ?? null)) void patch({ accessEmail });
          }} />
        <span className="text-xs text-muted-foreground">비워 두면 신청서 이메일을 사용해요.</span>
      </Field>
      <Field label="원본 영상용 개인 Google Drive 폴더">
        <Text type="url" maxLength={2048} defaultValue={person.driveFolder ?? ""} placeholder="https://drive.google.com/drive/folders/…"
          aria-invalid={Boolean(folderError)}
          onChange={() => setFolderError("")}
          onBlur={(event) => {
            const driveFolder = event.target.value.trim();
            if (driveFolder && !creatorDriveFolder.safeParse(driveFolder).success) { setFolderError("Google Drive 폴더 주소를 입력해 주세요."); return; }
            setFolderError("");
            if ((driveFolder || null) !== (person.driveFolder ?? null)) void patch({ driveFolder: driveFolder || null });
          }} />
        {folderError
          ? <span role="alert" className="text-xs text-destructive">{folderError}</span>
          : <span className="text-xs text-muted-foreground">Drive에서 위 이메일에 편집자 권한을 주세요.</span>}
      </Field>
      <Field label="우수자 발표 순서">
        <Text type="number" min={0} max={10000} defaultValue={person.awardOrder}
          onBlur={(event) => {
            const awardOrder = Number(event.target.value);
            if (Number.isFinite(awardOrder) && awardOrder !== person.awardOrder) void patch({ awardOrder });
          }} />
      </Field>
    </div>

    <div className="flex flex-wrap gap-2">
      <a href={portal + "?preview=1"} className={button} target="_blank" rel="noopener noreferrer">이 선발자의 활동 화면</a>
      {origin && <button className={button} onClick={() => copy(origin + creatorEntryPath(program.id))}>공통 활동 링크 복사</button>}
      {links.map((link) => {
        const legacyUrl = origin && program.registrationSourceId ? origin + "/creator-go/" + link.code : "";
        const url = creatorPromotionUrl(program.utm, {
          ...link, creator: person.name, program: program.name, handle: (person.channels as Record<string, string>)[link.platform],
        }, legacyUrl);
        return url && <button key={link.code} className={button} onClick={() => copy(url)}>{link.platform} 홍보 링크 복사</button>;
      })}
      <button className={button + " text-muted-foreground"} onClick={async () => {
        if (await confirm({ title: "개인 링크를 다시 발급할까요?", description: "해당 크리에이터에게 새 링크를 전달해야 해요.", tone: "danger" })) {
          await save({ action: "rotateAccess", id: person.id });
        }
      }}>링크 재발급</button>
    </div>

    {(answers.length > 0 || person.assignments.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
      {answers.length > 0 && <div>
        <h4 className="mb-2 text-sm font-medium">신청서 답변</h4>
        <dl className="grid gap-2 text-sm">{answers.map(([key, value]) => <div key={key} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{labels[key] ?? key}</dt>
          <dd className="whitespace-pre-wrap break-words">{applicationText(value)}</dd>
        </div>)}</dl>
      </div>}
      {person.assignments.length > 0 && <div>
        <h4 className="mb-2 text-sm font-medium">미션 진행</h4>
        <ul className="grid content-start gap-2 text-sm">{person.assignments.map((assignment) => <li className="rounded-lg bg-background px-3 py-2" key={assignment.id}>
          {program.missions.find(({ id }) => id === assignment.missionId)?.title} · {statusNames[assignment.status]}
        </li>)}</ul>
      </div>}
    </div>}

    {application && <button type="button" className={button + " justify-self-start text-destructive"} disabled={busy}
      onClick={async () => {
        if (!(await confirm({
          title: person.name + "님의 선발을 취소할까요?",
          description: "신청서 탭에서 다시 선발할 수 있어요. 지금 보낸 개인 링크는 만료되고, 기존 미션과 활동비 기록은 보관돼요.",
          confirmLabel: "선발 취소", tone: "danger",
        }))) return;
        setBusy(true);
        try { await save({ action: "unselect", id: person.id, token: person.token }); }
        finally { setBusy(false); }
      }}>선발 취소</button>}
  </div>;
}

export function PeopleTable({ program, applications, labels, origin, save, copy }: {
  program: CreatorProgramView; applications: Application[]; labels: Record<string, string>;
  origin: string; save: Save; copy: Copy;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(false);
  const [busy, setBusy] = useState(false);

  const columns = applyGridLayout(peopleColumns, creatorGridLayout(program.tableLayout, "people"));
  const visible = columns.filter((column) => !column.hidden);
  const records = new Map(applications.map((record) => [record.id, record]));
  const people = program.participants.filter((person) =>
    (filter === "all"
      || (filter === "confirmed" ? person.confirmed
        : filter === "unconfirmed" ? !person.confirmed
          : filter === "completed" ? person.completed
            : filter === "incomplete" ? !person.completed
              : isCreatorAwarded(person)))
    && [person.name, person.owner, person.contact, person.award, JSON.stringify(person.channels)]
      .some((value) => String(value).toLowerCase().includes(search.toLowerCase())));

  function saveLayout(next: typeof columns) {
    void save({ action: "gridLayout", table: "people", layout: layoutFrom(next) });
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
        <h2 className="text-xl font-semibold">선발 크리에이터</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {program.participants.length}명 선발 · {program.participants.filter(({ confirmed }) => confirmed).length}명 참여 확정 · {program.participants.filter(({ completed }) => completed).length}명 수료 · {program.participants.filter(isCreatorAwarded).length}명 우수자 · 행을 펼치면 프로필과 답변이 나와요
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Text aria-label="크리에이터 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름, 담당자, 계정 검색" />
        <select className={input} aria-label="크리에이터 상태" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">전체</option><option value="confirmed">참여 확정</option><option value="unconfirmed">참여 확인 전</option>
          <option value="completed">수료</option><option value="incomplete">미수료</option><option value="award">우수자</option>
        </select>
        <button className={button} aria-expanded={showColumns} onClick={() => setShowColumns(!showColumns)}>열 설정</button>
      </div>
    </div>

    {showColumns && <ColumnPicker columns={columns}
      onToggle={(key) => saveLayout(columns.map((column) => column.key === key ? { ...column, hidden: !column.hidden } : column))}
      onReset={() => void save({ action: "gridLayout", table: "people", layout: [] })} />}

    {!people.length
      ? <Empty>{program.participants.length ? "검색 결과가 없어요." : "신청서 탭에서 크리에이터를 선발하면 여기에 표시돼요."}</Empty>
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
            {people.map((person) => {
              const application = person.applicationId ? records.get(person.applicationId) : undefined;
              const expanded = open.has(person.id);
              return <Fragment key={person.id}>
                <tr className="border-t border-border/50">
                  <td className="px-2 py-2 align-middle">
                    <RowToggle open={expanded} label={person.name} onToggle={() => setOpen((set) => {
                      const next = new Set(set);
                      if (!next.delete(person.id)) next.add(person.id);
                      return next;
                    })} />
                  </td>
                  {visible.map((column) => <td key={column.key} className="px-2 py-2 align-middle">
                    {column.cell({ person, application, program, save, busy, setBusy })}
                  </td>)}
                </tr>
                {expanded && <tr>
                  <td colSpan={visible.length + 1} className="p-0">
                    <PersonDetail person={person} program={program} application={application}
                      labels={labels} origin={origin} save={save} copy={copy} />
                  </td>
                </tr>}
              </Fragment>;
            })}
          </tbody>
        </table>
      </div>}
  </section>;
}
