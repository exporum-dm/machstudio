"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export default function SurveyIdentifyForm({
  label, placeholder, value, onChange, onSubmit, error, busy, submitLabel, inputType, intro, children,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
  busy: boolean;
  submitLabel: string;
  inputType?: "email" | "tel";
  intro?: ReactNode;
  children?: ReactNode;
}) {
  const errorId = useId();
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 px-5 py-6">
      {intro}
      <div>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-[var(--survey-identify-text,#171717)]">{label}</span>
          <input value={value} onChange={(event) => onChange(event.target.value)} type={inputType ?? "text"}
            autoComplete={inputType ?? "email"} inputMode={inputType === "tel" ? "numeric" : "email"} placeholder={placeholder} autoCapitalize="none" spellCheck={false}
            required={Boolean(inputType)} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            className="h-12 w-full rounded-xl bg-[var(--survey-identify-surface,white)] px-4 text-base text-[var(--survey-identify-text,#171717)] shadow-sm ring-1 ring-[var(--survey-identify-border,#d4d4d4)] outline-none focus:ring-2 focus:ring-[var(--acc)]" />
        </label>
        {error && <p id={errorId} role="alert" className="mt-2 text-sm text-[var(--survey-identify-error,#dc2626)]">{error}</p>}
      </div>
      <button type="submit" disabled={busy || !value.trim()} aria-busy={busy}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-[var(--acc)] text-base font-semibold text-[var(--survey-identify-on-accent,white)] motion-safe:transition active:scale-[0.99] disabled:opacity-50">
        {busy ? <Loader2 aria-label={submitLabel} className="h-5 w-5 motion-safe:animate-spin" /> : submitLabel}
      </button>
      {children}
    </form>
  );
}
