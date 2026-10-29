import type { ClientBriefItem } from "@/lib/brief/queries";

export type BriefItem = ClientBriefItem;

export interface BriefRow {
  id: string;
  name: string;
  slug: string;
  intro: string;
  isPublic: boolean;
  appendPublicLink: boolean;
  publicUrl: string;
}

export interface BriefIssueRow {
  id: string;
  title: string;
  publishedAt: string;
  itemCount: number;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || "요청이 실패했어요"), { status: res.status, data });
  return data as T;
}
