import type { WorkStatus } from "@/lib/worklog";

export interface WorkGroupDto {
  id: string;
  name: string;
  projectId: string | null;
  startDate: string | null;
  endDate: string | null;
  archived: boolean;
  sortOrder: number;
  /** 일지 머리표 줄임말("코엑", "교박") */
  aliases: string[];
}

export interface WorkEntryDto {
  id: string;
  groupId: string | null;
  authorId: string;
  authorName: string;
  /** null = 먼 미래 */
  date: string | null;
  /** 시트의 "공통" 열 */
  common: boolean;
  sortOrder: number;
  category: string;
  content: string;
  status: WorkStatus;
  result: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkMemberDto {
  id: string;
  name: string;
}
