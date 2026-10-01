"use client";

/**
 * 폼 빌더의 항목 외 설정 — 행사 개요·안내 블록·검증·동의·완료·등록 확인(설계 §5·§6·§7·§8·§10).
 *
 * 전부 **편집 영역**이라 값이 항상 보이고 그 자리에서 고쳐진다(AGENTS.md §2).
 * 섹션은 블록 카드로 나누되 접지 않는다 — 접으면 "무엇이 켜져 있는지" 를 매번 열어 확인해야 한다.
 */
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { EditableList, ROW_KEY, withRowKeys } from "@/components/ui/editable-list";
import { ColorField, BRAND_PRESETS } from "@/components/ui/ColorField";
import { FIELD_CLS, FINISH, R, UrlField } from "@/components/ui/primitives";
import { kstDateTimeLocalInput, kstDateTimeLocalToIso } from "@/lib/datetime";
import { isSupportedCountry } from "@/lib/collect-phone";
import { COUNTRY_DIALS, flagEmoji } from "@/lib/collect-country";
import {
  DEFAULT_LOCALE,
  localize,
  toLocalized,
  type CollectFormConfig,
  type CollectBadgeRule,
  type CollectNotice,
  type NoticeMode,
  type NoticePlacement,
} from "@/lib/collect-form-config";
import { CollectLegalGenerator } from "@/components/form-builder/CollectLegalGenerator";
import { ConsentBodyField, useWorkspaceLegalProfile } from "@/components/legal/legal-generator-shared";
import { resolveOrgProfile } from "@/lib/legal-templates";
import { visitorBadgePalette } from "@/lib/collect-badge";

const CONSENT_KIND_META = {
  privacy: { label: "개인정보 (필수)", noun: "개인정보", placeholder: "개인정보 수집·이용에 동의합니다" },
  marketing: { label: "마케팅 (선택)", noun: "마케팅", placeholder: "마케팅 정보 수신에 동의합니다" },
  thirdParty: { label: "제3자 제공 (선택)", noun: "제3자 제공", placeholder: "개인정보 제3자 제공에 동의합니다" },
} as const;

type Patch = (next: Partial<CollectFormConfig>) => void;

const PLACEMENTS: Array<{ id: NoticePlacement; label: string }> = [
  { id: "top", label: "폼 위" },
  { id: "above-consent", label: "동의 위" },
  { id: "bottom", label: "폼 아래" },
  { id: "completion", label: "완료 화면" },
  { id: "email", label: "이메일" },
];

const NOTICE_MODES: Array<{ id: NoticeMode; label: string }> = [
  { id: "notice", label: "안내만" },
  { id: "checkbox-optional", label: "선택 동의" },
  { id: "checkbox-required", label: "필수 동의" },
];

function Block({ title, desc, children, right }: { title: string; desc?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className={`${R.surface} bg-background p-4 ${FINISH.s2} space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

export function CollectFormSections({
  config, patch, workspaceId,
}: { config: CollectFormConfig; patch: Patch; workspaceId?: string }) {
  const ev = config.eventInfo;
  const win = ev.registrationWindow;
  const countryBad = !isSupportedCountry(config.validation.defaultCountry);

  // 동의 전문 편집 칸이 {{ORG_ADDRESS}} 같은 조직 토큰을 실제 값으로 풀어 보여주는 데 쓴다.
  const { profile: orgProfile } = useWorkspaceLegalProfile(workspaceId);
  const org = useMemo(() => resolveOrgProfile(orgProfile, config.legal.country), [orgProfile, config.legal.country]);
  const legalLocale = config.legal.country === "kr" ? "ko" : "en";
  const confirmationEmail = config.confirmationEmail;
  const hasEmailField = config.fields.some((field) => field.enabled && field.type === "email");
  // 이름은 이메일인데 유형이 '텍스트'인 항목 — 메일 수신자로 못 잡고 중복 등록도 못 막는다(2026-10 원데이클래스 사례)
  const emailLikeTextField = hasEmailField
    ? null
    : config.fields.find(
        (field) => field.enabled && field.type !== "email"
          && [field.key, ...Object.values(field.label ?? {})].some((v) => /e-?mail|이메일/i.test(String(v))),
      ) ?? null;
  const replyToBad = confirmationEmail.replyTo !== ""
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(confirmationEmail.replyTo);
  const hasEmailEventInfo = ev.eventDates.length > 0
    || Boolean(localize(ev.venue, DEFAULT_LOCALE))
    || ev.openingHours.length > 0
    || ev.extraRows.some((row) => Boolean(localize(row.label, DEFAULT_LOCALE) && localize(row.value, DEFAULT_LOCALE)));
  const badgeFields = useMemo(() => {
    const seen = new Set<string>();
    return [...config.fields, ...config.branch.groups.flatMap((group) => group.fields)]
      .filter((field) => field.key && !seen.has(field.key) && seen.add(field.key));
  }, [config.branch.groups, config.fields]);

  const setEvent = (next: Partial<typeof ev>) => patch({ eventInfo: { ...ev, ...next } });
  const setWindow = (next: Partial<typeof win>) =>
    patch({ eventInfo: { ...ev, registrationWindow: { ...win, ...next } } });

  return (
    <div className="space-y-3">
      {/* ── 테마 ──────────────────────────────────────────────────── */}
      <Block title="테마" desc="파트너 사이트(아임웹 등)의 브랜드 색에 맞춰요. 비워 두면 기본 색을 써요.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ColorField
            label="키컬러"
            note="버튼·포커스·강조 텍스트"
            value={config.theme.accentColor}
            onChange={(next) => patch({ theme: { ...config.theme, accentColor: next } })}
            presets={BRAND_PRESETS}
            allowInherit
            inheritLabel="기본색(네이비)"
          />
          <ColorField
            label="글자색"
            value={config.theme.textColor}
            onChange={(next) => patch({ theme: { ...config.theme, textColor: next } })}
            allowInherit
            inheritLabel="기본색"
          />
          <ColorField
            label="배경색"
            value={config.theme.surfaceColor}
            onChange={(next) => patch({ theme: { ...config.theme, surfaceColor: next } })}
            allowInherit
            inheritLabel="기본(흰색)"
          />
        </div>
      </Block>

      {/* ── 배지 이름 규칙 ───────────────────────────────────────── */}
      <Block
        title="배지 이름 규칙"
        desc="응답값에 따라 Press 같은 기본 배지 이름을 바꿔요. 위에서 먼저 일치한 규칙 하나만 적용됩니다."
      >
        <EditableList<CollectBadgeRule & { [ROW_KEY]?: string }>
          listId="collect-badge-rules"
          itemNoun="규칙"
          items={withRowKeys(config.badgeRules)}
          onChange={(next) => patch({ badgeRules: next })}
          rowKey={(rule) => rule.id}
          reorderable
          addLabel="배지 규칙 추가"
          makeItem={() => ({
            id: crypto.randomUUID(),
            fieldKey: badgeFields[0]?.key ?? "",
            operator: "contains",
            value: "",
            label: "",
            backgroundColor: "",
          })}
          emptyState={(
            <p className="rounded-xl bg-secondary/40 p-4 text-center text-[11px] text-muted-foreground">
              규칙이 없으면 기존 참가자 유형(예: Press)이 그대로 표시돼요.
            </p>
          )}
          renderRow={({ item, handle, removeButton, patch: patchRow }) => (
            <div className={`${R.surface} flex items-start gap-1.5 bg-secondary p-2 ${FINISH.s2}`}>
              <div className="mt-1">{handle}</div>
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,.7fr)] sm:items-center">
                <select
                  value={item.fieldKey}
                  onChange={(event) => patchRow({ fieldKey: event.target.value })}
                  aria-label="기준 항목"
                  className="min-w-0 rounded-lg bg-background px-2 py-1.5 text-[11px] shadow-sm outline-none"
                >
                  <option value="">항목 선택</option>
                  {badgeFields.map((field) => (
                    <option key={field.key} value={field.key}>{localize(field.label, DEFAULT_LOCALE) || field.key}</option>
                  ))}
                </select>
                <select
                  value={item.operator}
                  onChange={(event) => patchRow({ operator: event.target.value as CollectBadgeRule["operator"] })}
                  aria-label="비교 방식"
                  className="rounded-lg bg-background px-2 py-1.5 text-[11px] shadow-sm outline-none"
                >
                  <option value="contains">포함</option>
                  <option value="equals">정확히 일치</option>
                </select>
                <input
                  value={item.value}
                  onChange={(event) => patchRow({ value: event.target.value })}
                  placeholder="Korea Expo LA 2026 Ambassador"
                  aria-label="비교할 값"
                  className="min-w-0 rounded-lg bg-background px-2 py-1.5 text-[11px] shadow-sm outline-none"
                />
                <span className="hidden text-[11px] text-muted-foreground sm:inline">이면</span>
                <input
                  value={item.label}
                  onChange={(event) => patchRow({ label: event.target.value })}
                  placeholder="표시 이름: Ambassador"
                  aria-label="표시할 배지 이름"
                  className="min-w-0 rounded-lg bg-background px-2 py-1.5 text-[11px] shadow-sm outline-none"
                />
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:col-span-5">
                  <input
                    type="color"
                    value={item.backgroundColor || visitorBadgePalette(item.label || "Badge").background}
                    onChange={(event) => patchRow({ backgroundColor: event.target.value.toUpperCase() })}
                    aria-label="배지 배경색"
                    className="h-7 w-9 cursor-pointer rounded-md bg-transparent p-0 shadow-sm"
                  />
                  <span>배지 색상</span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm"
                    style={{
                      backgroundColor: visitorBadgePalette(item.label || "Badge", [item]).background,
                      color: visitorBadgePalette(item.label || "Badge", [item]).foreground,
                    }}
                  >
                    {item.label || "Badge"}
                  </span>
                </label>
              </div>
              <div className="mt-1">{removeButton()}</div>
            </div>
          )}
        />
        {badgeFields.length === 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">먼저 등록 항목을 하나 이상 만들어야 규칙을 연결할 수 있어요.</p>
        )}
      </Block>

      {/* ── 행사 개요 ─────────────────────────────────────────────── */}
      <Block
        title="행사 개요"
        desc="표시용이 아니라 동작하는 값이에요 — 사전등록 기간이 폼을 자동으로 열고 닫습니다."
        right={<Switch checked={ev.enabled} onChange={(v) => setEvent({ enabled: v })} label="행사 개요 표시" />}
      >
        <Row label="개최일" hint="쉼표로 구분해 여러 날을 넣어요. 현장 체크인의 일자 판정에도 쓰입니다.">
          <input
            value={ev.eventDates.join(", ")}
            onChange={(e) => setEvent({ eventDates: e.target.value.split(",").map((d) => d.trim()).filter(Boolean) })}
            placeholder="2026-10-22, 2026-10-23"
            className={FIELD_CLS}
          />
        </Row>
        <Row label="장소">
          <input
            value={localize(ev.venue, DEFAULT_LOCALE)}
            onChange={(e) => setEvent({ venue: toLocalized(e.target.value) })}
            placeholder="Los Angeles Convention Center"
            className={FIELD_CLS}
          />
        </Row>

        <div>
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">운영시간</span>
          <p className="mb-1.5 text-[11px] leading-snug text-muted-foreground/70">
            폼 상단 개요 표에 날짜별로 한 줄씩 나가요. 아임웹 등 외부에 따로 안 만들어도 돼요.
          </p>
          <EditableList<CollectFormConfig["eventInfo"]["openingHours"][number] & { [ROW_KEY]?: string }>
            listId="event-hours"
            itemNoun="날짜"
            items={withRowKeys(ev.openingHours)}
            onChange={(next) => setEvent({ openingHours: next })}
            rowKey={(h) => h[ROW_KEY] ?? ""}
            addLabel="날짜 추가"
            makeItem={() => ({ date: "", open: "", close: "", lastEntrance: "" })}
            emptyState={<p className="rounded-xl bg-secondary/40 p-3 text-center text-[11px] text-muted-foreground">없음</p>}
            renderRow={({ item, removeButton, patch: patchRow }) => (
              <div className={`${R.surface} flex flex-wrap items-center gap-1.5 bg-secondary p-2 ${FINISH.s2}`}>
                <input
                  type="date"
                  value={item.date}
                  onChange={(e) => patchRow({ date: e.target.value })}
                  aria-label="날짜"
                  className="min-w-0 shrink-0 bg-transparent text-[12px] outline-none"
                />
                <input
                  type="time"
                  value={item.open}
                  onChange={(e) => patchRow({ open: e.target.value })}
                  aria-label="시작 시각"
                  className="min-w-0 shrink-0 bg-transparent text-[12px] outline-none"
                />
                <span className="text-[11px] text-muted-foreground">~</span>
                <input
                  type="time"
                  value={item.close}
                  onChange={(e) => patchRow({ close: e.target.value })}
                  aria-label="종료 시각"
                  className="min-w-0 shrink-0 bg-transparent text-[12px] outline-none"
                />
                <input
                  type="time"
                  value={item.lastEntrance}
                  onChange={(e) => patchRow({ lastEntrance: e.target.value })}
                  aria-label="마지막 입장 시각 (선택)"
                  title="마지막 입장 시각 (선택)"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
                />
                {removeButton()}
              </div>
            )}
          />
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">개요 추가 행 (선택)</span>
          <p className="mb-1.5 text-[11px] leading-snug text-muted-foreground/70">
            &ldquo;기간·장소·운영시간&rdquo; 아래에 원하는 항목을 더 넣을 수 있어요 (예: 주최, 문의).
          </p>
          <EditableList<CollectFormConfig["eventInfo"]["extraRows"][number] & { [ROW_KEY]?: string }>
            listId="event-extra-rows"
            itemNoun="항목"
            items={withRowKeys(ev.extraRows)}
            onChange={(next) => setEvent({ extraRows: next })}
            rowKey={(r) => r[ROW_KEY] ?? ""}
            addLabel="행 추가"
            makeItem={() => ({ label: {}, value: {} })}
            emptyState={<p className="rounded-xl bg-secondary/40 p-3 text-center text-[11px] text-muted-foreground">없음</p>}
            renderRow={({ item, removeButton, patch: patchRow }) => (
              <div className={`${R.surface} flex items-center gap-1.5 bg-secondary p-2 ${FINISH.s2}`}>
                <input
                  value={localize(item.label, DEFAULT_LOCALE)}
                  onChange={(e) => patchRow({ label: toLocalized(e.target.value) })}
                  placeholder="항목명 (예: 주최)"
                  aria-label="항목명"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
                />
                <input
                  value={localize(item.value, DEFAULT_LOCALE)}
                  onChange={(e) => patchRow({ value: toLocalized(e.target.value) })}
                  placeholder="내용"
                  aria-label="내용"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
                />
                {removeButton()}
              </div>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* 입력은 KST 벽시각, 저장은 오프셋이 붙은 ISO — 서버(UTC)와 브라우저가 같은 순간을
              가리켜야 접수 창 판정이 한쪽에서만 열리는 일이 없다. 웨비나 일정과 같은 헬퍼를 쓴다. */}
          <Row label="접수 시작 (KST)">
            <input
              type="datetime-local"
              value={win.opensAt ? kstDateTimeLocalInput(win.opensAt) : ""}
              onChange={(e) => setWindow({ opensAt: e.target.value ? kstDateTimeLocalToIso(e.target.value) : null })}
              className={FIELD_CLS}
            />
          </Row>
          <Row label="접수 마감 (KST)">
            <input
              type="datetime-local"
              value={win.closesAt ? kstDateTimeLocalInput(win.closesAt) : ""}
              onChange={(e) => setWindow({ closesAt: e.target.value ? kstDateTimeLocalToIso(e.target.value) : null })}
              className={FIELD_CLS}
            />
          </Row>
        </div>
        {win.opensAt && win.closesAt && Date.parse(win.opensAt) >= Date.parse(win.closesAt) && (
          <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            마감이 시작보다 빨라요 — 이대로면 폼이 영영 열리지 않습니다.
          </p>
        )}
        <Row label="상태 수동 전환" hint="시각 계산을 이깁니다. 마감을 앞당기거나 연장할 때만 쓰세요.">
          <select
            value={config.statusOverride ?? ""}
            onChange={(e) => patch({ statusOverride: (e.target.value || null) as CollectFormConfig["statusOverride"] })}
            className={FIELD_CLS}
          >
            <option value="">자동 (시각으로 판정)</option>
            <option value="before">접수 전으로 고정</option>
            <option value="open">접수 중으로 고정</option>
            <option value="closed">마감으로 고정</option>
          </select>
        </Row>
      </Block>

      {/* ── 안내 블록 ─────────────────────────────────────────────── */}
      <Block title="안내 블록" desc="초상권 안내 같은 문구. 형태만 바꾸면 안내 → 동의로 승격돼요.">
        <EditableList<CollectNotice & { [ROW_KEY]?: string }>
          listId="cnotice"
          itemNoun="안내"
          items={withRowKeys(config.notices)}
          onChange={(next) => patch({ notices: next })}
          rowKey={(n) => n.id}
          reorderable
          addLabel="안내 추가"
          makeItem={() => ({
            id: crypto.randomUUID().slice(0, 8), enabled: true, placement: "above-consent",
            title: {}, body: {}, bodyFormat: "text", mode: "notice", collapsible: false,
          })}
          emptyState={<p className="rounded-xl bg-secondary/40 p-4 text-center text-[11px] text-muted-foreground">안내가 없어요</p>}
          renderRow={({ item, handle, removeButton, patch: patchRow }) => (
            <div className={`${R.surface} bg-secondary p-2 ${FINISH.s2} ${item.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-1">
                {handle}
                <select
                  value={item.placement}
                  onChange={(e) => patchRow({ placement: e.target.value as NoticePlacement })}
                  aria-label="표시 위치"
                  className="rounded-lg bg-background px-1.5 py-1 text-[11px] shadow-sm outline-none"
                >
                  {PLACEMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <select
                  value={item.mode}
                  onChange={(e) => patchRow({ mode: e.target.value as NoticeMode })}
                  aria-label="형태"
                  className="rounded-lg bg-background px-1.5 py-1 text-[11px] shadow-sm outline-none"
                >
                  {NOTICE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <span className="flex-1" />
                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  표시<Switch checked={item.enabled} onChange={(v) => patchRow({ enabled: v })} label="안내 표시" />
                </label>
                {removeButton()}
              </div>
              {/* 완료 화면·이메일에 둔 안내는 폼에 체크박스가 없다 — 필수 동의로 두면
                  누를 수 없는 동의를 요구하게 되므로 그 자리에서 알린다. */}
              {item.mode === "checkbox-required" && !["top", "above-consent", "bottom"].includes(item.placement) && (
                <p className="mt-1 flex items-start gap-1.5 px-1 text-[11px] text-amber-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  이 위치에는 체크박스가 없어서 필수 동의로 동작하지 않아요.
                </p>
              )}
              <div className="mt-1 space-y-1 px-1">
                <input
                  value={localize(item.title, DEFAULT_LOCALE)}
                  onChange={(e) => patchRow({ title: toLocalized(e.target.value) })}
                  placeholder="제목 (선택)"
                  aria-label="안내 제목"
                  className="w-full bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
                />
                <textarea
                  value={localize(item.body, DEFAULT_LOCALE)}
                  onChange={(e) => patchRow({ body: toLocalized(e.target.value) })}
                  placeholder="본문 — 줄바꿈이 그대로 보여요"
                  aria-label="안내 본문"
                  rows={2}
                  className="w-full resize-y rounded-lg bg-background px-2 py-1.5 text-[12px] shadow-sm outline-none"
                />
              </div>
            </div>
          )}
        />
      </Block>

      {/* ── 검증 ─────────────────────────────────────────────────── */}
      <Block title="검증" desc="입력 시점에 강제해요 — 안내 문구가 아니라 규칙입니다.">
        <Row label="연락처 기본 국가" hint="국가번호 없이 입력한 번호를 이 나라 기준으로 읽어요.">
          {/* 예전엔 2글자 코드를 직접 타이핑하게 했었다 — "UK"(존재 안 함, 영국은 GB) 같은
              오타가 그대로 저장돼 그 폼의 전화가 전부 무효 처리됐다. 실제 방문자 화면의 국가
              선택(mount.ts)과 같은 목록에서 고르게 하면 애초에 없는 코드를 못 넣는다. */}
          <select
            value={countryBad ? "" : config.validation.defaultCountry}
            onChange={(e) => patch({ validation: { ...config.validation, defaultCountry: e.target.value } })}
            className={`${FIELD_CLS} ${countryBad ? "text-red-600 dark:text-red-400" : ""}`}
          >
            {countryBad && (
              <option value="" disabled>
                {config.validation.defaultCountry} — 없는 국가 코드
              </option>
            )}
            {COUNTRY_DIALS.map((c) => (
              <option key={c.code} value={c.code}>
                {flagEmoji(c.code)} {c.name} (+{c.dial})
              </option>
            ))}
          </select>
        </Row>
        {countryBad && (
          <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            없는 국가 코드예요. 이대로면 모든 전화번호가 무효 처리됩니다 (영국은 UK 가 아니라 GB).
          </p>
        )}
        {/**
          * 끌 수 있는 토글이 아니다.
          *
          * 차단은 DB 의 부분 유니크 인덱스가 하는데(동시 제출을 막으려면 그래야 한다),
          * 인덱스는 설정을 읽지 못한다. 토글을 끄면 화면만 "허용" 이 되고 제출은 그대로
          * 409 를 맞는다 — 게다가 그 상태에서는 런타임의 사전 안내까지 꺼져서 사용자가
          * **이유도 모른 채 막힌다.** 설계도 지금은 block 만 쓴다고 못 박았다(§6.2).
          * 유료 전시에서 재검토할 때 인덱스와 함께 열어야 한다.
          */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          같은 이메일의 재등록은 <b className="font-semibold text-foreground/80">항상 차단</b>됩니다.
          동시 제출까지 막으려면 DB 제약이 필요한데, 그건 설정으로 켜고 끌 수 있는 것이 아니에요.
        </p>
      </Block>

      {/* ── 동의 ─────────────────────────────────────────────────── */}
      <Block title="동의" desc="사전 체크는 기본 꺼짐이에요 — GDPR 관할에서는 유효한 동의로 인정되지 않습니다.">
        {(["privacy", "marketing", "thirdParty"] as const).map((kind) => {
          const item = config.consent[kind];
          const meta = CONSENT_KIND_META[kind];
          return (
            <div key={kind} className={`${R.surface} bg-secondary p-2 ${FINISH.s2} space-y-1`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold">{meta.label}</span>
                <span className="flex-1" />
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  사용<Switch checked={item.enabled} onChange={(v) => patch({ consent: { ...config.consent, [kind]: { ...item, enabled: v } } })} label={`${meta.noun} 동의 사용`} />
                </label>
              </div>
              <input
                value={localize(item.label, DEFAULT_LOCALE)}
                onChange={(e) => patch({ consent: { ...config.consent, [kind]: { ...item, label: toLocalized(e.target.value) } } })}
                placeholder={meta.placeholder}
                aria-label={`${kind} 문구`}
                className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
              />
              <div className="flex w-fit rounded-lg bg-background p-0.5 shadow-sm" role="tablist" aria-label={`${meta.noun} 전문 입력 방식`}>
                {(["text", "link"] as const).map((format) => {
                  const active = item.bodyFormat === format;
                  return (
                    <button
                      key={format}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => patch({ consent: { ...config.consent, [kind]: { ...item, bodyFormat: format } } })}
                      className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {format === "text" ? "텍스트" : "링크"}
                    </button>
                  );
                })}
              </div>
              {item.bodyFormat === "link" ? <input type="url" value={item.linkUrl} onChange={(e) => patch({ consent: { ...config.consent, [kind]: { ...item, linkUrl: e.target.value } } })} placeholder="https://..." aria-label={`${kind} 링크`} className={FIELD_CLS} /> : <ConsentBodyField
                value={localize(item.body, DEFAULT_LOCALE)}
                org={org}
                locale={legalLocale}
                onSave={(next) => patch({ consent: { ...config.consent, [kind]: { ...item, body: toLocalized(next) } } })}
                placeholder="'자세히' 팝업 전문 (선택) — 아래 '법률 문구 생성기'로 채울 수 있어요"
                ariaLabel={`${kind} 전문`}
              />}
              <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                {item.bodyFormat === "link"
                  ? "동의 문구 옆 ‘자세히’를 누르면 새 창에서 열려요."
                  : "입력한 글과 줄바꿈을 그대로 표시해요."}
              </p>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch
                  checked={item.defaultChecked}
                  onChange={(v) => patch({ consent: { ...config.consent, [kind]: { ...item, defaultChecked: v } } })}
                  label={`${meta.noun} 동의 사전 체크`}
                />
                미리 체크해 두기
              </label>
              {item.defaultChecked && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {kind === "privacy"
                    ? "필수 동의는 어차피 체크해야 제출돼요 — 사전 체크의 실익이 없습니다."
                    : "EU·국내에서는 사전 체크가 유효한 동의로 인정되지 않아요."}
                </p>
              )}
            </div>
          );
        })}
      </Block>

      {/* ── 법률 문구 생성기 ─────────────────────────────────────── */}
      <CollectLegalGenerator config={config} patch={patch} workspaceId={workspaceId} />

      {/* ── 완료 ─────────────────────────────────────────────────── */}
      <Block title="등록 완료 후" desc="비워 두면 이동하지 않고 그 자리에 완료 카드를 보여줘요.">
        <UrlField
          label="완료 페이지 주소"
          value={config.completion.redirectUrlTemplate}
          onChange={(v) => patch({ completion: { ...config.completion, redirectUrlTemplate: v } })}
          placeholder="https://example.com/registration-complete?{type}"
        />
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          쓸 수 있는 자리표시자: <code className="font-mono">{"{type}"}</code> <code className="font-mono">{"{regNo}"}</code> <code className="font-mono">{"{rid}"}</code> <code className="font-mono">{"{lang}"}</code>
          {" — "}등록번호는 브라우저 기록에 남으니 꼭 필요할 때만 넣으세요.
        </p>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Switch
            checked={config.completion.showQr}
            onChange={(v) => patch({ completion: { ...config.completion, showQr: v } })}
            label="완료 화면에 QR"
          />
          완료 화면에 QR·등록번호 보여주기
        </label>
      </Block>

      {/* ── 자동 확인 메일 ───────────────────────────────────────── */}
      <Block
        title="자동 확인 메일"
        desc="등록이 저장된 뒤 QR·등록번호가 담긴 메일을 보내요. API 키와 발신 주소는 Vercel에서 관리합니다."
        right={(
          <Switch
            checked={confirmationEmail.enabled}
            onChange={(enabled) => patch({ confirmationEmail: { ...confirmationEmail, enabled } })}
            label="자동 확인 메일 사용"
          />
        )}
      >
        {confirmationEmail.enabled ? (
          <>
            {!hasEmailField && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {emailLikeTextField
                  ? `‘${localize(emailLikeTextField.label, DEFAULT_LOCALE) || emailLikeTextField.key}’ 항목의 유형이 이메일이 아니라서 메일을 보낼 수 없어요. 그 항목의 유형을 ‘이메일’로 바꾸면 메일이 나가고 중복 등록도 막혀요.`
                  : "표시 중인 이메일 항목이 없어 메일을 보낼 수 없어요. 등록 항목에 이메일을 추가하세요."}
              </p>
            )}
            <Row label="메일 제목" hint="비워 두면 ‘등록이 완료되었습니다 — 행사명’으로 보내요.">
              <input
                value={localize(confirmationEmail.subject, DEFAULT_LOCALE)}
                onChange={(e) => patch({ confirmationEmail: { ...confirmationEmail, subject: toLocalized(e.target.value) } })}
                placeholder="Registration confirmed — Korea Expo LA"
                className={FIELD_CLS}
              />
            </Row>
            <Row label="첫 문장" hint="비워 두면 ‘You're registered’가 표시돼요.">
              <input
                value={localize(confirmationEmail.heading, DEFAULT_LOCALE)}
                onChange={(e) => patch({ confirmationEmail: { ...confirmationEmail, heading: toLocalized(e.target.value) } })}
                placeholder="You're registered"
                className={FIELD_CLS}
              />
            </Row>
            <Row label="안내 문구" hint="줄바꿈도 이메일에 그대로 보여요.">
              <textarea
                value={localize(confirmationEmail.body, DEFAULT_LOCALE)}
                onChange={(e) => patch({ confirmationEmail: { ...confirmationEmail, body: toLocalized(e.target.value) } })}
                placeholder="Your pre-registration is complete. Please show this QR code at the venue."
                rows={4}
                className={`${FIELD_CLS} resize-y leading-relaxed`}
              />
            </Row>
            <Row label="답장 받을 이메일" hint="선택 사항이에요. 비우면 Reply-To를 따로 지정하지 않아요.">
              <input
                type="email"
                value={confirmationEmail.replyTo}
                onChange={(e) => patch({ confirmationEmail: { ...confirmationEmail, replyTo: e.target.value.trim() } })}
                placeholder="info@k-expo.org"
                className={`${FIELD_CLS} ${replyToBad ? "text-red-600 dark:text-red-400" : ""}`}
              />
              {replyToBad && <span className="mt-1 block text-[11px] text-red-600 dark:text-red-400">이메일 형식을 확인하세요.</span>}
            </Row>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Switch
                  checked={confirmationEmail.showQr}
                  onChange={(showQr) => patch({ confirmationEmail: { ...confirmationEmail, showQr } })}
                  label="이메일에 QR 표시"
                />
                QR 코드 표시
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Switch
                  checked={confirmationEmail.includeEventInfo}
                  onChange={(includeEventInfo) => patch({ confirmationEmail: { ...confirmationEmail, includeEventInfo } })}
                  label="이메일에 행사 정보 표시"
                />
                일정·장소 표시
              </label>
            </div>
            {confirmationEmail.includeEventInfo && !hasEmailEventInfo && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                일정·장소 표시는 켜져 있지만 표시할 값이 없어요. 위의 행사 개요에 개최일, 장소 또는 운영시간을 입력하세요.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UrlField
                label="인스타그램 링크"
                value={confirmationEmail.instagramUrl}
                onChange={(v) => patch({ confirmationEmail: { ...confirmationEmail, instagramUrl: v } })}
                placeholder="https://instagram.com/koreaexpo_global"
              />
              <UrlField
                label="틱톡 링크"
                value={confirmationEmail.tiktokUrl}
                onChange={(v) => patch({ confirmationEmail: { ...confirmationEmail, tiktokUrl: v } })}
                placeholder="https://tiktok.com/@koreaexpo_official"
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              비워 두면 이메일 하단에 해당 링크를 그리지 않아요. 계정 팔로우를 메일에서만 안내하고 싶을 때 씁니다.
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              발신 주소는 서버의 <code className="font-mono">EMAIL_FROM</code>을 사용해요. 이메일에만 넣을 추가 안내는 안내 블록의 위치를 ‘이메일’로 선택하세요.
            </p>
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            지금은 등록만 저장하고 참가자에게 메일을 보내지 않아요.
          </p>
        )}
      </Block>

      {/* ── 등록 확인 ─────────────────────────────────────────────── */}
      <Block
        title="등록 확인"
        desc="등록자가 자기 QR 을 다시 찾는 화면이에요. 켜면 조회에 성공한 사람에게 티켓이 보입니다."
        right={<Switch checked={config.lookup.enabled} onChange={(v) => patch({ lookup: { ...config.lookup, enabled: v } })} label="등록 확인 사용" />}
      >
        {config.lookup.enabled && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {(["email", "phone"] as const).map((f) => {
                const on = config.lookup.fields.includes(f);
                return (
                  <label key={f} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Switch
                      checked={on}
                      onChange={(v) => patch({
                        lookup: {
                          ...config.lookup,
                          fields: v ? [...config.lookup.fields, f] : config.lookup.fields.filter((x) => x !== f),
                        },
                      })}
                      label={`${f === "email" ? "이메일" : "전화번호"}로 조회`}
                    />
                    {f === "email" ? "이메일" : "전화번호"}
                  </label>
                );
              })}
            </div>
            <Row label="조회 조건" hint="무료 전시는 '하나만 맞아도'가 편해요. 유료로 가면 '둘 다'로 올리세요.">
              <select
                value={config.lookup.logic}
                onChange={(e) => patch({ lookup: { ...config.lookup, logic: e.target.value as "or" | "and" } })}
                className={FIELD_CLS}
              >
                <option value="or">하나만 맞아도 열림</option>
                <option value="and">둘 다 맞아야 열림</option>
              </select>
            </Row>
            {/*
              조회는 열어 두고 QR 만 닫는 조합이 필요하다 — `하나만 맞아도` 로 열어 둔 화면은
              이메일 하나만 아는 사람에게도 열리므로, 유료 티켓이면 여기서 QR 을 끄고
              "메일로 재발송" 으로 돌린다(§10.1).
            */}
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Switch
                checked={config.lookup.showQr}
                onChange={(v) => patch({ lookup: { ...config.lookup, showQr: v } })}
                label="조회 결과에 QR"
              />
              조회에 성공하면 QR 도 보여주기
            </label>
            {config.lookup.logic === "or" && !config.lookup.showQr && (
              <p className="text-[11px] leading-snug text-muted-foreground/70">
                QR 을 껐어요 — 조회한 사람에게는 이름·등록번호만 보입니다.
              </p>
            )}
            {config.lookup.fields.length === 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                조회 항목이 없으면 아무도 찾을 수 없어요.
              </p>
            )}
          </>
        )}
      </Block>
    </div>
  );
}
