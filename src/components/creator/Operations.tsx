"use client";

import { useState } from "react";
import { webUrl, platforms, workQueue, type CreatorAction } from "@/lib/creator/model";
import { kstDateString, kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";
import type { CreatorContact, CreatorMissionView, CreatorPerson, CreatorProgramView, CreatorView } from "@/lib/creator/types";
import { History } from "./CreatorPortal";
import { button, primary, input, Empty, Field, panel, Text, dateTime } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
type Copy = (value: string) => void;
const groups = { soon: "24시간 내 미제출", overdue: "마감 지남", revision: "수정 요청 중", review: "검수 대기" } as const;
type Queue = keyof typeof groups;
type Work = { person: CreatorPerson; assignment: CreatorPerson["assignments"][number]; mission: CreatorMissionView; contact: string };
function missionDate(value: FormDataEntryValue | null) {
  return typeof value === "string" && value ? kstDateTimeLocalToIso(value) : null;
}

function MissionEditor({ mission, save, onDone }: { mission?: CreatorMissionView; save: Save; onDone?: () => void }) {
  const chosen = (mission?.platforms ?? ["instagram", "tiktok"]) as (typeof platforms[number])[];
  const [busy, setBusy] = useState(false);
  return <form className={panel + " grid gap-4"} onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      if (await save({ action: "mission", id: mission?.id, mission: {
        title: String(form.get("title")), guide: String(form.get("guide")),
        startsAt: missionDate(form.get("startsAt")), dueAt: missionDate(form.get("dueAt")) ?? "",
        linkCount: Number(form.get("linkCount")), draft: form.get("draft") === "on",
        proof: form.get("proof") as "off" | "optional" | "required",
        platforms: form.getAll("platform") as typeof chosen,
      } })) onDone?.();
    } finally { setBusy(false); }
  }}>
    {!mission && <h3 className="text-lg font-semibold">미션 추가</h3>}
    <div className="grid gap-3 lg:grid-cols-3">
      <Field label="미션 이름"><Text name="title" required maxLength={160} defaultValue={mission?.title ?? ""} /></Field>
      <Field label="게시 시작 (KST)"><Text name="startsAt" type="datetime-local" defaultValue={mission?.startsAt ? kstDateTimeLocalInput(mission.startsAt) : ""} /></Field>
      <Field label="제출 마감 (KST)"><Text name="dueAt" type="datetime-local" required defaultValue={mission?.dueAt ? kstDateTimeLocalInput(mission.dueAt) : ""} /></Field>
      <Field label="필수 게시 링크 수"><Text name="linkCount" type="number" min={0} max={10} defaultValue={mission?.linkCount ?? 1} required /></Field>
      <Field label="최종 제출 증빙 파일"><select className={input} name="proof" defaultValue={mission?.proof ?? "optional"}>
        <option value="off">사용 안 함</option><option value="optional">선택</option><option value="required">필수</option>
      </select></Field>
      <label className="flex items-end gap-2 self-end pb-2 text-sm"><input className="mb-1" type="checkbox" name="draft" defaultChecked={mission?.draft ?? false} />게시 전 초안 검수</label>
    </div>
    <Field label="미션 가이드"><textarea className={input} name="guide" rows={3} defaultValue={mission?.guide ?? ""} maxLength={10000} /></Field>
    <fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-xs font-medium text-muted-foreground">허용 채널</legend>
      {platforms.map((platform) => <label key={platform} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="platform" value={platform} defaultChecked={chosen.includes(platform)} />{platform}</label>)}
    </fieldset>
    <button className={primary + " justify-self-start"} disabled={busy}>{busy ? "저장 중…" : mission ? "미션 저장" : "미션 만들기"}</button>
  </form>;
}

export function Missions({ program, save }: { program: CreatorProgramView; save: Save }) {
  const [newForm, setNewForm] = useState(!program.missions.length);
  return <section className="grid gap-4">
    <div className={panel + " flex flex-wrap items-center justify-between gap-3"}>
      <div><h2 className="text-xl font-semibold">미션</h2><p className="mt-1 text-sm text-muted-foreground">만든 미션은 선발 크리에이터들의 개인 페이지에 배정돼요.</p></div>
      <button className={primary} aria-expanded={newForm} onClick={() => setNewForm(!newForm)}>{newForm ? "추가 닫기" : "미션 추가"}</button>
    </div>
    {newForm && <MissionEditor save={save} onDone={() => setNewForm(false)} />}
    {program.missions.map((mission) => <MissionEditor key={mission.id} mission={mission} save={save} />)}
  </section>;
}

function queueContactUrl(contact: string) {
  if (webUrl.safeParse(contact).success) return contact;
  if (/^[^\s@?&]+@[^\s@?&]+\.[^\s@?&]+$/.test(contact)) return "mailto:" + encodeURIComponent(contact);
  if (/^\+?[\d -]{7,20}$/.test(contact)) return "tel:" + contact.replace(/[ -]/g, "");
  return "";
}

function QueueItem({ work, group, projectId, origin, save, copy }: { work: Work; group: Queue; projectId: string; origin: string; save: Save; copy: Copy }) {
  const { person, assignment, mission, contact } = work;
  const [feedback, setFeedback] = useState("");
  const [method, setMethod] = useState("DM");
  const [busy, setBusy] = useState(false);
  const contacts = assignment.contacts as CreatorContact[];
  const last = contacts.at(-1);
  const contactUrl = queueContactUrl(contact);

  async function submit(action: CreatorAction) {
    setBusy(true);
    try { if (await save(action)) setFeedback(""); }
    finally { setBusy(false); }
  }

  return <article className="grid min-w-0 gap-3 rounded-xl bg-muted/28 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="break-words font-semibold">{person.name} <span className="font-normal text-muted-foreground">· {mission.title}</span></h3>
        <p className="mt-1 text-xs text-muted-foreground">{assignment.stage === "draft" ? "초안" : "최종"} · 마감 {dateTime(mission.dueAt)} (KST) · 담당 {person.owner || "미지정"}</p>
      </div>
      <span className="text-xs text-muted-foreground">{last ? "최근 연락 " + dateTime(last.at) + " · " + last.channel : "연락 기록 없음"}</span>
    </div>
    {group === "review" ? <>
      <History history={assignment.history} proofBase={"/api/creators/" + projectId + "/proof/"} uploads={assignment.uploads} />
      <Field label="검수 피드백"><textarea className={input} rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="수정 요청할 때는 변경 내용을 입력해 주세요." /></Field>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy} onClick={() => void submit({ action: "review", id: assignment.id, version: assignment.version, approved: true, feedback })}>{assignment.stage === "draft" ? "초안 승인" : "완료 승인"}</button>
        <button className={button} disabled={busy || !feedback.trim()} onClick={() => void submit({ action: "review", id: assignment.id, version: assignment.version, approved: false, feedback })}>수정 요청</button>
      </div>
    </> : <div className="flex flex-wrap items-center gap-2">
      <button className={primary} disabled={!origin} onClick={() => copy(
        person.name + "님, 안녕하세요! " + mission.title + " 미션의 " + (assignment.stage === "draft" ? "초안" : "최종") +
        (assignment.status === "revision" ? " 수정 후 다시 제출" : " 제출") + "을 부탁드려요. 마감은 " + dateTime(mission.dueAt) + " (KST)입니다.\n개인 활동 링크 " + origin + "/creator-portal/" + person.token,
      )}>리마인드 복사</button>
      {contactUrl ? <a className={button} href={contactUrl} target="_blank" rel="noopener noreferrer">연락 열기</a> :
        contact && <span className="break-all text-xs text-muted-foreground">{contact}</span>}
      <select aria-label="연락 채널" className={input} value={method} onChange={(event) => setMethod(event.target.value)}>{["DM", "이메일", "전화", "기타"].map((channel) => <option key={channel}>{channel}</option>)}</select>
      <button className={button} disabled={busy} onClick={() => void submit({ action: "contact", id: assignment.id, channel: method })}>연락 완료 기록</button>
    </div>}
    {contacts.length > 1 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">연락 이력 {contacts.length}건</summary>
      <ul className="mt-2 grid gap-1">{[...contacts].reverse().map(({ at, channel }, index) => <li key={index}>{dateTime(at)} · {channel}</li>)}</ul></details>}
  </article>;
}

function ConversionMetrics({ program, registrations }: { program: CreatorProgramView; registrations: CreatorView["registrations"] }) {
  const [range, setRange] = useState(14);
  const [now] = useState(() => Date.now());
  const links = program.participants.flatMap((person) => person.links.map((link) => ({ ...link, person: person.name })));
  const totals = new Map<string, number>();
  const daily = new Map<string, number>();
  registrations.forEach(({ utmId, day, count }) => {
    totals.set(utmId, (totals.get(utmId) ?? 0) + count);
    daily.set(day, (daily.get(day) ?? 0) + count);
  });
  const registered = registrations.reduce((sum, item) => sum + item.count, 0);
  const days = Array.from({ length: range }, (_, index) => {
    const day = kstDateString(now - (range - 1 - index) * 86400000);
    return { day, value: daily.get(day) ?? 0 };
  });
  const max = Math.max(1, ...days.map(({ value }) => value));
  return <section className={panel + " grid gap-4"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">방문객 등록 성과</h2>
        {program.registrationSourceId && <p className="mt-1 text-sm text-muted-foreground">등록 {registered.toLocaleString()}건 · 링크 클릭 {links.reduce((sum, link) => sum + link.clicks, 0).toLocaleString()}회</p>}
      </div>
      {program.registrationSourceId && <select aria-label="일별 등록 기간" className={input} value={range} onChange={(event) => setRange(Number(event.target.value))}><option value={14}>최근 14일</option><option value={30}>최근 30일</option></select>}
    </div>
    {program.registrationSourceId ? <>
      <ol aria-label="일별 등록 건수" className="flex h-28 items-end gap-1 rounded-xl bg-muted/25 px-3 pb-1 pt-4 sm:gap-2">
        {days.map(({ day, value }) => <li key={day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={day + " · " + value + "건"}>
          <span className="sr-only">{day} {value}건</span><div aria-hidden="true" className="min-h-px w-full max-w-8 rounded-t bg-primary/70" style={{ height: (value / max * 100) + "%" }} />
        </li>)}
      </ol>
      <div className="-mt-3 flex justify-between text-xs text-muted-foreground"><span>{days[0]?.day}</span><span>{days.at(-1)?.day}</span></div>
      {links.length ? <div className="overflow-x-auto"><table className="w-full min-w-72 text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">크리에이터</th><th>채널</th><th className="text-right">클릭</th><th className="text-right">등록</th></tr></thead>
        <tbody>{links.sort((a, b) => (totals.get(b.code) ?? 0) - (totals.get(a.code) ?? 0)).map((link) => <tr key={link.code} className="border-t border-border/50">
          <td className="py-2">{link.person}</td><td>{link.platform}</td><td className="text-right tabular-nums">{link.clicks}</td><td className="text-right font-semibold tabular-nums">{totals.get(link.code) ?? 0}</td>
        </tr>)}</tbody>
      </table></div> : <Empty>선발자에게 홍보 계정을 추가하면 채널별 성과가 표시돼요.</Empty>}
    </> : <Empty>설정에서 방문객 등록 폼을 연결하면 홍보 링크로 유입된 등록을 집계해요.</Empty>}
  </section>;
}

export function Dashboard({ data, program, projectId, origin, save, copy }: {
  data: CreatorView; program: CreatorProgramView; projectId: string; origin: string; save: Save; copy: Copy;
}) {
  const [group, setGroup] = useState<Queue>("soon");
  const [now] = useState(() => Date.now());
  const missions = new Map(program.missions.map((mission) => [mission.id, mission]));
  const applicants = new Map(data.applications.map(({ id, emailNormalized, phoneE164 }) => [id, emailNormalized || phoneE164]));
  const work: Work[] = program.participants.flatMap((person) => person.assignments.flatMap((assignment) => {
    const mission = missions.get(assignment.missionId);
    return mission ? [{ person, assignment, mission, contact: person.contact || (person.applicationId ? applicants.get(person.applicationId) : "") || "" }] : [];
  })).sort((a, b) => a.mission.dueAt.localeCompare(b.mission.dueAt));
  const queues = Object.fromEntries((Object.keys(groups) as Queue[]).map((key) => [key, work.filter(({ mission, assignment }) => workQueue({ ...assignment, mission }, now) === key)])) as Record<Queue, Work[]>;

  return <div className="grid gap-5">
    <section className={panel + " grid gap-4"}>
      <div><h2 className="text-xl font-semibold">지금 처리할 일</h2><p className="mt-1 text-sm text-muted-foreground">미제출자에게 연락하고 들어온 게시물과 초안을 검수하세요.</p></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="할 일 유형">
        {(Object.entries(groups) as [Queue, string][]).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={group === key} className={"grid gap-1 rounded-xl p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none " +
            (group === key ? "bg-primary text-primary-foreground" : "bg-muted/45")} onClick={() => setGroup(key)}>
            <span className="text-xs font-medium">{label}</span><strong className="text-xl tabular-nums">{queues[key].length}</strong>
          </button>
        ))}
      </div>
      {!queues[group].length ? <Empty>해당하는 미션이 없어요.</Empty> : queues[group].map((work) => (
        <QueueItem key={work.assignment.id} work={work} group={group} projectId={projectId} origin={origin} save={save} copy={copy} />
      ))}
    </section>
    <section className={panel + " grid gap-4"}>
      <h2 className="text-xl font-semibold">미션 완료율</h2>
      {program.missions.length ? <ul className="grid gap-3">{program.missions.map((mission) => {
        const assigned = work.filter((item) => item.mission.id === mission.id);
        const done = assigned.filter(({ assignment }) => assignment.status === "done").length;
        return <li key={mission.id} className="grid gap-1">
          <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{mission.title}</span><span className="text-muted-foreground">{done}/{assigned.length} 완료</span></div>
          <progress className="h-2 w-full accent-primary" aria-label={mission.title + " 완료율"} value={done} max={assigned.length || 1} />
        </li>;
      })}</ul> : <Empty>미션을 추가하면 진행률이 표시돼요.</Empty>}
    </section>
    <ConversionMetrics program={program} registrations={data.registrations} />
  </div>;
}
