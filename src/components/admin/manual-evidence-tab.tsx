import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FilePlus, RotateCw, Undo2 } from "lucide-react";
import { CANONICAL_CHECKLIST } from "@/lib/investigation/checklist";
import { CLASSIFICATION_LABEL, STATUS_LABEL, type EvidenceClassification, type FindingStatus } from "@/lib/investigation/types";
import { addManualEvidence, listManualEvidence, retractManualEvidence, updateManualEvidence } from "@/lib/admin/manual-evidence.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const CLASSIFICATIONS: EvidenceClassification[] = [
  "VERIFIED",
  "CORROBORATED",
  "SUPPLIER_CLAIMED",
  "INFERRED",
  "NOT_INDEPENDENTLY_VERIFIED",
  "CONTRADICTED",
];

interface ManualEvidenceTabProps {
  caseId: string;
  reports: any[];
  onChange: () => void;
}

interface AttachmentInput {
  filename: string;
  contentType: string;
  fileBase64: string;
}

function latestChecklist(reports: any[]) {
  const latest = reports?.[0]?.snapshot?.checklist_results;
  return Array.isArray(latest) ? latest : [];
}

async function filesToAttachments(files: FileList | null): Promise<AttachmentInput[]> {
  if (!files || files.length === 0) return [];
  const selected = Array.from(files).slice(0, 5);
  return Promise.all(selected.map((file) => new Promise<AttachmentInput>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      fileBase64: String(reader.result || ""),
    });
    reader.readAsDataURL(file);
  })));
}

function statusBadge(status: FindingStatus | null | undefined) {
  if (!status) return <Badge variant="outline">No report yet</Badge>;
  return <Badge variant="outline">{STATUS_LABEL[status]}</Badge>;
}

export function ManualEvidenceTab({ caseId, reports, onChange }: ManualEvidenceTabProps) {
  const listFn = useServerFn(listManualEvidence);
  const addFn = useServerFn(addManualEvidence);
  const updateFn = useServerFn(updateManualEvidence);
  const retractFn = useServerFn(retractManualEvidence);
  const checklist = useMemo(() => latestChecklist(reports), [reports]);
  const byId = useMemo(() => new Map(checklist.map((item: any) => [item.id, item])), [checklist]);
  const q = useQuery({
    queryKey: ["manual-evidence", caseId],
    queryFn: () => listFn({ data: { caseId } }),
  });
  const [selected, setSelected] = useState(CANONICAL_CHECKLIST[0].id);
  const [findingText, setFindingText] = useState("");
  const [classification, setClassification] = useState<EvidenceClassification>("VERIFIED");
  const [citation, setCitation] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Record<string, { findingText: string; classification: EvidenceClassification; citation: string }>>({});

  const entries = q.data ?? [];
  const activeEntries = entries.filter((entry: any) => !entry.retracted_at);

  async function refreshAll() {
    await q.refetch();
    onChange();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const attachments = await filesToAttachments(files);
      const result = await addFn({ data: { caseId, checklistId: selected, findingText, classification, citation, attachments } });
      if (result.rerun?.worker?.status === "failed") toast.error(result.rerun.worker.error ?? "Report regeneration failed");
      else toast.success("Manual evidence saved and report regeneration started");
      setFindingText("");
      setCitation("");
      setFiles(null);
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? "Manual evidence save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(entry: any) {
    const draft = editing[entry.id];
    if (!draft) return;
    setSaving(true);
    try {
      const result = await updateFn({ data: { evidenceFactId: entry.id, ...draft } });
      if (result.rerun?.worker?.status === "failed") toast.error(result.rerun.worker.error ?? "Report regeneration failed");
      else toast.success("Manual evidence updated and report regenerated");
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? "Manual evidence update failed");
    } finally {
      setSaving(false);
    }
  }

  async function retract(entry: any) {
    setSaving(true);
    try {
      const result = await retractFn({ data: { evidenceFactId: entry.id, reason: "Retracted by analyst before report fulfillment" } });
      if (result.rerun?.worker?.status === "failed") toast.error(result.rerun.worker.error ?? "Report regeneration failed");
      else toast.success("Manual evidence retracted and report regenerated");
      await refreshAll();
    } catch (err: any) {
      toast.error(err?.message ?? "Manual evidence retraction failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Add manual evidence</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label className="text-xs">Checklist item</Label>
              <Select value={selected} onValueChange={(v) => setSelected(v as typeof selected)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CANONICAL_CHECKLIST.map((item) => {
                    const current = byId.get(item.id) as any;
                    return <SelectItem key={item.id} value={item.id} className="text-xs">{item.title} - {current?.status ? STATUS_LABEL[current.status as FindingStatus] : "No report"}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Finding</Label>
              <Textarea required rows={3} value={findingText} onChange={(e) => setFindingText(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Classification</Label>
              <Select value={classification} onValueChange={(v) => setClassification(v as EvidenceClassification)}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLASSIFICATIONS.map((item) => <SelectItem key={item} value={item} className="text-xs">{CLASSIFICATION_LABEL[item]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Source citation</Label>
              <Input required value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="Panda360 report 2026-07-05" />
            </div>
            <div>
              <Label className="text-xs">Attachments (PDF, PNG, JPG)</Label>
              <Input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFiles(e.target.files)} />
            </div>
            <Button type="submit" size="sm" className="w-full" disabled={saving}>
              <FilePlus className="h-3.5 w-3.5" /> Save and regenerate
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-sm">32 verification checks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {CANONICAL_CHECKLIST.map((item) => {
            const current = byId.get(item.id) as any;
            const itemEntries = activeEntries.filter((entry: any) => entry.checklist_id === item.id);
            return (
              <div key={item.id} className="border rounded p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{item.title}</div>
                    <div className="text-muted-foreground">{item.section.replace(/_/g, " ")}</div>
                  </div>
                  {statusBadge(current?.status as FindingStatus | undefined)}
                </div>
                {itemEntries.length === 0 ? (
                  <div className="text-muted-foreground italic">No active analyst evidence.</div>
                ) : itemEntries.map((entry: any) => {
                  const draft = editing[entry.id] ?? {
                    findingText: entry.evidence_excerpt ?? "",
                    classification: entry.classification as EvidenceClassification,
                    citation: entry.source_citation ?? "",
                  };
                  return (
                    <div key={entry.id} className="border rounded bg-muted/30 p-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">{CLASSIFICATION_LABEL[entry.classification as EvidenceClassification]}</Badge>
                        <Button size="sm" variant="ghost" disabled={saving} onClick={() => retract(entry)}><Undo2 className="h-3.5 w-3.5" /> Retract</Button>
                      </div>
                      <Textarea rows={2} className="text-xs" value={draft.findingText} onChange={(e) => setEditing({ ...editing, [entry.id]: { ...draft, findingText: e.target.value } })} />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <Select value={draft.classification} onValueChange={(v) => setEditing({ ...editing, [entry.id]: { ...draft, classification: v as EvidenceClassification } })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{CLASSIFICATIONS.map((c) => <SelectItem key={c} value={c} className="text-xs">{CLASSIFICATION_LABEL[c]}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="h-8 text-xs" value={draft.citation} onChange={(e) => setEditing({ ...editing, [entry.id]: { ...draft, citation: e.target.value } })} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span>{Array.isArray(entry.attachment_paths) ? entry.attachment_paths.length : 0} attachment(s)</span>
                        <Button size="sm" variant="outline" disabled={saving} onClick={() => saveEdit(entry)}><RotateCw className="h-3.5 w-3.5" /> Update and regenerate</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
