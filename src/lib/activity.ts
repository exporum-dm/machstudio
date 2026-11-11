import { prisma } from "@/lib/prisma";
import { mergeChangeLines } from "@/lib/webinar-change-summary";

export type ActivityAction =
  | "source.created"
  | "source.updated"
  | "source.deleted"
  | "source.key_regenerated"
  | "source.preview_token_regenerated"
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "records.bulk_deleted"
  | "records.imported"
  | "records.cleaned"
  | "records.normalized"
  | "records.exported"
  | "collect.records.exported"
  | "collect.checkin_updated"
  | "collect.checkin_imported"
  | "workspace.member.invited"
  | "workspace.member.role_changed"
  | "workspace.member.removed"
  | "apiToken.created"
  | "apiToken.revoked"
  | "dashboardShareToken.rotated"
  | "dashboard.share_password_set"
  | "dashboard.share_password_removed"
  | "analytics.share_enabled"
  | "analytics.share_disabled"
  | "analytics.share_token_rotated"
  | "analytics.share_password_set"
  | "analytics.share_password_removed"
  | "dashboard.realtime_share_enabled"
  | "dashboard.realtime_share_disabled"
  | "dashboard.realtime_share_token_rotated"
  | "dashboard.realtime_share_password_set"
  | "dashboard.realtime_share_password_removed"
  | "summary.share_enabled"
  | "summary.share_disabled"
  | "summary.share_token_rotated"
  | "webinar.registrations.exported"
  | "scheduledReport.delivered"
  | "scheduledReport.delivery_failed"
  | "utm.created"
  | "utm.updated"
  | "utm.deleted"
  | "ad.batch_uploaded"
  | "ad.batch_deleted"
  | "ad.source_synced"
  | "webinar.created"
  | "webinar.updated"
  | "webinar.deleted"
  | "webinar.session_created"
  | "webinar.session_updated"
  | "webinar.session_deleted"
  | "webinar.sessions_reordered"
  | "webinar.survey_response_deleted"
  | "webinar.announcement_created"
  | "webinar.announcement_updated"
  | "webinar.announcement_deleted"
  | "webinar.popup_created"
  | "webinar.popup_updated"
  | "webinar.popup_deleted"
  | "webinar.tally_push_created"
  | "webinar.tally_push_updated"
  | "webinar.tally_push_deleted"
  | "webinar.survey_created"
  | "webinar.survey_updated"
  | "webinar.survey_deleted"
  | "webinar.poll_created"
  | "webinar.poll_updated"
  | "webinar.poll_deleted"
  | "webinar.chat_host_posted"
  | "webinar.chat_deleted"
  | "webinar.qa_deleted"
  | "webinar.reminder_sent"
  | "webinar.registration_deleted"
  | "webinar.registrations_bulk_deleted"
  | "dashboard.created"
  | "dashboard.updated"
  | "dashboard.deleted"
  | "dashboard.widget_created"
  | "dashboard.widget_updated"
  | "dashboard.widget_deleted"
  | "dashboard.widgets_reordered"
  | "dashboard.report_scheduled"
  | "dashboard.report_deleted"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "project.member_added"
  | "project.member_removed"
  | "project.member_role_changed"
  | "source.fields_updated"
  | "source.retention_updated"
  | "source.script_regenerated"
  | "utmPreset.created"
  | "utmPreset.updated"
  | "utmPreset.deleted"
  | "utmTemplate.created"
  | "utmTemplate.updated"
  | "utmTemplate.deleted"
  | "shortLink.created"
  | "shortLink.updated"
  | "shortLink.deleted"
  | "workspace.created"
  | "workspace.renamed"
  | "workspace.consent_template_updated"
  | "workspace.legal_profile_updated"
  | "workspace.channel_colors_updated"
  | "workspace.deleted"
  | "invitation.redeemed"
  | "invitation.accepted"
  | "invitation.declined"
  | "competition.created"
  | "competition.updated"
  | "competition.deleted"
  | "competition.entry_updated"
  | "competition.entry_deleted"
  | "competition.preview_token_rotated"
  | "competition.judge_created"
  | "competition.judge_updated"
  | "competition.judge_deleted"
  | "competition.advanced"
  | "competition.final_order_updated"
  | "competition.award_saved"
  | "competition.award_deleted"
  | "competition.result_published"
  | "competition.entries_exported"
  | "detailPage.created"
  | "detailPage.deleted"
  | "media.uploaded"
  | "media.deleted"
  | "media.bulk_deleted"
  | "media.bulk_grouped"
  | "media.bulk_moved";

export async function logActivity(args: {
  workspaceId: string;
  sourceId?: string | null;
  userId?: string | null;
  action: ActivityAction;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        sourceId: args.sourceId ?? null,
        userId: args.userId ?? null,
        action: args.action,
        meta: (args.meta ?? null) as never,
      },
    });
  } catch (e) {
    // 로그 실패는 본 작업을 방해하지 않음
    console.error("[activity] failed to log", args.action, e);
  }
}

/** 같은 사람이 이 시간 안에 같은 웨비나를 또 고치면 새 줄을 만들지 않고 앞 줄에 합친다. */
export const WEBINAR_UPDATE_MERGE_WINDOW_MS = 10 * 60 * 1000;

/**
 * 웨비나 설정 변경을 기록한다. details 는 summarizeWebinarChanges 가 만든 "무엇이 바뀌었나" 문장들.
 *
 * 편집 화면은 자동 저장이라 몇 초마다 저장된다. 저장마다 한 줄씩 쌓으면 로그가 같은 줄로
 * 덮이고 정작 무엇을 했는지는 찾을 수 없어서, 바뀐 게 없으면 남기지 않고, 10분 안에 같은
 * 사람이 이어서 고친 것은 앞 줄에 합친다(시각은 마지막 저장 시각으로 올린다).
 */
export async function logWebinarUpdate(args: {
  workspaceId: string;
  userId: string;
  webinarId: string;
  webinarName: string;
  details: string[];
}) {
  if (args.details.length === 0) return;
  try {
    const since = new Date(Date.now() - WEBINAR_UPDATE_MERGE_WINDOW_MS);
    const recent = await prisma.activityLog.findFirst({
      where: {
        workspaceId: args.workspaceId,
        userId: args.userId,
        action: "webinar.updated",
        createdAt: { gte: since },
        meta: { path: ["webinarId"], equals: args.webinarId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, meta: true },
    });
    const previous = recent?.meta && typeof recent.meta === "object" && !Array.isArray(recent.meta)
      ? (recent.meta as Record<string, unknown>).details
      : null;
    if (recent && Array.isArray(previous)) {
      const merged = mergeChangeLines(previous.filter((d): d is string => typeof d === "string"), args.details);
      await prisma.activityLog.update({
        where: { id: recent.id },
        data: {
          createdAt: new Date(),
          meta: {
            webinarId: args.webinarId,
            webinarName: args.webinarName,
            details: merged.length ? merged : ["변경했다가 원래대로 되돌림"],
          },
        },
      });
      return;
    }
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        userId: args.userId,
        action: "webinar.updated",
        meta: { webinarId: args.webinarId, webinarName: args.webinarName, details: args.details },
      },
    });
  } catch (e) {
    console.error("[activity] failed to log webinar.updated", e);
  }
}
