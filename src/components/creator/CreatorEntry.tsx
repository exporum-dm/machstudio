import { Field, Text, button, primary } from "./ui";

export function CreatorEntry({ programId, programName, entered, error }: {
  programId: string; programName: string; entered?: boolean; error?: string;
}) {
  return <form method="post" action={"/api/public/creator-entry/" + programId}
    className={entered ? "mx-auto mb-3 flex max-w-3xl justify-end" : "mx-auto grid max-w-md gap-5 rounded-2xl bg-[var(--card)] p-6 shadow-[var(--card-shadow)] sm:p-8"}>
    <input name="action" type="hidden" value={entered ? "exit" : "enter"} />
    {!entered && <>
      <div><p className="text-sm font-medium text-[var(--muted)]">{programName}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">크리에이터 활동</h1>
        <p className="mt-3 text-sm leading-relaxed">신청서에 남긴 Gmail 주소를 입력하면 내 미션과 제출 내역을 볼 수 있어요.</p></div>
      <Field label="등록한 이메일"><Text name="email" type="email" autoComplete="email" maxLength={254} required placeholder="name@gmail.com" /></Field>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="submit" className={entered ? button : primary + " bg-[var(--key)] text-[var(--on-key)]"}>{entered ? "다른 이메일로 보기" : "내 활동 보기"}</button>
  </form>;
}
