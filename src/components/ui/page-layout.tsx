"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Search, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Field, FINISH, R, SELECTED } from "./primitives";
import { useWorkspace } from "@/contexts/workspace";

export function PageHeader({ title, description, context, actions, back }: {
  title: ReactNode;
  description?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return <header className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0 flex-1">
      {back && <Link href={back.href} className="mb-2 inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />{back.label}</Link>}
      {context && <p className="mb-1 text-xs text-muted-foreground">{context}</p>}
      <h1 className="text-2xl font-semibold tracking-tight text-pretty">{title}</h1>
      {description && <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

export function PageTabs<T extends string>({ label, value, onChange, options, className = "", sticky = true }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { id: T; label: string; icon?: LucideIcon; badge?: ReactNode }[];
  className?: string;
  sticky?: boolean;
}) {
  return <nav aria-label={label} className={`${sticky ? "sticky top-0 z-20" : ""} -mx-1 flex gap-1 overflow-x-auto bg-background/95 px-1 py-2 backdrop-blur ${className}`}>
    {options.map(({ id, label: text, icon: Icon, badge }) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={`flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${R.control} ${value === id ? SELECTED : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
      {Icon && <Icon className="h-4 w-4" aria-hidden />}<span>{text}</span>{badge != null && <> <span className="rounded-full bg-secondary px-1.5 text-[11px] tabular-nums text-foreground">{badge}</span></>}
    </button>)}
  </nav>;
}

function AreaLinks({ label, links }: { label: string; links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return <nav aria-label={label} className="flex flex-wrap gap-1 print:hidden">
    {links.map((link) => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} className={`${R.control} px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname === link.href ? SELECTED : `${FINISH.s2} text-muted-foreground hover:bg-secondary hover:text-foreground`}`}>{link.label}</Link>)}
  </nav>;
}

export function ListSearch({ value, onChange, label, count }: { value: string; onChange: (value: string) => void; label: string; count: number }) {
  return <div className="flex flex-wrap items-center gap-3">
    <label className="relative min-w-48 flex-1"><span className="sr-only">{label}</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /><Field type="search" value={value} onChange={e => onChange(e.target.value)} placeholder="이름으로 검색" className="pl-9" /></label>
    <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{count.toLocaleString()}개</span>
  </div>;
}

export function WebsiteNavigation() {
  const { expoHomepageEnabled } = useWorkspace();
  return <AreaLinks label="웹사이트 유형" links={[{ href: "/detail-page", label: "상세페이지" }, ...(expoHomepageEnabled ? [{ href: "/homepage", label: "홈페이지" }] : [])]} />;
}
