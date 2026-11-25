"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { buildPublication, platforms, profileSchema, publicationSchema, type CreatorAction } from "@/lib/creator/model";
import type { CreatorPerson, CreatorProgramView, CreatorView } from "@/lib/creator/types";
import { CreatorPublication } from "./Publication";
import { applicationText } from "./Recruitment";
import { AnnounceMail } from "./AnnounceMail";
import { button, primary, panel, input, dateTime, Empty, Field, Text, feeNames, statusNames } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
type Copy = (value: string) => void;

function Person({ person, program, origin, application, labels, save, copy }: {
  person: CreatorPerson; program: CreatorProgramView; origin: string; application?: CreatorView["applications"][number]; labels: Record<string, string>; save: Save; copy: Copy;
}) {
  const confirm = useConfirm();
  const [profile, setProfile] = useState(profileSchema.parse(person.profile));
  const [channels, setChannels] = useState(person.channels as Partial<Record<typeof platforms[number], string>>);
  const [busy, setBusy] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const portal = origin + "/creator-portal/" + person.token;
  const answers = Object.entries((application?.data ?? {}) as Record<string, unknown>).filter(([key]) => !key.startsWith("__"));
  const done = person.assignments.filter(({ status }) => status === "done").length;
  const profileFields = {
    image: "사진 URL", bio: "소개", region: "활동 지역", languages: "사용 언어", interests: "관심사",
    publicContact: "공개 연락처", social: "공개 SNS URL",
  } as const;

  return <article className={panel + " grid gap-4"}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="break-words text-lg font-semibold">{person.name}</h3>
        <p className="text-sm text-muted-foreground">{person.confirmed ? "참여 확정" : "선발 · 참여 확인 전"} · 미션 {done}/{person.assignments.length}
          {person.lastEmailedAt ? ` · 안내 메일 ${dateTime(person.lastEmailedAt)}` : ""}</p></div>
      <div className="flex flex-wrap gap-2">
        <a href={portal + "?preview=1"} className={button} target="_blank" rel="noopener noreferrer">개인 페이지 확인</a>
        {origin && <button className={button} onClick={() => copy(portal)}>개인 링크 복사</button>}
        <button className={button + " text-muted-foreground"} onClick={async () => {
          if (await confirm({ title: "개인 링크를 다시 발급할까요?", description: "해당 크리에이터에게 새 링크를 전달해야 해요.", tone: "danger" })) {
            await save({ action: "rotateAccess", id: person.id });
          }
        }}>링크 재발급</button>
      </div>
    </div>
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const value = (key: string) => String(form.get(key) ?? "");
      setBusy(true);
      try {
        await save({ action: "participant", id: person.id, patch: {
          name: value("name"), owner: value("owner"), contact: value("contact"),
          feeStatus: value("fee") as "unpaid" | "scheduled" | "paid", paidOn: value("paidOn") || null,
          award: value("award"), awardOrder: Number(value("awardOrder")), channels, profile,
        } });
      } finally { setBusy(false); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="이름"><Text name="name" required maxLength={160} defaultValue={person.name} /></Field>
        <Field label="담당자"><Text name="owner" maxLength={160} defaultValue={person.owner} /></Field>
        <Field label="운영 연락처 또는 DM URL"><Text name="contact" maxLength={400} defaultValue={person.contact} placeholder={application?.emailNormalized ?? "이메일 또는 URL"} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={person.confirmed} disabled={confirmationPending} onChange={async (event) => {
          const confirmed = event.target.checked;
          setConfirmationPending(true);
          try { await save({ action: "participant", id: person.id, patch: { confirmed } }); }
          finally { setConfirmationPending(false); }
        }} />참여 확정</label>
        <Field label="활동비 상태"><select className={input} name="fee" defaultValue={person.feeStatus}>{Object.entries(feeNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="지급일 또는 예정일"><Text name="paidOn" type="date" defaultValue={person.paidOn ?? ""} /></Field>
        <Field label="우수자 상명"><Text name="award" maxLength={160} defaultValue={person.award} placeholder="예. 최우수상" /></Field>
        <Field label="우수자 발표 순서"><Text name="awardOrder" type="number" min={0} max={10000} defaultValue={person.awardOrder} /></Field>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><legend className="mb-2 font-medium">홍보 계정</legend>
        {platforms.map((platform) => <Field key={platform} label={platform}>
          <Text value={channels[platform] ?? ""} maxLength={160} placeholder="@계정" onChange={(event) => setChannels({ ...channels, [platform]: event.target.value })} />
        </Field>)}
      </fieldset>
      <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><legend className="mb-2 font-medium">발표에 사용할 공개 프로필</legend>
        {(Object.entries(profileFields) as [keyof typeof profile, string][]).map(([key, label]) => <Field key={key} label={label}>
          {key === "bio" || key === "interests" ? <textarea className={input} rows={2} value={profile[key] ?? ""} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} />
            : <Text type={key === "image" || key === "social" ? "url" : "text"} value={profile[key] ?? ""} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} />}
        </Field>)}
      </fieldset>
      <button className={primary + " justify-self-start"} disabled={busy}>{busy ? "저장 중…" : "크리에이터 저장"}</button>
    </form>
    {program.registrationSourceId && person.links.some(({ platform }) => Boolean((person.channels as Record<string, string>)[platform])) && (
      <ul className="flex flex-wrap gap-2" aria-label="등록 홍보 링크">{person.links.filter(({ platform }) => Boolean((person.channels as Record<string, string>)[platform])).map((link) =>
        <li key={link.code}><button className={button} disabled={!origin} onClick={() => copy(origin + "/creator-go/" + link.code)}>{link.platform} 홍보 링크 복사</button></li>,
      )}</ul>
    )}
    {(answers.length > 0 || person.assignments.length > 0) && <details className="text-sm">
      <summary className="cursor-pointer font-medium">신청서와 미션 진행 내역</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {answers.length > 0 && <dl className="grid gap-2">{answers.map(([key, value]) => <div key={key} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{labels[key] ?? key}</dt><dd className="whitespace-pre-wrap break-words">{applicationText(value)}</dd>
        </div>)}</dl>}
        {!!person.assignments.length && <ul className="grid content-start gap-2">{person.assignments.map((assignment) => <li className="rounded-lg bg-muted/35 px-3 py-2" key={assignment.id}>
          {program.missions.find(({ id }) => id === assignment.missionId)?.title} · {statusNames[assignment.status]}
        </li>)}</ul>}
      </div>
    </details>}
    {application && <button type="button" className={button + " justify-self-start text-destructive"} disabled={withdrawing || busy || confirmationPending}
      onClick={async () => {
        if (!(await confirm({
          title: person.name + "님의 선발을 취소할까요?",
          description: "신청서 탭에서 다시 선발할 수 있어요. 지금 보낸 개인 링크는 만료되고, 기존 미션과 활동비 기록은 보관돼요.",
          confirmLabel: "선발 취소", tone: "danger",
        }))) return;
        setWithdrawing(true);
        try { await save({ action: "unselect", id: person.id, token: person.token }); }
        finally { setWithdrawing(false); }
      }}>{withdrawing ? "처리 중…" : "선발 취소"}</button>}
  </article>;
}

export function People({ program, applications, labels, origin, programId, save, copy }: {
  program: CreatorProgramView; applications: CreatorView["applications"]; labels: Record<string, string>; origin: string; programId: string; save: Save; copy: Copy;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const records = new Map(applications.map((record) => [record.id, record]));
  const people = program.participants.filter((person) => (filter === "all" || (filter === "confirmed" ? person.confirmed : filter === "unconfirmed" ? !person.confirmed : !!person.award))
    && [person.name, person.owner, person.contact, person.award, JSON.stringify(person.channels)].some((value) => value.toLowerCase().includes(search.toLowerCase())));
  return <section className="grid gap-4">
    <div className={panel + " flex flex-wrap items-center justify-between gap-3"}>
      <div><h2 className="text-xl font-semibold">선발 크리에이터</h2><p className="mt-1 text-sm text-muted-foreground">{program.participants.length}명 선발 · {program.participants.filter(({ confirmed }) => confirmed).length}명 참여 확정</p></div>
      <div className="flex flex-wrap gap-2"><Text aria-label="크리에이터 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름, 담당자, 계정 검색" />
        <select className={input} aria-label="크리에이터 상태" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">전체</option><option value="confirmed">참여 확정</option><option value="unconfirmed">참여 확인 전</option><option value="award">우수자</option>
        </select>
      </div>
    </div>
    <div className={panel}><AnnounceMail program={program} programId={programId} /></div>
    {people.map((person) => <Person key={person.id} person={person} program={program} application={person.applicationId ? records.get(person.applicationId) : undefined} labels={labels} origin={origin} save={save} copy={copy} />)}
    {!people.length && <Empty>{program.participants.length ? "검색 결과가 없어요." : "신청서 탭에서 크리에이터를 선발하면 여기에 표시돼요."}</Empty>}
  </section>;
}

function PublicationEditor({ kind, program, origin, save, copy }: { kind: "roster" | "awards"; program: CreatorProgramView; origin: string; save: Save; copy: Copy }) {
  const confirm = useConfirm();
  const stored = publicationSchema.safeParse(program[kind]);
  const published = Boolean(stored.data?.entries.length);
  const label = kind === "roster" ? "선발 크리에이터 소개" : "우수 크리에이터 발표";
  const initial = stored.data ?? { title: label, background: "#ffffff", accent: "#4338ca" };
  const [theme, setTheme] = useState({ title: initial.title, background: initial.background, accent: initial.accent });
  const preview = buildPublication(kind, theme, program.participants);
  const path = "/creator-show/" + program.id;
  const snippet = origin ? '<script async src="' + origin + path + '/embed/' + kind + '"></script>' : "";

  return <article className={panel + " grid gap-4"}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{label}</h3>
      <span className={"rounded-full px-3 py-1 text-xs font-semibold " + (published ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{published ? "공개 중" : "비공개"}</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <Field label="제목"><Text value={theme.title} maxLength={160} onChange={(event) => setTheme({ ...theme, title: event.target.value })} /></Field>
      <Field label="배경 색상"><input className="h-9 w-20 rounded-lg bg-muted p-1" type="color" value={theme.background} onChange={(event) => setTheme({ ...theme, background: event.target.value })} /></Field>
      <Field label="버튼 색상"><input className="h-9 w-20 rounded-lg bg-muted p-1" type="color" value={theme.accent} onChange={(event) => setTheme({ ...theme, accent: event.target.value })} /></Field>
    </div>
    {preview.entries.length ? <CreatorPublication publication={preview} /> : <Empty>{kind === "awards" ? "선발 크리에이터에게 상명을 입력하면 미리볼 수 있어요." : "크리에이터를 선발하면 미리볼 수 있어요."}</Empty>}
    <div className="flex flex-wrap gap-2">
      <button className={primary} disabled={!preview.entries.length || !theme.title.trim()} onClick={async () => {
        if (await confirm({ title: label + "를 공개할까요?", description: "미리보기에 포함된 공개 프로필과 색상이 게시돼요." })) {
          await save({ action: "publish", kind, theme });
        }
      }}>{published ? "변경사항 발행" : "공개하기"}</button>
      {snippet && <button className={button} onClick={() => copy(snippet)}>아임웹 코드 복사</button>}
      {published && <><a className={button} href={origin + path + "/" + kind} target="_blank" rel="noopener noreferrer">공개 페이지 열기</a>
        <button className={button + " text-muted-foreground"} onClick={async () => {
          if (await confirm({ title: "발표를 비공개로 전환할까요?", description: "공개 페이지와 아임웹 임베드에서 목록이 숨겨져요." })) await save({ action: "publish", kind, theme: null });
        }}>비공개 전환</button></>}
    </div>
  </article>;
}

export function Announcements(props: { program: CreatorProgramView; origin: string; save: Save; copy: Copy }) {
  return <section className="grid gap-4">
    <PublicationEditor kind="roster" {...props} />
    <PublicationEditor kind="awards" {...props} />
  </section>;
}
