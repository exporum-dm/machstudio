// 활동 로그(ActivityLog)를 사람이 읽는 문장으로 — 관리자 페이지와 웨비나 운영 로그가 같이 쓴다.
//
// 예전엔 화면에 "webinar.updated" 같은 코드만 떠서 무엇을, 어디에, 얼마나 했는지 알 수 없었다.
// 기록(meta)에 이미 대상 id·이름·건수가 들어 있으니 그것을 읽어 제목·대상·세부 내용으로 푼다.

export const ACTIVITY_LABELS: Record<string, string> = {
  "source.created": "등록 폼 생성",
  "source.updated": "등록 폼 설정 변경",
  "source.deleted": "등록 폼 삭제",
  "source.key_regenerated": "API 키 재발급",
  "source.preview_token_regenerated": "미리보기 링크 재발급",
  "source.fields_updated": "수집 필드 설정 변경",
  "source.retention_updated": "보관 정책 변경",
  "source.script_regenerated": "수집 스크립트 재생성",
  "record.created": "레코드 생성",
  "record.updated": "레코드 수정",
  "record.deleted": "레코드 삭제",
  "records.bulk_deleted": "레코드 대량 삭제",
  "records.imported": "레코드 가져오기",
  "records.cleaned": "데이터 정리",
  "records.normalized": "데이터 정규화",
  "records.exported": "레코드 내보내기",
  "collect.records.exported": "등록 데이터 내보내기",
  "collect.checkin_updated": "현장 체크인 설정",
  "collect.checkin_imported": "스캐너 파일 가져오기",
  "workspace.member.invited": "팀원 초대",
  "workspace.member.role_changed": "팀원 권한 변경",
  "workspace.member.removed": "팀원 제거",
  "workspace.created": "워크스페이스 생성",
  "workspace.renamed": "워크스페이스 이름 변경",
  "workspace.consent_template_updated": "약관 템플릿 변경",
  "workspace.legal_profile_updated": "법정 정보 변경",
  "workspace.channel_colors_updated": "채널 색상 변경",
  "workspace.deleted": "워크스페이스 삭제",
  "invitation.redeemed": "초대 등록",
  "invitation.accepted": "초대 수락",
  "invitation.declined": "초대 거절",
  "apiToken.created": "API 토큰 발급",
  "apiToken.revoked": "API 토큰 회수",
  "project.created": "프로젝트 생성",
  "project.updated": "프로젝트 수정",
  "project.deleted": "프로젝트 삭제",
  "project.member_added": "프로젝트 멤버 추가",
  "project.member_removed": "프로젝트 멤버 제거",
  "project.member_role_changed": "프로젝트 멤버 권한 변경",
  "dashboardShareToken.rotated": "대시보드 공유 토큰 회전",
  "dashboard.share_password_set": "대시보드 공유 비밀번호 설정",
  "dashboard.share_password_removed": "대시보드 공유 비밀번호 해제",
  "dashboard.realtime_share_enabled": "대시보드 공유 활성화",
  "dashboard.realtime_share_disabled": "대시보드 공유 비활성화",
  "dashboard.realtime_share_token_rotated": "대시보드 공유 토큰 회전",
  "dashboard.realtime_share_password_set": "대시보드 공유 비밀번호 설정",
  "dashboard.realtime_share_password_removed": "대시보드 공유 비밀번호 해제",
  "dashboard.created": "대시보드 생성",
  "dashboard.updated": "대시보드 수정",
  "dashboard.deleted": "대시보드 삭제",
  "dashboard.widget_created": "위젯 추가",
  "dashboard.widget_updated": "위젯 수정",
  "dashboard.widget_deleted": "위젯 삭제",
  "dashboard.widgets_reordered": "위젯 순서 변경",
  "dashboard.report_scheduled": "리포트 예약",
  "dashboard.report_deleted": "리포트 예약 해제",
  "analytics.share_enabled": "광고 성과 공유 활성화",
  "analytics.share_disabled": "광고 성과 공유 비활성화",
  "analytics.share_token_rotated": "광고 성과 공유 토큰 회전",
  "analytics.share_password_set": "광고 성과 공유 비밀번호 설정",
  "analytics.share_password_removed": "광고 성과 공유 비밀번호 해제",
  "summary.share_enabled": "요약 대시보드 공유 활성화",
  "summary.share_disabled": "요약 대시보드 공유 비활성화",
  "summary.share_token_rotated": "요약 대시보드 공유 토큰 회전",
  "scheduledReport.delivered": "리포트 발송 성공",
  "scheduledReport.delivery_failed": "리포트 발송 실패",
  "utm.created": "UTM 링크 생성",
  "utm.updated": "UTM 링크 수정",
  "utm.deleted": "UTM 링크 삭제",
  "utmPreset.created": "UTM 프리셋 생성",
  "utmPreset.updated": "UTM 프리셋 수정",
  "utmPreset.deleted": "UTM 프리셋 삭제",
  "utmTemplate.created": "UTM 템플릿 생성",
  "utmTemplate.updated": "UTM 템플릿 수정",
  "utmTemplate.deleted": "UTM 템플릿 삭제",
  "shortLink.created": "단축 URL 생성",
  "shortLink.updated": "단축 URL 수정",
  "shortLink.deleted": "단축 URL 삭제",
  "ad.batch_uploaded": "광고 데이터 업로드",
  "ad.batch_deleted": "광고 데이터 삭제",
  "ad.source_synced": "광고 시트 동기화",
  "webinar.created": "웨비나 생성",
  "webinar.updated": "웨비나 설정 변경",
  "webinar.deleted": "웨비나 삭제",
  "webinar.session_created": "세션 추가",
  "webinar.session_updated": "세션 수정",
  "webinar.session_deleted": "세션 삭제",
  "webinar.sessions_reordered": "세션 순서 변경",
  "webinar.announcement_created": "공지 등록",
  "webinar.announcement_updated": "공지 수정",
  "webinar.announcement_deleted": "공지 삭제",
  "webinar.popup_created": "팝업 등록",
  "webinar.popup_updated": "팝업 수정",
  "webinar.popup_deleted": "팝업 삭제",
  "webinar.tally_push_created": "Tally 푸시 등록",
  "webinar.tally_push_updated": "Tally 푸시 수정",
  "webinar.tally_push_deleted": "Tally 푸시 삭제",
  "webinar.survey_created": "설문 생성",
  "webinar.survey_updated": "설문 수정",
  "webinar.survey_deleted": "설문 삭제",
  "webinar.survey_response_deleted": "설문 응답 삭제",
  "webinar.poll_created": "투표 등록",
  "webinar.poll_updated": "투표 수정",
  "webinar.poll_activated": "투표 시작",
  "webinar.poll_deleted": "투표 삭제",
  "webinar.chat_host_posted": "진행자 채팅",
  "webinar.chat_deleted": "채팅 삭제",
  "webinar.qa_deleted": "질문 삭제",
  "webinar.reminder_sent": "리마인더 발송",
  "webinar.registration_deleted": "등록자 삭제",
  "webinar.registrations_bulk_deleted": "등록자 일괄 삭제",
  "webinar.registrations.exported": "등록자 내보내기",
  "competition.created": "대회 생성",
  "competition.updated": "대회 수정",
  "competition.deleted": "대회 삭제",
  "competition.entry_updated": "참가작 수정",
  "competition.entry_deleted": "참가작 삭제",
  "competition.preview_token_rotated": "대회 미리보기 링크 재발급",
  "competition.judge_created": "심사위원 추가",
  "competition.judge_updated": "심사위원 수정",
  "competition.judge_deleted": "심사위원 삭제",
  "competition.advanced": "다음 라운드 진출 확정",
  "competition.final_order_updated": "본선 순서 변경",
  "competition.award_saved": "시상 저장",
  "competition.award_deleted": "시상 삭제",
  "competition.result_published": "결과 공개 설정",
  "competition.entries_exported": "참가작 내보내기",
  "detailPage.created": "상세페이지 생성",
  "detailPage.deleted": "상세페이지 삭제",
  "media.uploaded": "미디어 업로드",
  "media.deleted": "미디어 삭제",
  "media.bulk_deleted": "미디어 일괄 삭제",
  "media.bulk_grouped": "미디어 묶음 지정",
  "media.bulk_moved": "미디어 프로젝트 이동",
  "admin.workspace_renamed": "관리자 — 워크스페이스 이름 변경",
  "admin.workspace_archived": "관리자 — 워크스페이스 보관",
  "admin.workspace_restored": "관리자 — 워크스페이스 복구",
  "admin.project_updated": "관리자 — 프로젝트 변경",
  "admin.project_archived": "관리자 — 프로젝트 보관",
  "admin.project_restored": "관리자 — 프로젝트 복구",
  "admin.source_activated": "관리자 — 소스 활성화",
  "admin.source_paused": "관리자 — 소스 일시중지",
  "admin.user_deleted": "관리자 — 사용자 삭제",
  "admin.workspace_permanently_deleted": "관리자 — 워크스페이스 영구 삭제",
  "admin.super_admin_granted": "관리자 — 슈퍼어드민 권한 부여",
  "admin.super_admin_revoked": "관리자 — 슈퍼어드민 권한 회수",
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? "기타 변경";
}

/** 관리자 활동 로그의 거르기 칩. prefixes 로 action 앞부분을 묶는다. */
export const ACTIVITY_CATEGORIES = [
  { id: "webinar", label: "웨비나", prefixes: ["webinar."] },
  { id: "collect", label: "등록·데이터", prefixes: ["source.", "record.", "records.", "collect."] },
  { id: "dashboard", label: "대시보드·공유", prefixes: ["dashboard", "analytics.", "summary.", "scheduledReport."] },
  { id: "marketing", label: "마케팅", prefixes: ["utm", "shortLink.", "ad."] },
  { id: "competition", label: "대회", prefixes: ["competition."] },
  { id: "content", label: "페이지·미디어", prefixes: ["detailPage.", "media."] },
  { id: "workspace", label: "팀·권한", prefixes: ["workspace.", "project.", "invitation.", "apiToken."] },
  { id: "admin", label: "관리자", prefixes: ["admin."] },
] as const;

export type ActivityCategoryId = (typeof ACTIVITY_CATEGORIES)[number]["id"];

export function activityCategory(action: string): ActivityCategoryId | null {
  return ACTIVITY_CATEGORIES.find((c) => c.prefixes.some((p) => action.startsWith(p)))?.id ?? null;
}

/** meta 에 id 만 남은 대상의 이름표 — 화면이 한 번에 모아 조회해 넘긴다. */
export interface ActivityNames {
  webinars?: Map<string, string>;
  competitions?: Map<string, string>;
  dashboards?: Map<string, string>;
  projects?: Map<string, string>;
}

type Meta = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const count = (v: unknown, unit = "건") => (num(v) !== null ? `${(v as number).toLocaleString()}${unit}` : null);
const asMeta = (meta: unknown): Meta => (meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Meta) : {});

/** meta 가 가리키는 대상의 이름(웨비나·대회·대시보드·소스·프로젝트). 없으면 null. */
export function activityTarget(metaRaw: unknown, names: ActivityNames = {}, sourceName?: string | null): string | null {
  const meta = asMeta(metaRaw);
  const pick = (idKey: string, map?: Map<string, string>, fallbackKey?: string) => {
    const id = str(meta[idKey]);
    if (!id) return null;
    return map?.get(id) ?? (fallbackKey ? str(meta[fallbackKey]) : null);
  };
  return (
    pick("webinarId", names.webinars, "webinarName") ??
    pick("competitionId", names.competitions) ??
    pick("dashboardId", names.dashboards, "dashboardName") ??
    str(sourceName) ??
    str(meta.sourceName) ??
    pick("projectId", names.projects, "projectName") ??
    str(meta.name) ??
    str(meta.tokenName) ??
    str(meta.originalName) ??
    null
  );
}

/** 예전 기록(meta.changes = 바뀐 키 목록)을 읽기 위한 이름표. 새 웨비나 기록은 meta.details 에 문장이 있다. */
const CHANGE_KEY_LABEL: Record<string, string> = {
  name: "이름",
  title: "제목",
  description: "설명",
  liveStartAt: "시작 시각",
  liveEndAt: "종료 시각",
  signupDeadline: "등록 마감",
  theme: "브랜드(색·폰트·둥글기)",
  config: "페이지·폼 설정",
  statusOverride: "방송 상태",
  components: "화면 구성",
  chatModeration: "채팅 관리",
  status: "상태",
  isActive: "활성 여부",
  active: "활성 여부",
  content: "내용",
  body: "내용",
  type: "유형",
  options: "선택지",
  questions: "문항",
  speaker: "연사",
  startsAt: "시작 시각",
  endsAt: "종료 시각",
  layout: "배치",
  filters: "필터",
};

function changesLine(changes: unknown): string | null {
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const keys = changes.filter((k): k is string => typeof k === "string");
  const named = [...new Set(keys.map((k) => CHANGE_KEY_LABEL[k]).filter(Boolean))];
  const rest = keys.filter((k) => !CHANGE_KEY_LABEL[k]).length;
  if (!named.length && !rest) return null;
  return `바뀐 곳: ${[...named, ...(rest ? [`기타 ${rest}곳`] : [])].join(", ")}`;
}

/** 제목 아래에 붙는 세부 내용. 많아도 화면에서 앞의 몇 줄만 보여준다. */
export function activityDetails(action: string, metaRaw: unknown): string[] {
  const meta = asMeta(metaRaw);
  if (Array.isArray(meta.details)) return meta.details.filter((d): d is string => typeof d === "string");
  const out: Array<string | null> = [];
  const join = (...parts: Array<string | null>) => parts.filter(Boolean).join(" · ") || null;
  switch (action) {
    case "records.imported":
    case "collect.checkin_imported":
      out.push(join(
        count(meta.imported ?? meta.inserted, "건 추가"),
        count(meta.updated, "건 갱신"),
        count(meta.skipped ?? meta.duplicate, "건 건너뜀"),
      ));
      break;
    case "records.bulk_deleted":
    case "webinar.registrations_bulk_deleted":
      out.push(count(meta.deleted ?? meta.count, "건 삭제"));
      if (meta.reason === "gdpr") out.push("개인정보 삭제 요청 처리");
      break;
    case "records.cleaned":
      out.push(count(meta.deleted, "건 정리"));
      break;
    case "records.normalized":
      out.push(count(meta.changedRows, "행 변경"));
      break;
    case "collect.records.exported":
    case "webinar.registrations.exported":
    case "records.exported":
      out.push(count(meta.recordCount, "건"));
      break;
    case "competition.entries_exported":
      out.push(count(meta.entryCount, "건"));
      break;
    case "webinar.reminder_sent":
      out.push(join(count(meta.sent, "건 발송"), num(meta.failed) ? count(meta.failed, "건 실패") : null));
      break;
    case "webinar.session_created":
    case "webinar.session_deleted":
      out.push(str(meta.title) ? `세션: ${meta.title}` : null);
      break;
    case "workspace.member.invited":
      out.push(str(meta.email) ? `${meta.email}${str(meta.role) ? ` (${meta.role})` : ""}` : null);
      break;
    case "workspace.member.role_changed":
      out.push(str(meta.oldRole) && str(meta.newRole) ? `권한: ${meta.oldRole} → ${meta.newRole}` : null);
      break;
    case "workspace.renamed":
      out.push(str(meta.before) && str(meta.after) ? `이름: ${meta.before} → ${meta.after}` : null);
      break;
    case "project.updated": {
      const before = str(asMeta(meta.before).name);
      const after = str(asMeta(meta.after).name);
      out.push(before && after && before !== after ? `이름: ${before} → ${after}` : null);
      break;
    }
    case "source.fields_updated":
      out.push(count(meta.fieldCount, "개 항목"));
      break;
    case "source.retention_updated":
      out.push(num(meta.retainDays) === 0 ? "보관 기한 없음" : count(meta.retainDays, "일 보관"));
      break;
    case "dashboard.widget_created":
      out.push(str(meta.title) ? `위젯: ${meta.title}` : null);
      break;
    case "competition.entry_updated":
    case "competition.entry_deleted":
      out.push(meta.entryNo != null ? `참가 번호 ${String(meta.entryNo)}` : null);
      break;
    case "competition.advanced":
      out.push(count(meta.advanceCount, "팀 진출"));
      break;
    case "media.bulk_deleted":
    case "media.bulk_moved":
    case "media.bulk_grouped":
      out.push(count(meta.count, "개"));
      break;
  }
  out.push(changesLine(meta.changes));
  return out.filter((v): v is string => Boolean(v));
}
