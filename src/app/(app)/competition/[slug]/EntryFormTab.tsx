"use client";

import { useMemo, useState } from "react";
import { motion, Reorder } from "framer-motion";
import {
  AlignLeft, ChevronDown, GripVertical, Hash, ImageIcon, ListChecks, ListPlus, Mail, Phone, Plus, SquareCheck, Trash2, Users, Video,
} from "lucide-react";
import { toast } from "sonner";
import { NOTICE_LANGUAGES, type NoticeLanguage } from "@/lib/notice/config";
import { FIELD_CLS, FINISH, R } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/switch";
import { RegTypeMenu, useRegPopover } from "@/components/form-builder/field-types";
import type { CompetitionFieldType, CompetitionFormField, CompetitionRepeaterSubField } from "@/lib/competition-config";
import { CompetitionLegalGenerator } from "./CompetitionLegalGenerator";
import { ConsentBodyField, useWorkspaceLegalProfile } from "@/components/legal/legal-generator-shared";
import { resolveOrgProfile } from "@/lib/legal-templates";
import FormPreview from "./FormPreview";
import type { CompetitionDetail } from "./page";

const CONSENT_KIND_META = {
  privacy: { label: "개인정보 수집·이용 (필수)", noun: "개인정보" },
  marketing: { label: "마케팅 수신 (선택)", noun: "마케팅" },
  thirdParty: { label: "제3자 제공 (선택)", noun: "제3자 제공" },
} as const;

interface Props {
  competition: CompetitionDetail;
  patch: (body: Record<string, unknown>, successMessage?: string) => Promise<boolean>;
  /** 법률 문구 생성기가 워크스페이스 조직 정보를 읽어올 때만 쓴다 — 없으면 그 패널만 비활성. */
  workspaceId?: string;
}

/**
 * **RegTypeMenu 의 meta 로 그대로 넘긴다** — 사전등록(CollectFieldCard)이 쓰는 것과 같은
 * 아이콘 팝오버로 항목 형식을 고른다. 예전엔 여기만 평범한 <select> 였는데, 같은 서비스
 * 안에서 "항목 형식 고르기"가 화면마다 다르게 생기면 헷갈린다 — desc 는 그 팝오버가 쓴다.
 */
const TYPE_META: Record<CompetitionFieldType, { label: string; desc: string; icon: typeof AlignLeft }> = {
  text: { label: "텍스트", desc: "한 줄 입력", icon: AlignLeft },
  email: { label: "이메일", desc: "이메일 주소", icon: Mail },
  tel: { label: "전화번호", desc: "국가 코드 + 숫자만", icon: Phone },
  number: { label: "숫자", desc: "정수만", icon: Hash },
  select: { label: "드롭다운", desc: "하나만 선택", icon: ListChecks },
  multiple: { label: "복수 선택", desc: "여러 개 선택", icon: ListPlus },
  checkbox: { label: "체크박스", desc: "동의·확인", icon: SquareCheck },
  image: { label: "이미지", desc: "사진 업로드", icon: ImageIcon },
  youtube: { label: "YouTube", desc: "영상 링크", icon: Video },
  repeater: { label: "반복 그룹(팀원 등)", desc: "행을 늘려가며 입력", icon: Users },
};

const TYPE_ORDER: CompetitionFieldType[] = ["text", "email", "tel", "number", "select", "multiple", "checkbox", "image", "youtube", "repeater"];
const CHOICE_TYPES: CompetitionFieldType[] = ["select", "multiple"];

/**
 * 반복 그룹으로 막 바꿨을 때 아무 서브필드도 없으면 아무것도 못 받는 빈 항목이 된다 —
 * 이름·이메일 기본값을 미리 채운다. **대회 언어를 따라간다** — 영문 대회에서 이 기본값이
 * 한글로 굳어 있으면(예전엔 그랬다) 나머지 항목은 다 영어인데 이 서브필드만 한글로 남아
 * 미리보기에서 티가 난다.
 */
const REPEATER_DEFAULT_LABELS: Record<NoticeLanguage, { name: string; email: string }> = {
  ko: { name: "이름", email: "이메일" },
  en: { name: "Name", email: "Email" },
  fr: { name: "Nom", email: "E-mail" },
  ja: { name: "氏名", email: "メール" },
};
function defaultRepeaterSubFields(language: NoticeLanguage): CompetitionRepeaterSubField[] {
  const t = REPEATER_DEFAULT_LABELS[language] ?? REPEATER_DEFAULT_LABELS.ko;
  return [
    { key: "name", label: t.name, type: "text", required: true },
    { key: "email", label: t.email, type: "email", required: true },
  ];
}

export default function EntryFormTab({ competition, patch, workspaceId }: Props) {
  const [form, setForm] = useState(competition.config.form);
  /**
   * 문구 언어는 **대회 전체 설정**(기본정보 탭)이다 — 여기서 따로 고르지 않는다.
   * 예전엔 여기서도 고를 수 있었는데, 그 값을 공고 탭이 아니라 **여기 저장이 최종적으로
   * 반영**하는 구조였다(신청 폼 탭 save 가 top-level config.language 를 쓴다) — 그래서
   * 공고 탭의 언어 버튼은 눌러도 반영되지 않는 죽은 컨트롤이었다. 기본정보로 하나로 모은다.
   */
  const language = competition.config.language;
  const [legal, setLegal] = useState(competition.config.legal);
  const [saving, setSaving] = useState(false);

  // 동의 전문 편집 칸이 {{ORG_ADDRESS}} 같은 조직 토큰을 실제 값으로 풀어 보여주는 데 쓴다.
  const { profile: orgProfile } = useWorkspaceLegalProfile(workspaceId);
  const org = useMemo(() => resolveOrgProfile(orgProfile, legal.country), [orgProfile, legal.country]);
  const legalLocale = legal.country === "kr" ? "ko" : "en";

  const update = (next: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...next }));
  const updateField = (id: string, next: Partial<CompetitionFormField>) =>
    setForm((prev) => ({ ...prev, fields: prev.fields.map((f) => (f.id === id ? { ...f, ...next } : f)) }));
  // 로고는 한 폼에 하나만 — 여러 항목이 동시에 로고면 투표 카드가 어느 사진을 배지로
  // 써야 할지 모호해진다. 켤 때 다른 image 항목의 isLogo 를 같이 끈다.
  const setLogoField = (id: string, value: boolean) =>
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => {
        if (f.id === id) return { ...f, isLogo: value };
        if (value && f.type === "image") return { ...f, isLogo: false };
        return f;
      }),
    }));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= form.fields.length) return;
    const fields = [...form.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    update({ fields });
  };

  const addField = () => {
    const id = `f-${Date.now().toString(36)}`;
    update({
      fields: [
        ...form.fields,
        { id, key: `custom_${form.fields.length + 1}`, label: "새 항목", type: "text", placeholder: "", required: false, enabled: true, options: [], system: false },
      ],
    });
  };

  const save = async () => {
    // 키 중복은 제출 데이터를 덮어쓴다 — 저장 전에 막는다.
    const keys = form.fields.map((f) => f.key.trim()).filter(Boolean);
    if (new Set(keys).size !== keys.length) {
      toast.error("항목 키가 중복됐어요. 각 항목의 키는 서로 달라야 해요.");
      return;
    }
    if (keys.length !== form.fields.length) {
      toast.error("키가 비어 있는 항목이 있어요.");
      return;
    }
    setSaving(true);
    try {
      await patch({ config: { ...competition.config, form, legal } }, "신청 폼을 저장했어요");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">폼 안내</h2>

        {/*
          **시스템이 넣는 문구의 언어.** 대회 전체 설정(기본정보 탭)이라 여기서는 읽기만 한다 —
          이유는 위 language 선언부 주석 참고.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">문구 언어</span>
          <span className={`px-2.5 py-1 text-[11px] font-medium ${R.control} bg-secondary text-foreground`}>
            {NOTICE_LANGUAGES.find((l) => l.value === language)?.label ?? language}
          </span>
          <span className="text-[11px] text-muted-foreground">
            파일 크기·영상 공개 설정 안내, 버튼·오류 문구가 바뀌어요 · <b>기본정보 탭</b>에서 바꿀 수 있어요
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">폼 제목</span>
            <input value={form.title} onChange={(e) => update({ title: e.target.value })} className={FIELD_CLS} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">제출 버튼 문구</span>
            <input value={form.submitLabel} onChange={(e) => update({ submitLabel: e.target.value })} className={FIELD_CLS} />
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">안내 문구</span>
            <input value={form.description} onChange={(e) => update({ description: e.target.value })} className={FIELD_CLS} />
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">제출 완료 문구</span>
            <input value={form.successMessage} onChange={(e) => update({ successMessage: e.target.value })} className={FIELD_CLS} />
          </label>
        </div>
      </section>

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">신청 항목</h2>
          <span className="text-[11px] text-muted-foreground">{form.fields.length}개</span>
        </div>

        {/*
          대표 이름 — 참가작 목록·투표·심사·진출·결과·발표에 크게 나오는 이름. 기본은 작품명(title)인데,
          기본 항목의 라벨을 바꿔 다른 용도(Instagram 등)로 쓰면 그 값이 대표 이름이 되어 버린다.
          저장하면 이미 들어온 참가작도 고른 항목 값으로 바뀐다(서버가 다시 쓴다).
        */}
        <label className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">참가작 대표 이름</span>
          <select
            value={form.displayNameKey}
            onChange={(e) => update({ displayNameKey: e.target.value })}
            className={`${FIELD_CLS} h-8 w-auto min-w-[180px] text-xs`}
          >
            {form.fields
              .filter((f) => f.type === "text" && (f.enabled || f.key === form.displayNameKey))
              .map((f) => (
                <option key={f.id} value={f.key}>{(typeof f.label === "string" ? f.label : f.key) || f.key}</option>
              ))}
          </select>
          <span className="text-[11px] text-muted-foreground">목록·투표·진출·결과 화면에 이 항목 값이 이름으로 나와요. 바꾸고 저장하면 이미 들어온 참가작도 바뀌어요.</span>
        </label>

        <Reorder.Group axis="y" values={form.fields} onReorder={(fields) => update({ fields })} className="mt-4 space-y-2">
          {form.fields.map((field, index) => (
            <Reorder.Item key={field.id} value={field} className={`bg-secondary/20 p-3 ${R.surface} ${FINISH.s2}`}>
              <CompetitionFieldRow
                field={field}
                index={index}
                fieldsCount={form.fields.length}
                allFields={form.fields}
                language={language}
                onMove={(direction) => move(index, direction)}
                onUpdate={(patch) => updateField(field.id, patch)}
                onSetLogo={(value) => setLogoField(field.id, value)}
                onRemove={() => update({ fields: form.fields.filter((f) => f.id !== field.id) })}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>

        <button
          onClick={addField}
          className={`mt-3 flex items-center gap-1 bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground ${R.control}`}
        >
          <Plus className="h-3 w-3" /> 항목 추가
        </button>
      </section>

      <section className={`bg-background p-5 ${R.panel} ${FINISH.s1}`}>
        <h2 className="text-sm font-semibold">동의</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          기본 체크는 꺼 두는 것을 권해요 — EU·한국에서는 사전 체크를 유효한 동의로 보지 않습니다.
        </p>
        <div className="mt-4 space-y-4">
          {(["privacy", "marketing", "thirdParty"] as const).map((kind) => {
            const textKey = kind === "privacy" ? "privacyText" : kind === "marketing" ? "marketingText" : "thirdPartyText";
            const bodyKey = kind === "privacy" ? "privacyBody" : kind === "marketing" ? "marketingBody" : "thirdPartyBody";
            const modeKey = kind === "privacy" ? "privacyBodyMode" : kind === "marketing" ? "marketingBodyMode" : "thirdPartyBodyMode";
            const linkKey = kind === "privacy" ? "privacyLinkUrl" : kind === "marketing" ? "marketingLinkUrl" : "thirdPartyLinkUrl";
            const checkedKey = kind === "privacy" ? "privacyDefaultChecked" : kind === "marketing" ? "marketingDefaultChecked" : "thirdPartyDefaultChecked";
            const meta = CONSENT_KIND_META[kind];
            // privacy·marketing 은 항상 폼에 뜬다(끌 수 없다). 제3자 제공만 대회마다 있고 없고가
            // 갈려서 사용 스위치가 따로 있다 — 모든 대회가 협찬사와 정보를 나누는 게 아니다.
            if (kind === "thirdParty" && !form.thirdPartyEnabled) {
              return (
                <div key={kind} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/30 p-2">
                  <span className="text-xs font-medium text-muted-foreground">{meta.label} — 사용 안 함</span>
                  <Switch checked={form.thirdPartyEnabled} onChange={(v) => update({ thirdPartyEnabled: v })} label="제3자 제공 동의 사용" />
                </div>
              );
            }
            return (
              <div key={kind} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{meta.label}</span>
                  <div className="flex items-center gap-3">
                    {kind === "thirdParty" && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        사용
                        <Switch checked={form.thirdPartyEnabled} onChange={(v) => update({ thirdPartyEnabled: v })} label="제3자 제공 동의 사용" />
                      </label>
                    )}
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      기본 체크
                      <Switch checked={form[checkedKey]} onChange={(v) => update({ [checkedKey]: v } as Partial<typeof form>)} label="기본 체크" />
                    </label>
                  </div>
                </div>
                <input
                  value={form[textKey]}
                  onChange={(e) => update({ [textKey]: e.target.value } as Partial<typeof form>)}
                  className={FIELD_CLS}
                />
                <div className="flex w-fit rounded-lg bg-secondary p-0.5 shadow-sm" role="tablist">
                  {(["text", "link"] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={form[modeKey] === mode} onClick={() => update({ [modeKey]: mode } as Partial<typeof form>)} className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${form[modeKey] === mode ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{mode === "text" ? "텍스트" : "링크"}</button>)}
                </div>
                {form[modeKey] === "link" ? <input type="url" value={form[linkKey]} onChange={(e) => update({ [linkKey]: e.target.value } as Partial<typeof form>)} placeholder="https://..." aria-label={`${kind} 링크`} className={FIELD_CLS} /> : <ConsentBodyField
                  value={form[bodyKey]}
                  org={org}
                  locale={legalLocale}
                  onSave={(next) => update({ [bodyKey]: next } as Partial<typeof form>)}
                  placeholder="약관 전문 (입력하면 문구를 눌러 팝업으로 볼 수 있어요)"
                  ariaLabel={`${kind} 전문`}
                  rows={3}
                  className={`${FIELD_CLS} h-auto resize-y py-2`}
                />}
              </div>
            );
          })}
        </div>
      </section>

      <CompetitionLegalGenerator
        form={form}
        legal={legal}
        onFormChange={(next) => update(next)}
        onLegalChange={(next) => setLegal((prev) => ({ ...prev, ...next }))}
        workspaceId={workspaceId}
      />

      <div className="flex justify-end">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={save}
          disabled={saving}
          className={`bg-violet-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:opacity-50 ${R.control}`}
        >
          {saving ? "저장 중..." : "저장"}
        </motion.button>
      </div>
      </div>

      {/* 편집 중인 값(form)을 그대로 넘긴다 — 저장 전에도 바뀌는 게 보여야 미리보기다. */}
      <div className="xl:sticky xl:top-6 xl:self-start">
        <FormPreview config={{ ...competition.config, form, language, legal }} theme={competition.theme} />
      </div>
    </div>
  );
}

/**
 * 신청 항목 한 줄 — Reorder.Item 의 자식으로만 쓴다.
 *
 * 부모의 map 콜백 안에 그대로 두면 useRegPopover(항목 형식 팝오버가 쓰는 훅) 을 행마다
 * 부를 수가 없다(훅은 컴포넌트 몸체에서만 부른다) — 그래서 행 하나를 컴포넌트로 뗐다.
 * 사전등록 카드(CollectFieldCard)와 같은 이유로 같은 모양이 됐다.
 */
function CompetitionFieldRow({
  field,
  index,
  fieldsCount,
  allFields,
  language,
  onMove,
  onUpdate,
  onSetLogo,
  onRemove,
}: {
  field: CompetitionFormField;
  index: number;
  fieldsCount: number;
  allFields: CompetitionFormField[];
  language: NoticeLanguage;
  onMove: (direction: -1 | 1) => void;
  onUpdate: (patch: Partial<CompetitionFormField>) => void;
  onSetLogo: (value: boolean) => void;
  onRemove: () => void;
}) {
  const Icon = TYPE_META[field.type]?.icon ?? AlignLeft;
  const { open: typeOpen, setOpen: setTypeOpen, ref: typeRef } = useRegPopover();

  const changeType = (type: CompetitionFieldType) => {
    setTypeOpen(false);
    if (type === field.type) return;
    // 반복 그룹으로 막 바꿨는데 서브필드가 하나도 없으면 아무것도 못
    // 받는 빈 항목이 된다 — 이름·이메일 기본값을 미리 채워 둔다.
    const subFields = type === "repeater" && (field.subFields?.length ?? 0) === 0
      ? defaultRepeaterSubFields(language)
      : field.subFields;
    onUpdate({ type, subFields, minItems: field.minItems ?? 1, maxItems: field.maxItems ?? 10 });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/40" aria-hidden="true" />
        {/* 드래그는 마우스·터치 전용이라, 키보드로도 옮길 수 있게 화살표를 같이 둔다. */}
        <div className="flex flex-col">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="text-muted-foreground disabled:opacity-30" aria-label="위로">▴</button>
          <button onClick={() => onMove(1)} disabled={index === fieldsCount - 1} className="text-muted-foreground disabled:opacity-30" aria-label="아래로">▾</button>
        </div>
        <input
          value={field.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="항목 이름"
          className={`${FIELD_CLS} h-8 w-40`}
        />
        <input
          value={field.key}
          onChange={(e) => onUpdate({ key: e.target.value })}
          placeholder="key"
          disabled={field.system}
          className={`${FIELD_CLS} h-8 w-28 font-mono text-xs disabled:opacity-60`}
          title={field.system ? "기본 항목의 키는 바꿀 수 없어요" : "저장 데이터의 키"}
        />
        {/* 사전등록 빌더(CollectFieldCard)와 같은 아이콘 팝오버 — 같은 서비스 안에서
            "항목 형식 고르기"가 화면마다 다르게 생기지 않게 한다. */}
        <div className="relative shrink-0" ref={typeRef}>
          <button
            type="button"
            onClick={() => setTypeOpen((v) => !v)}
            disabled={field.system}
            aria-haspopup="menu"
            aria-expanded={typeOpen}
            title={field.system ? "기본 항목의 형식은 바꿀 수 없어요" : undefined}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-background px-2 py-1.5 text-xs font-semibold shadow-sm transition-shadow hover:shadow disabled:opacity-60 disabled:hover:shadow-sm`}
          >
            <span className="grid h-5 w-5 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><Icon className="h-3 w-3" /></span>
            {TYPE_META[field.type].label}
            <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
          </button>
          {typeOpen && !field.system && (
            <RegTypeMenu current={field.type} onPick={changeType} order={TYPE_ORDER} meta={TYPE_META} />
          )}
        </div>
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
          />
          필수
        </label>
        <Switch checked={field.enabled} onChange={(v) => onUpdate({ enabled: v })} label="항목 사용" />
        {field.type === "checkbox" && (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="배경·테두리로 감싸 눈에 띄게 해요 — 참가자격 확인처럼 놓치면 안 되는 체크박스에 써요">
            <Switch checked={field.emphasized ?? false} onChange={(v) => onUpdate({ emphasized: v })} label="강조 표시" />
            강조
          </label>
        )}
        {!field.system && (
          <button
            onClick={onRemove}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
            aria-label="항목 삭제"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {CHOICE_TYPES.includes(field.type) && (
        <div className="mt-2 space-y-1.5 pl-9">
          {field.options.map((option, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={option}
                onChange={(e) => {
                  const options = [...field.options];
                  options[i] = e.target.value;
                  onUpdate({ options });
                }}
                className={`${FIELD_CLS} h-8`}
              />
              <button
                onClick={() => onUpdate({ options: field.options.filter((_, idx) => idx !== i) })}
                className="rounded p-1 text-muted-foreground hover:text-red-500"
                aria-label="선택지 삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => onUpdate({ options: [...field.options, ""] })}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground ${R.control}`}
          >
            <ListPlus className="h-3 w-3" /> 선택지 추가
          </button>
        </div>
      )}

      {field.type === "image" && (
        <div className="mt-2 space-y-2 pl-9">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>최대 장수</span>
            <input
              type="number"
              min={1}
              max={10}
              value={field.maxFiles ?? 3}
              onChange={(e) => onUpdate({ maxFiles: Math.max(1, Number(e.target.value) || 1) })}
              className={`${FIELD_CLS} h-8 w-16`}
            />
            <span>· 장당 4MB 이하 (요청 본문 상한 때문에 1장씩 올라가요)</span>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="투표·결과 카드에서 대표 사진과 별도로 작은 배지로 노출해요 — 한 폼에 하나만 켤 수 있어요">
            <Switch checked={field.isLogo ?? false} onChange={onSetLogo} label="팀 로고로 써요" />
            팀 로고로 써요
          </label>
        </div>
      )}
      {field.type === "youtube" && (
        <p className="mt-2 pl-9 text-[11px] text-muted-foreground">
          제출 시 링크에서 영상 ID만 저장해요. 비공개 영상은 재생되지 않아 신청자에게 안내가 나갑니다.
        </p>
      )}
      {field.type === "number" && (
        <p className="mt-2 pl-9 text-[11px] text-muted-foreground">
          신청자는 정수만 입력할 수 있어요. 반복 그룹의 &ldquo;인원수 항목과 연동&rdquo;에서 고를 수 있어요.
        </p>
      )}

      {field.type === "repeater" && (
        <div className="mt-2 space-y-2 pl-9">
          <p className="text-[11px] text-muted-foreground">
            신청자가 &ldquo;{field.label || "항목"} 추가&rdquo; 버튼으로 행을 늘려가며 채우는 항목이에요.
            한 행에 들어갈 서브필드를 정하세요 (예: 이름, 이메일).
          </p>
          {(field.subFields ?? []).map((sub, i) => {
            const updateSub = (patch: Partial<CompetitionRepeaterSubField>) => {
              const subFields = (field.subFields ?? []).map((s, idx) => (idx === i ? { ...s, ...patch } : s));
              onUpdate({ subFields });
            };
            return (
              <div key={i} className="flex items-center gap-1.5">
                {/* FIELD_CLS 는 w-full 을 이미 갖고 있어 뒤에 붙인 폭 클래스는 무시된다
                    (primitives.tsx 의 FIELD_CLS 주석 참고) — 폭은 래퍼가 갖는다. */}
                <div className="min-w-0 flex-1">
                  <input
                    value={sub.label}
                    onChange={(e) => updateSub({ label: e.target.value })}
                    placeholder="서브필드 이름 (예: 이름)"
                    className={`${FIELD_CLS} h-8`}
                  />
                </div>
                <div className="w-24 shrink-0">
                  <input
                    value={sub.key}
                    onChange={(e) => updateSub({ key: e.target.value })}
                    placeholder="key"
                    className={`${FIELD_CLS} h-8 font-mono text-xs`}
                  />
                </div>
                <div className="w-24 shrink-0">
                  <select
                    value={sub.type}
                    onChange={(e) => updateSub({ type: e.target.value as CompetitionRepeaterSubField["type"] })}
                    className={`${FIELD_CLS} h-8`}
                  >
                    <option value="text">텍스트</option>
                    <option value="email">이메일</option>
                  </select>
                </div>
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={sub.required} onChange={(e) => updateSub({ required: e.target.checked })} />
                  필수
                </label>
                <button
                  onClick={() => onUpdate({ subFields: (field.subFields ?? []).filter((_, idx) => idx !== i) })}
                  className="rounded p-1 text-muted-foreground hover:text-red-500"
                  aria-label="서브필드 삭제"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => onUpdate({
              subFields: [...(field.subFields ?? []), { key: `field_${(field.subFields?.length ?? 0) + 1}`, label: "", type: "text", required: false }],
            })}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground ${R.control}`}
          >
            <ListPlus className="h-3 w-3" /> 서브필드 추가
          </button>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>최소</span>
            <input
              type="number" min={0} max={field.maxItems ?? 10}
              value={field.minItems ?? 1}
              onChange={(e) => onUpdate({ minItems: Math.max(0, Number(e.target.value) || 0) })}
              className={`${FIELD_CLS} h-8 w-16`}
            />
            <span>~ 최대</span>
            <input
              type="number" min={field.minItems ?? 1} max={20}
              value={field.maxItems ?? 10}
              onChange={(e) => onUpdate({ maxItems: Math.max(1, Number(e.target.value) || 1) })}
              className={`${FIELD_CLS} h-8 w-16`}
            />
            <span>명</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>인원수 항목과 연동</span>
            <select
              value={field.countFromKey ?? ""}
              onChange={(e) => onUpdate({ countFromKey: e.target.value || undefined })}
              className={`${FIELD_CLS} h-8 w-auto`}
            >
              <option value="">사용 안 함 (수동으로 +/- )</option>
              {/* 숫자 항목만 고를 수 있게 한다 — 텍스트 항목을 골라 두면 신청자가
                  아무거나 적었을 때 연동이 조용히 안 먹는다. 이미 저장된 값이
                  숫자 항목이 아니어도(옛 설정) 목록에서 사라지지 않게 같이 넣어 둔다. */}
              {allFields
                .filter((f) => f.id !== field.id && (f.type === "number" || f.key === field.countFromKey))
                .map((f) => <option key={f.id} value={f.key}>{f.label || f.key}</option>)}
            </select>
            {field.countFromKey && (
              <>
                <span>에서</span>
                <input
                  type="number" min={0} max={19}
                  value={field.countExclude ?? 0}
                  onChange={(e) => onUpdate({ countExclude: Math.max(0, Number(e.target.value) || 0) })}
                  className={`${FIELD_CLS} h-8 w-14`}
                />
                <span>명 제외 (예: 리더 1명)</span>
              </>
            )}
            {!allFields.some((f) => f.type === "number") && (
              <span className="text-muted-foreground/70">먼저 항목 형식을 &ldquo;숫자&rdquo;로 만들어야 골라 쓸 수 있어요.</span>
            )}
          </div>
          {field.countFromKey && (
            <p className="text-[11px] text-muted-foreground/70">
              연동한 항목에 숫자를 입력하면 행 수가 자동으로 맞춰져요(최소·최대 범위 안에서만). 신청자는 그 뒤로도 +/- 로 손으로 고칠 수 있어요.
            </p>
          )}
        </div>
      )}
    </>
  );
}
