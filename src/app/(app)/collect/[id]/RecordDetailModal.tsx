"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Check, Edit2, Save, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { formatKstDateTime } from "@/lib/datetime";
import ModalShell from "./ModalShell";
import { dateTimeIn } from "@/lib/collect-checkin";
import { formatCollectValue } from "@/lib/collect-columns";

const spring = { type: "spring", stiffness: 420, damping: 30 } as const;

interface FieldMapping {
  id: string;
  key: string;
  label: string;
  type: string;
}

interface CollectRecord {
  id: string;
  data: Record<string, string>;
  registrationNo: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmCampaign: string | null;
  firstUtmTerm: string | null;
  firstUtmContent: string | null;
  firstReferrer: string | null;
  firstSeenAt: string | null;
  referrer: string | null;
  createdAt: string;
  /** 현장 체크인 스캔 기록(최근 순) */
  checkIns?: { scannedAt: string; method: string; staffLabel: string }[];
  checkinTimezone?: string;
}

const CHECKIN_METHOD_LABEL: Record<string, string> = { camera: "카메라", scanner: "스캐너", manual: "직접 입력" };

interface Props {
  sourceId: string;
  recordId: string;
  fieldMappings: FieldMapping[];
  onClose: () => void;
  onChanged: () => void;
}

export default function RecordDetailModal({ sourceId, recordId, fieldMappings, onClose, onChanged }: Props) {
  const confirm = useConfirm();
  const [record, setRecord] = useState<CollectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftUtm, setDraftUtm] = useState<Partial<CollectRecord>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/collect-sources/${sourceId}/records/${recordId}`);
        const data = await res.json();
        if (!res.ok) { toast.error(data.error ?? "불러오기 실패"); onClose(); return; }
        setRecord(data.record);
        setDraft({ ...(data.record.data ?? {}) });
        setDraftUtm({
          utmSource: data.record.utmSource ?? "",
          utmMedium: data.record.utmMedium ?? "",
          utmCampaign: data.record.utmCampaign ?? "",
          utmTerm: data.record.utmTerm ?? "",
          utmContent: data.record.utmContent ?? "",
          referrer: data.record.referrer ?? "",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [sourceId, recordId, onClose]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/collect-sources/${sourceId}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: draft,
          utmSource: draftUtm.utmSource || null,
          utmMedium: draftUtm.utmMedium || null,
          utmCampaign: draftUtm.utmCampaign || null,
          utmTerm: draftUtm.utmTerm || null,
          utmContent: draftUtm.utmContent || null,
          referrer: draftUtm.referrer || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "저장 실패"); return; }
      toast.success("저장됐어요");
      setRecord(data.record);
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!(await confirm({ title: "레코드를 삭제할까요?", description: "되돌릴 수 없어요.", confirmLabel: "삭제", tone: "danger" }))) return;
    const res = await fetch(`/api/collect-sources/${sourceId}/records/${recordId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("삭제 실패"); return; }
    toast.success("삭제됐어요");
    onChanged();
    onClose();
  };

  const headerExtra = !loading && record ? (
    <>
      {editing ? (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          저장
        </motion.button>
      ) : (
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={spring}
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-secondary transition-colors"
        >
          <Edit2 className="w-3.5 h-3.5" />편집
        </motion.button>
      )}
      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.92 }}
        transition={spring}
        onClick={handleDelete}
        className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
        title="삭제"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </motion.button>
    </>
  ) : null;

  return (
    <ModalShell
      open
      onClose={onClose}
      title="레코드 상세"
      description={record ? `${formatKstDateTime(record.createdAt)} KST · ${record.id}` : undefined}
      size="md"
      headerExtra={headerExtra}
      footer={editing && !loading ? (
        <>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={() => { setEditing(false); if (record) { setDraft({ ...record.data }); } }}
            className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            취소
          </motion.button>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={spring}
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            저장
          </motion.button>
        </>
      ) : null}
    >
      <div className="space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : record ? (
            <>
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">필드</p>
                {record.registrationNo && (
                  <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
                    <div className="text-xs text-muted-foreground pt-2">등록번호</div>
                    <div className="text-sm py-2 break-words">{record.registrationNo}</div>
                  </div>
                )}
                {record.checkIns && record.checkIns.length > 0 && (
                  <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
                    <div className="text-xs text-muted-foreground pt-2">현장 입장</div>
                    <ul className="py-2 space-y-0.5 text-sm">
                      {record.checkIns.map((c, i) => (
                        <li key={i} className="tabular-nums">
                          {dateTimeIn(record.checkinTimezone ?? "Asia/Seoul", c.scannedAt)}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {[CHECKIN_METHOD_LABEL[c.method] ?? c.method, c.staffLabel].filter(Boolean).join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {fieldMappings.length === 0 && <p className="text-xs text-muted-foreground">필드 설정이 없어요</p>}
                {fieldMappings.map((f) => (
                  <div key={f.id} className="grid grid-cols-[120px_1fr] gap-3 items-start">
                    <div className="text-xs text-muted-foreground pt-2">{f.label}</div>
                    {editing ? (
                      <input
                        type="text"
                        value={draft[f.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-violet-400 transition-colors"
                      />
                    ) : (
                      <div className="text-sm py-2 break-words">{formatCollectValue(record.data[f.key]) || <span className="text-muted-foreground italic">(비어있음)</span>}</div>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">최종 유입 (Last touch) · Referrer</p>
                {([
                  ["utmSource", "UTM 소스"],
                  ["utmMedium", "UTM 매체"],
                  ["utmCampaign", "UTM 캠페인"],
                  ["utmTerm", "UTM 키워드"],
                  ["utmContent", "UTM 콘텐츠"],
                  ["referrer", "Referrer"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="grid grid-cols-[120px_1fr] gap-3 items-start">
                    <div className="text-xs text-muted-foreground pt-2">{label}</div>
                    {editing ? (
                      <input
                        type="text"
                        value={(draftUtm[key] as string) ?? ""}
                        onChange={(e) => setDraftUtm((d) => ({ ...d, [key]: e.target.value }))}
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-violet-400 transition-colors"
                      />
                    ) : (
                      <div className="text-sm py-2 break-words">{(record[key] as string) || <span className="text-muted-foreground italic">-</span>}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* 최초 유입 (편집 불가, 어트리뷰션 무결성 위해) */}
              {(record.firstUtmSource || record.firstReferrer || record.firstSeenAt) && (
                <div className="space-y-2 border-t border-border pt-4">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">최초 유입 (First touch)</p>
                  {([
                    ["firstUtmSource", "UTM 소스"],
                    ["firstUtmMedium", "UTM 매체"],
                    ["firstUtmCampaign", "UTM 캠페인"],
                    ["firstUtmTerm", "UTM 키워드"],
                    ["firstUtmContent", "UTM 콘텐츠"],
                    ["firstReferrer", "Referrer"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="grid grid-cols-[120px_1fr] gap-3 items-start">
                      <div className="text-xs text-muted-foreground pt-2">{label}</div>
                      <div className="text-sm py-2 break-words">{(record[key] as string) || <span className="text-muted-foreground italic">-</span>}</div>
                    </div>
                  ))}
                  {record.firstSeenAt && (
                    <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
                      <div className="text-xs text-muted-foreground pt-2">First Seen</div>
                      <div className="text-sm py-2 text-muted-foreground">{formatKstDateTime(record.firstSeenAt)} KST</div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
      </div>
    </ModalShell>
  );
}
