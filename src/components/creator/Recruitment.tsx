"use client";

import { useState } from "react";
import Link from "next/link";
import { creatorUtm, platforms, type CreatorAction, type Utm } from "@/lib/creator/model";
import { detectSocialAccounts, parseAccount } from "@/lib/creator/social";
import type { CreatorView, CreatorProgramView } from "@/lib/creator/types";
import { button, primary, input, panel, Empty, Field, Text, dateTime } from "./ui";

type Save = (action: CreatorAction) => Promise<boolean>;
type Copy = (value: string) => void;
type App = CreatorView["applications"][number];

const modes = { fixed: "고정값", platform: "SNS 플랫폼", handle: "계정 이름", creator: "크리에이터 이름", program: "프로그램 이름" } as const;

export function CreatorSettings({ program, sources, origin, save, copy }: {
  program: CreatorProgramView; sources: CreatorView["sources"]; origin: string; save: Save; copy: Copy;
}) {
  const [name, setName] = useState(program.name);
  const [application, setApplication] = useState(program.applicationSourceId ?? "");
  const [registration, setRegistration] = useState(program.registrationSourceId ?? "");
  const [utm, setUtm] = useState(creatorUtm(program.utm));
  const [saving, setSaving] = useState(false);
  const id = program.applicationSourceId;
  const registrationForm = sources.find((source) => source.id === registration);
  const url = id ? origin + "/register/" + id : "";
  const snippet = id && origin ? '<script async src="' + origin + '/f/' + id + '"></script>\n<div data-mach-form></div>' : "";

  return <section className={panel + " grid gap-5"}>
    <div><h2 className="text-xl font-semibold">폼과 홍보 링크 연결</h2><p className="mt-1 text-sm text-muted-foreground">이 프로젝트의 신청서와 방문객 등록 폼을 연결하세요.</p></div>
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      setSaving(true);
      try { await save({ action: "settings", name, applicationSourceId: application || null, registrationSourceId: registration || null, utm }); }
      finally { setSaving(false); }
    }}>
      <div className="grid gap-3 lg:grid-cols-3">
        <Field label="프로그램 이름"><Text required value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="크리에이터 모집 폼">
          <select className={input} value={application} onChange={(event) => setApplication(event.target.value)} disabled={program._count.participants > 0}>
            <option value="">연결 안 함</option>{sources.filter(({ mode }) => mode === "builder").map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
            {application && !sources.some(({ id }) => id === application) && <option value={application}>중지된 폼</option>}
          </select>
        </Field>
        <Field label="방문객 등록 폼">
          <select className={input} value={registration} onChange={(event) => setRegistration(event.target.value)}>
            <option value="">연결 안 함</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
            {registration && !sources.some(({ id }) => id === registration) && <option value={registration}>중지된 폼</option>}
          </select>
          {registrationForm?.mode === "capture" && !registrationForm.dedupKeyFields.length && <span>이 폼의 등록 설정에서 중복 판단 기준을 지정할 수 있어요.</span>}
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-semibold">채널별 UTM 생성 규칙</legend>
        {(Object.keys(utm) as (keyof Utm)[]).map((key) => (
          <div key={key} className="grid items-center gap-2 rounded-lg bg-muted/25 px-3 py-2 sm:grid-cols-[9rem_11rem_1fr]">
            <span className="font-mono text-sm">utm_{key}</span>
            <select aria-label={"utm_" + key + " 규칙"} value={utm[key].mode} className={input}
              onChange={(event) => setUtm({ ...utm, [key]: { ...utm[key], mode: event.target.value as Utm[typeof key]["mode"] } })}>
              {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {utm[key].mode === "fixed" ? <Text aria-label={"utm_" + key + " 값"} value={utm[key].value}
              onChange={(event) => setUtm({ ...utm, [key]: { ...utm[key], value: event.target.value } })} /> :
              <span className="text-sm text-muted-foreground">{modes[utm[key].mode]} 자동 입력</span>}
          </div>
        ))}
      </fieldset>
      <button className={primary + " justify-self-start"} disabled={saving}>{saving ? "저장 중…" : "연결 및 UTM 저장"}</button>
    </form>
    <div className="flex flex-wrap gap-2">
      {id ? <Link href={"/collect/" + id} className={button}>모집 폼 편집</Link> :
        <button className={button} disabled={saving} onClick={async () => {
          setSaving(true);
          try { await save({ action: "createApplicationForm" }); }
          finally { setSaving(false); }
        }}>이 프로젝트에 모집 폼 만들기</button>}
      {url && <a className={button} href={url} target="_blank" rel="noopener noreferrer">모집 폼 열기</a>}
      {url && origin && <button className={button} onClick={() => copy(url)}>모집 링크 복사</button>}
      {snippet && <button className={button} onClick={() => copy(snippet)}>아임웹 모집 폼 코드 복사</button>}
      {program.registrationSourceId && <Link href={"/collect/" + program.registrationSourceId} className={button}>방문객 등록 폼 편집</Link>}
    </div>
  </section>;
}

export function applicationText(value: unknown): string {
  return Array.isArray(value) ? value.map(applicationText).join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
}

type Account = { platform: typeof platforms[number]; handle: string };

/**
 * 신청서에서 찾아낸 계정들로 선발 화면을 미리 채운다. 발굴 후보 표에 적어 둔 계정도 함께 본다.
 * 계정이 여럿이면 **채널마다 홍보 링크가 따로 발급된다** — 그래서 한 줄이 아니라 여러 줄이다.
 */
function initialAccounts(raw: Record<string, unknown>, candidateCells: Record<string, unknown>, labels: Record<string, string>): Account[] {
  const detected = detectSocialAccounts(raw, labels);
  const isPlatform = (value: string): value is typeof platforms[number] => platforms.some((platform) => platform === value);
  const candidatePlatform = String(candidateCells.platform ?? "").toLowerCase().trim();
  const candidateHandle = parseAccount(applicationText(candidateCells.handle ?? "")).handle;
  if (candidateHandle && isPlatform(candidatePlatform) && !detected[candidatePlatform]) detected[candidatePlatform] = candidateHandle;
  const accounts = (Object.entries(detected) as [typeof platforms[number], string][]).map(([platform, handle]) => ({ platform, handle }));
  return accounts.length ? accounts : [{ platform: "instagram", handle: candidateHandle }];
}

function JoinApplicant({ record, candidate, selected, save, labels }: { record: App; candidate?: CreatorProgramView["candidates"][number]; selected: boolean; save: Save; labels: Record<string, string> }) {
  const raw = (record.data ?? {}) as Record<string, unknown>;
  const candidateCells = (candidate?.cells ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(applicationText(raw.name || raw.fullName || raw.full_name || raw["이름"] || candidateCells.name || ""));
  const [accounts, setAccounts] = useState<Account[]>(() => initialAccounts(raw, candidateCells, labels));
  const [busy, setBusy] = useState(false);
  const filled = accounts.filter(({ handle }) => handle.trim());

  return <article className="grid gap-3 rounded-xl bg-muted/25 p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="break-words font-semibold">{name || record.emailNormalized || record.phoneE164 || "모집 신청서"}</h3>
        <p className="text-xs text-muted-foreground">{dateTime(record.createdAt)} · {candidate ? "발굴 후보" : "공개 모집"}</p></div>
      {selected && <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold">선발됨</span>}
    </div>
    <details className="text-sm"><summary className="cursor-pointer font-medium">신청서 답변 보기</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {Object.entries(raw).filter(([key]) => !key.startsWith("__")).map(([key, value]) => <div key={key} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{labels[key] ?? key}</dt><dd className="whitespace-pre-wrap break-words">{applicationText(value)}</dd>
        </div>)}
      </dl>
    </details>
    {!selected && <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      try {
        const channels: Partial<Record<typeof platforms[number], string>> = {};
        for (const { platform, handle } of filled) channels[platform] ??= handle.trim();
        await save({ action: "select", applicationId: record.id, name, channels });
      } finally { setBusy(false); }
    }}>
      <Field label="운영 명단 이름"><Text required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">SNS 계정 — 채널마다 홍보 링크가 따로 발급돼요</legend>
        {accounts.map((account, index) => <div key={index} className="grid items-end gap-2 sm:grid-cols-[auto_1fr_auto]">
          <Field label="채널"><select className={input} value={account.platform} aria-label={`${index + 1}번째 채널`}
            onChange={(event) => setAccounts(accounts.map((item, i) => i === index ? { ...item, platform: event.target.value as typeof platforms[number] } : item))}>
            {platforms.map((item) => <option key={item}>{item}</option>)}
          </select></Field>
          <Field label="계정"><Text maxLength={160} value={account.handle} placeholder="@계정 또는 채널 주소"
            onChange={(event) => setAccounts(accounts.map((item, i) => i === index ? { ...item, handle: event.target.value } : item))} /></Field>
          <button type="button" className={button + " text-muted-foreground"} aria-label={`${index + 1}번째 채널 삭제`}
            onClick={() => setAccounts(accounts.length > 1 ? accounts.filter((_, i) => i !== index) : [{ platform: "instagram", handle: "" }])}>삭제</button>
        </div>)}
        <button type="button" className={button + " justify-self-start"} onClick={() => setAccounts([...accounts, { platform: "instagram", handle: "" }])}>채널 추가</button>
      </fieldset>
      {!filled.length && <p className="text-xs text-muted-foreground">계정을 비워 두면 홍보 링크가 발급되지 않아요. 선발 후 선발자 탭에서 채워도 그때 만들어져요.</p>}
      <button className={primary + " justify-self-start"} disabled={busy}>{busy ? "저장 중…" : filled.length > 1 ? `선발 · 링크 ${filled.length}개 발급` : "선발"}</button>
    </form>}
  </article>;
}

export function Applicants({ program, applications, save, labels }: { program: CreatorProgramView; applications: App[]; save: Save; labels: Record<string, string> }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const selected = new Set(program.participants.map(({ applicationId }) => applicationId));
  const candidates = new Map(program.candidates.map((row) => [row.invite, row]));
  const filtered = applications.filter((record) => (filter === "all" || selected.has(record.id) === (filter === "selected")) &&
    [record.emailNormalized, record.phoneE164, JSON.stringify(record.data)].some((value) => value?.toLowerCase().includes(search.toLowerCase())));
  return <section className={panel + " grid gap-4"}>
    <div><h2 className="text-xl font-semibold">모집 신청서</h2><p className="mt-1 text-sm text-muted-foreground">모집 폼으로 신청서를 제출한 사람을 선발하세요.</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <Text value={search} aria-label="신청서 검색" onChange={(event) => setSearch(event.target.value)} placeholder="신청서 검색" />
      <select className={input} aria-label="선발 상태" value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">전체</option><option value="unselected">미선발</option><option value="selected">선발</option>
      </select>
      <span className="text-sm text-muted-foreground">{filtered.length}/{applications.length}건</span>
    </div>
    {filtered.map((record) => <JoinApplicant key={record.id} record={record} candidate={record.utmId ? candidates.get(record.utmId) : undefined} selected={selected.has(record.id)} save={save} labels={labels} />)}
    {!filtered.length && <Empty>{program.applicationSourceId ? "조건에 맞는 신청서가 없어요." : "설정에서 모집 폼을 연결하면 여기에 신청서가 표시돼요."}</Empty>}
  </section>;
}
