"use client";

import { useRef, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { buildPublication, publicationSchema, type CreatorAction } from "@/lib/creator/model";
import type { CreatorProgramView, CreatorView } from "@/lib/creator/types";
import { CreatorPublication } from "./Publication";
import { PeopleTable } from "./PeopleTable";
import { AnnounceMail } from "./AnnounceMail";
import { button, primary, panel, input, Empty, Field, Text } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
type Copy = (value: string) => void;

export function People({ program, applications, labels, origin, programId, save, copy }: {
  program: CreatorProgramView; applications: CreatorView["applications"]; labels: Record<string, string>; origin: string; programId: string; save: Save; copy: Copy;
}) {
  return <section className="grid gap-4">
    <div className={panel}><AnnounceMail program={program} programId={programId} /></div>
    <div className={panel}>
      <PeopleTable program={program} applications={applications} labels={labels} origin={origin} save={save} copy={copy} />
    </div>
  </section>;
}

type AnnouncementProps = {
  program: Pick<CreatorProgramView, "id" | "roster" | "awards"> & { participants: Parameters<typeof buildPublication>[2] };
  projectName: string;
  labels?: Record<string, string>;
  applications?: CreatorView["applications"];
  origin: string;
  save: Save;
  copy: Copy;
};

function PublicationEditor({ kind, program, projectName, labels = {}, applications = [], origin, save, copy }: AnnouncementProps & { kind: "roster" | "awards" }) {
  const confirm = useConfirm();
  const stored = publicationSchema.safeParse(program[kind]);
  const published = Boolean(stored.data?.entries.length);
  const label = kind === "roster" ? "선발 크리에이터 소개" : "우수 크리에이터 발표";
  const awards = kind === "awards";
  const initial = stored.data ?? { title: label, background: awards ? "#fff6fa" : "#fff9f6", accent: awards ? "#a63167" : "#bf3b20" };
  const [theme, setTheme] = useState({ title: initial.title, background: initial.background, accent: initial.accent });
  const [region, setRegion] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const [applicationFields, setApplicationFields] = useState(stored.data?.applicationFields ?? []);
  const records = new Map(applications.map(({ id, data }) => [id, data]));
  const people = program.participants.map((person) => ({
    ...person, applicationData: person.applicationId ? records.get(person.applicationId) : undefined,
  }));
  const preview = buildPublication(kind, theme, people, applicationFields, labels);
  const regionOf = (entry: (typeof preview.entries)[number]) => entry.region?.trim() || projectName;
  const regions = awards ? Array.from(new Set(preview.entries.map(regionOf))).sort((a, b) => a.localeCompare(b, "ko")) : [];
  const activeRegion = regions.includes(region) ? region : "";
  const exportPreview = activeRegion ? { ...preview, entries: preview.entries.filter((entry) => regionOf(entry) === activeRegion) } : preview;
  const path = "/creator-show/" + program.id;
  const linkedSnippet = origin ? '<script async src="' + origin + path + '/embed/' + kind + '"></script>' : "";
  const canCopy = exportPreview.entries.length > 0 && Boolean(theme.title.trim());

  return <article className={panel + " grid gap-4"}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{label}</h3>
      <span className={"rounded-full px-3 py-1 text-xs font-semibold " + (published ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{published ? "마하 공개 중" : "마하 비공개"}</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <Field label="제목"><Text value={theme.title} maxLength={160} onChange={(event) => setTheme({ ...theme, title: event.target.value })} /></Field>
      <Field label="배경 색상"><input className="h-9 w-20 rounded-lg bg-muted p-1" type="color" value={theme.background} onChange={(event) => setTheme({ ...theme, background: event.target.value })} /></Field>
      <Field label="버튼 색상"><input className="h-9 w-20 rounded-lg bg-muted p-1" type="color" value={theme.accent} onChange={(event) => setTheme({ ...theme, accent: event.target.value })} /></Field>
    </div>
    {Object.keys(labels).length > 0 && <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium">공개할 신청서 항목</legend>
      <p className="text-xs text-muted-foreground">이름{awards ? "과 상명" : ""}은 기본으로 표시돼요. 선택한 응답은 공개 페이지와 아임웹 코드에 포함돼요.</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">{Object.entries(labels).map(([key, label]) =>
        <label key={key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={applicationFields.includes(key)} onChange={(event) => {
            const checked = event.target.checked;
            setApplicationFields((fields) => checked ? [...fields, key] : fields.filter((field) => field !== key));
          }} />{label}
        </label>)}</div>
    </fieldset>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      {regions.length > 1 && <Field label="코드블럭 지역">
        <select className={input} value={activeRegion} onChange={(event) => setRegion(event.target.value)}>
          <option value="">전체 지역</option>
          {regions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </Field>}
      <div className="grid gap-1">
        <button type="button" className={primary + " justify-self-start"} disabled={!canCopy} onClick={() => {
          if (previewRef.current) copy(previewRef.current.innerHTML);
        }}>아임웹 코드블럭 복사{canCopy && " · " + exportPreview.entries.length + "명"}</button>
        {canCopy && <p className="text-xs text-muted-foreground">명단이 바뀌면 다시 복사해 아임웹에서 교체하세요.</p>}
      </div>
    </div>
    {exportPreview.entries.length ? <div ref={previewRef} className="min-w-0 overflow-hidden rounded-2xl">
      <CreatorPublication publication={exportPreview} kicker={activeRegion || (regions.length === 1 ? regions[0] : projectName)} awards={awards} />
    </div> : <Empty>{awards ? "선발 크리에이터에게 상명을 입력하면 우수자 코드블럭이 생성돼요." : "크리에이터를 선발하면 소개 코드블럭이 생성돼요."}</Empty>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!preview.entries.length || !theme.title.trim()} onClick={async () => {
        if (await confirm({ title: label + "를 공개할까요?", description: "이 회차의 전체 명단과 색상이 마하 공개 페이지에 게시돼요." })) {
          await save({ action: "publish", kind, theme, applicationFields: preview.applicationFields });
        }
      }}>{published ? "마하 공개 페이지 갱신" : "마하 공개 페이지 발행"}</button>
      {published && origin && <>
        <a className={button} href={origin + path + "/" + kind} target="_blank" rel="noopener noreferrer">공개 페이지 열기</a>
        <button className={button} onClick={() => copy(linkedSnippet)}>연동 코드 복사</button>
      </>}
      {published && <button className={button + " text-muted-foreground"} onClick={async () => {
        if (await confirm({ title: "발표를 비공개로 전환할까요?", description: "마하 공개 페이지와 연동 코드를 사용한 곳에서 목록이 숨겨져요." })) await save({ action: "publish", kind, theme: null });
      }}>비공개 전환</button>}
    </div>
  </article>;
}

export function Announcements(props: AnnouncementProps) {
  return <section className="grid gap-4">
    <PublicationEditor kind="roster" {...props} />
    <PublicationEditor kind="awards" {...props} />
  </section>;
}
