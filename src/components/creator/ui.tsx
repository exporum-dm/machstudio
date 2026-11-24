import type { ComponentProps, ReactNode } from "react";
import { formatKst } from "@/lib/datetime";

export const panel = "min-w-0 rounded-2xl bg-card p-4 shadow-sm sm:p-6";
export const input = "min-w-0 rounded-lg bg-muted/45 px-3 py-2 text-sm shadow-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/65";
export const button = "inline-flex min-h-9 items-center justify-center rounded-lg bg-background px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";
export const primary = button + " bg-primary text-primary-foreground hover:bg-primary/90";
export const dateTime = (date: string | Date) => formatKst(date, {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});
export const statusNames: Record<string, string> = { todo: "미제출", review: "검수 대기", revision: "수정 요청", done: "완료" };
export const feeNames: Record<string, string> = { unpaid: "미지급", scheduled: "지급 예정", paid: "지급 완료" };

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">{label}{children}</label>;
}

export function Text({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={input + " " + className} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-muted/30 px-4 py-5 text-sm text-muted-foreground">{children}</p>;
}
