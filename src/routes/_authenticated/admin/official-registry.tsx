import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, FileCheck } from "lucide-react";
import { toast } from "sonner";
import { listCases } from "@/lib/admin/admin.functions";
import { listOfficialRegistryTasks, saveOfficialRegistryEvidence } from "@/lib/admin/official-registry.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/official-registry")({
  component: OfficialRegistryPage,
});

interface AttachmentInput {
  filename: string;
  contentType: string;
  fileBase64: string;
}

async function filesToAttachments(files: FileList | null): Promise<AttachmentInput[]> {
  if (!files || files.length === 0) return [];
  return Promise.all(Array.from(files).slice(0, 5).map((file) => new Promise<AttachmentInput>((resolve, reject) => {
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

function OfficialRegistryPage() {
  const list = useServerFn(listCases);
  const listTasks = useServerFn(listOfficialRegistryTasks);
  const saveEvidence = useServerFn(saveOfficialRegistryEvidence);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sourceName: "Official Chinese registry/public source",
    sourceUrl: "",
    retrievalDate: new Date().toISOString().slice(0, 10),
    citation: "",
    chineseLegalName: "",
    englishName: "",
    uscc: "",
    registrationStatus: "",
    incorporationDate: "",
    registeredCapital: "",
    registeredAddress: "",
    legalRepresentative: "",
    businessScope: "",
    shareholdersOwnership: "",
    relatedCompanies: "",
    litigationEnforcementPenalties: "",
    abnormalOperationRecords: "",
    businessLicenceMatchesOfficial: false,
  });

  const casesQuery = useQuery({ queryKey: ["official-registry-cases"], queryFn: () => list() });
  const selectedCaseId = caseId ?? casesQuery.data?.[0]?.id ?? null;
  const tasksQuery = useQuery({
    queryKey: ["official-registry-tasks", selectedCaseId],
    queryFn: () => listTasks({ data: selectedCaseId ? { caseId: selectedCaseId } : {} }),
    enabled: Boolean(selectedCaseId),
  });
  const selectedCase = useMemo(
    () => casesQuery.data?.find((row: any) => row.id === selectedCaseId) ?? casesQuery.data?.[0] ?? null,
    [casesQuery.data, selectedCaseId],
  );
  const pendingTask = (tasksQuery.data ?? []).find((task: any) => task.status === "pending");

  const update = (key: keyof typeof form, value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCaseId) return;
    const contentFields: (keyof typeof form)[] = [
      "chineseLegalName", "englishName", "uscc", "registrationStatus", "incorporationDate",
      "registeredCapital", "registeredAddress", "legalRepresentative", "businessScope",
      "shareholdersOwnership", "relatedCompanies", "litigationEnforcementPenalties", "abnormalOperationRecords",
    ];
    const hasAny = contentFields.some((k) => String(form[k] ?? "").trim().length > 0)
      || (form.businessLicenceMatchesOfficial && (form.uscc.trim() || form.chineseLegalName.trim()));
    if (!hasAny) {
      toast.error("Enter at least one official registry finding (e.g. USCC, legal name, address).");
      return;
    }
    setSaving(true);
    try {
      const attachments = await filesToAttachments(files);

      const result = await saveEvidence({
        data: {
          caseId: selectedCaseId,
          taskId: pendingTask?.id,
          ...form,
          sourceUrl: form.sourceUrl.trim() || null,
          citation: form.citation.trim() || null,
          attachments,
        },
      });
      if (result.rerun?.worker?.status === "failed") toast.error(result.rerun.worker.error ?? "Report regeneration failed");
      else toast.success("Official registry evidence saved and report regenerated");
      setFiles(null);
      await tasksQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message ?? "Official registry evidence save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-[1200px]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/admin" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Admin
        </Link>
        <span>/</span>
        <span>Official registry</span>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Select case</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <Select value={selectedCaseId ?? ""} onValueChange={setCaseId} disabled={casesQuery.isLoading || !casesQuery.data?.length}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Choose a case" /></SelectTrigger>
            <SelectContent>
              {(casesQuery.data ?? []).map((row: any) => (
                <SelectItem key={row.id} value={row.id} className="text-xs">
                  {row.case_reference} - {row.supplier?.stated_name ?? "supplier not set"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Supplier</div>
            <div>{selectedCase?.supplier?.stated_name ?? "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Registry task</div>
            <Badge variant="outline">{pendingTask ? "pending" : "none pending"}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Official browser-assisted registry evidence</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div><Label className="text-xs">Source name</Label><Input required value={form.sourceName} onChange={(e) => update("sourceName", e.target.value)} /></div>
            <div><Label className="text-xs">Source URL</Label><Input value={form.sourceUrl} onChange={(e) => update("sourceUrl", e.target.value)} placeholder="https://..." /></div>
            <div><Label className="text-xs">Retrieval date</Label><Input required type="date" value={form.retrievalDate} onChange={(e) => update("retrievalDate", e.target.value)} /></div>
            <div><Label className="text-xs">Source citation</Label><Input value={form.citation} onChange={(e) => update("citation", e.target.value)} placeholder="Official registry page, screenshot, publication date" /></div>
            <div><Label className="text-xs">Chinese legal name</Label><Input value={form.chineseLegalName} onChange={(e) => update("chineseLegalName", e.target.value)} /></div>
            <div><Label className="text-xs">English name</Label><Input value={form.englishName} onChange={(e) => update("englishName", e.target.value)} /></div>
            <div><Label className="text-xs">Unified Social Credit Code</Label><Input value={form.uscc} onChange={(e) => update("uscc", e.target.value)} /></div>
            <div><Label className="text-xs">Registration status</Label><Input value={form.registrationStatus} onChange={(e) => update("registrationStatus", e.target.value)} /></div>
            <div><Label className="text-xs">Incorporation date</Label><Input value={form.incorporationDate} onChange={(e) => update("incorporationDate", e.target.value)} /></div>
            <div><Label className="text-xs">Registered capital</Label><Input value={form.registeredCapital} onChange={(e) => update("registeredCapital", e.target.value)} /></div>
            <div><Label className="text-xs">Registered address</Label><Input value={form.registeredAddress} onChange={(e) => update("registeredAddress", e.target.value)} /></div>
            <div><Label className="text-xs">Legal representative</Label><Input value={form.legalRepresentative} onChange={(e) => update("legalRepresentative", e.target.value)} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Business scope</Label><Textarea rows={2} value={form.businessScope} onChange={(e) => update("businessScope", e.target.value)} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Shareholders / ownership</Label><Textarea rows={2} value={form.shareholdersOwnership} onChange={(e) => update("shareholdersOwnership", e.target.value)} /></div>
            <div><Label className="text-xs">Related companies</Label><Textarea rows={2} value={form.relatedCompanies} onChange={(e) => update("relatedCompanies", e.target.value)} /></div>
            <div><Label className="text-xs">Litigation / enforcement / penalties</Label><Textarea rows={2} value={form.litigationEnforcementPenalties} onChange={(e) => update("litigationEnforcementPenalties", e.target.value)} /></div>
            <div><Label className="text-xs">Abnormal operation records</Label><Textarea rows={2} value={form.abnormalOperationRecords} onChange={(e) => update("abnormalOperationRecords", e.target.value)} /></div>
            <div>
              <Label className="text-xs">Screenshot/PDF evidence</Label>
              <Input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFiles(e.target.files)} />
            </div>
            <label className="md:col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={form.businessLicenceMatchesOfficial} onChange={(e) => update("businessLicenceMatchesOfficial", e.target.checked)} />
              Uploaded business licence fields match the official registry evidence
            </label>
            <Button type="submit" disabled={saving || !selectedCaseId} className="md:col-span-2">
              <FileCheck className="h-4 w-4" /> Save official evidence and regenerate
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
