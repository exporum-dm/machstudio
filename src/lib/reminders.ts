import "server-only";
/**
 * 정기 알림 실행 — 매일 cron(/api/cron/daily, KST 09:00)이 부른다(2026-11-03).
 *
 * 규칙마다:
 *  1) contentTemplate 이 있으면 이번 달부터 contentMonthsAhead 개월치 콘텐츠를 기준일에 넣어 둔다.
 *     이미 그 달에 같은 제목의 항목이 그 프로젝트에 있으면(노션에서 가져온 것 등) 새로 만들지 않는다.
 *  2) 오늘이 알릴 날~기준일 사이이고 그 달을 아직 안 알렸으면 받는 사람에게 앱 알림 + 메일.
 *     lastNotifiedMonth 를 먼저 올리고 보낸다 — cron 이 겹쳐 돌아도 두 번 보내지 않게.
 */
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getPublicAppOrigin } from "@/lib/app-url";
import { isHolidayYearCovered } from "@/lib/business-days";
import { kstToday } from "@/lib/worklog";
import {
  dueMonth, isReminderScheduleKind, reminderDayLabel, targetDay, upcomingMonths, type ReminderSchedule,
} from "@/lib/reminder-schedule";

interface ContentTemplate {
  title: string;
  projectId: string | null;
  formats: string[];
  channels: string[];
  campaign: string;
  assigneeIds: string[];
}

function readTemplate(v: unknown): ContentTemplate | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const title = typeof t.title === "string" ? t.title.trim() : "";
  if (!title) return null;
  return {
    title,
    projectId: typeof t.projectId === "string" && t.projectId ? t.projectId : null,
    formats: strs(t.formats), channels: strs(t.channels),
    campaign: typeof t.campaign === "string" ? t.campaign : "",
    assigneeIds: strs(t.assigneeIds),
  };
}

const displayName = (u: { name: string | null; email: string }) => u.name || u.email.split("@")[0];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface ReminderRunResult {
  id: string;
  title: string;
  createdContent: string[];
  notified?: { month: string; users: number; emails: number; emailSkipped: boolean };
  error?: string;
}

export async function runReminders(now = new Date()): Promise<{ today: string; warnings: string[]; reminders: ReminderRunResult[] }> {
  const today = kstToday(now);
  const warnings: string[] = [];
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) if (!isHolidayYearCovered(y)) warnings.push(`${y}년 공휴일 목록이 없어요 — 주말만 빼고 계산해요(lib/business-days.ts)`);

  const rules = await prisma.reminder.findMany({ where: { active: true, workspace: { deletedAt: null } } });
  const results: ReminderRunResult[] = [];
  for (const rule of rules) {
    const out: ReminderRunResult = { id: rule.id, title: rule.title, createdContent: [] };
    results.push(out);
    try {
      if (!isReminderScheduleKind(rule.schedule)) throw new Error(`알 수 없는 일정 ${rule.schedule}`);
      const schedule: ReminderSchedule = { schedule: rule.schedule, nth: rule.nth, leadBusinessDays: rule.leadBusinessDays };
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId: rule.workspaceId },
        select: { userId: true, user: { select: { name: true, email: true } } },
      });
      const memberById = new Map(members.map((m) => [m.userId, m.user]));

      // 1) 콘텐츠 미리 넣기
      const template = readTemplate(rule.contentTemplate);
      if (template) {
        const assignees = template.assigneeIds.filter((id) => memberById.has(id)).map((id) => ({ id, name: displayName(memberById.get(id)!) }));
        for (const month of upcomingMonths(today, rule.contentMonthsAhead)) {
          const day = targetDay(schedule, month);
          if (day < today) continue;
          const key = `${rule.id}:${month}`;
          const monthStart = new Date(`${month}-01T00:00:00Z`);
          const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
          const existing = await prisma.contentItem.findFirst({
            where: {
              OR: [
                { recurrenceKey: key },
                { workspaceId: rule.workspaceId, projectId: template.projectId, title: { startsWith: template.title }, date: { gte: monthStart, lte: monthEnd } },
              ],
            },
            select: { id: true },
          });
          if (existing) continue;
          await prisma.contentItem.create({
            data: {
              workspaceId: rule.workspaceId, projectId: template.projectId, title: template.title,
              date: new Date(`${day}T00:00:00Z`), status: "waiting",
              formats: template.formats, channels: template.channels, campaign: template.campaign, assignees,
              recurrenceKey: key, createdById: rule.createdById,
            },
          });
          out.createdContent.push(day);
        }
      }

      // 2) 알림
      const month = dueMonth(schedule, today, rule.lastNotifiedMonth);
      if (month) {
        // 먼저 표시 — 겹쳐 돈 다른 cron 이 같은 달을 또 보내지 않게(조건부 갱신)
        const claimed = await prisma.reminder.updateMany({
          where: { id: rule.id, OR: [{ lastNotifiedMonth: null }, { lastNotifiedMonth: { lt: month } }] },
          data: { lastNotifiedMonth: month },
        });
        if (claimed.count === 1) {
          const day = targetDay(schedule, month);
          const recipients = rule.recipientIds.filter((id) => memberById.has(id));
          const origin = getPublicAppOrigin();
          const href = template
            ? `/content-calendar?month=${month}${template.projectId ? `&project=${template.projectId}` : ""}`
            : null;
          const line = rule.message || rule.title;
          const when = rule.leadBusinessDays > 0
            ? `${reminderDayLabel(day)}까지 · 업무일 ${rule.leadBusinessDays}일 남았어요`
            : `${reminderDayLabel(day)} · ${schedule.schedule === "nth_business_day" ? `이번 달 ${schedule.nth}번째 업무일` : "이번 달 마지막 업무일"}`;
          await prisma.notification.createMany({
            data: recipients.map((userId) => ({
              userId,
              type: "REMINDER",
              data: { reminderId: rule.id, workspaceId: rule.workspaceId, title: rule.title, message: line, when, targetDate: day, month, href },
            })),
          });
          let emails = 0;
          let emailSkipped = false;
          for (const id of recipients) {
            const user = memberById.get(id)!;
            const link = href && origin ? `${origin}${href}` : origin || "";
            const r = await sendEmail({
              to: user.email,
              subject: `[알림] ${rule.title} — ${reminderDayLabel(day)}`,
              html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6">
<p><strong>${esc(rule.title)}</strong></p>
<p>${esc(line)}</p>
<p style="color:#666">${esc(when)}</p>
${link ? `<p><a href="${esc(link)}">machstudio 에서 보기</a></p>` : ""}
</div>`,
              idempotencyKey: `reminder:${rule.id}:${month}:${id}`,
            });
            if (r.sent) emails++;
            if (r.skipped) emailSkipped = true;
          }
          out.notified = { month, users: recipients.length, emails, emailSkipped };
        }
      }
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
  }
  return { today, warnings, reminders: results };
}
