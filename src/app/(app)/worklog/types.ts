import type { WorkStatus } from "@/lib/worklog";

export interface WorkGroupDto {
  id: string;
  name: string;
  projectId: string | null;
  startDate: string | null;
  endDate: string | null;
  archived: boolean;
  sortOrder: number;
}

export interface WorkEntryDto {
  id: string;
  groupId: string | null;
  authorId: string;
  authorName: string;
  date: string;
  category: string;
  content: string;
  status: WorkStatus;
  result: string;
  note: string;
  updatedAt: string;
}
