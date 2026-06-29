import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  getCase, updateCase, updateCheck, addEvidence, deleteEvidence,
  addCommunication, createReportDraft, updateReportDraft, finaliseReport, markReportDelivered,
} from "@/lib/admin/admin.functions";
import { deriveRisk, HARD_STOP_LABELS, type HardStopKey, type CheckInput } from "@/lib/admin/risk-engine";
import {
  CASE_STATUS_OPTIONS, CHECK_STATUS_OPTIONS, CONFIDENCE_OPTIONS, RISK_RATING_OPTIONS,
  FINAL_OUTCOME_OPTIONS, EVIDENCE_TYPE_OPTIONS, RESPONSE_STATUS_OPTIONS, labelOf,
} from "@/lib/admin/constants";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CaseStatusBadge, CheckStatusBadge, ConfidenceBadge, OutcomeBadge, RiskRatingBadge } from "@/components/admin/badges";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowLeft, CheckCircle2, FilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/cases/$caseId")({
  component: CaseDetail,
});

function CaseDetail() {
  const { caseId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchCase = useServerFn(getCase);

  const q = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => fetchCase({ data: { caseId } }),
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (q.error || !q.data) return <div className="p-6 text-sm text-destructive">Failed to load case.</div>;

  const { caseRow, sections, checks, evidence, communications, documents, reports, activity, analysts } = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["case", caseId] });

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => navigate({ to: "/admin" })} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Cases
        </button>
        <span>/</span>
        <span className="font-mono">{caseRow.case_reference}</span>
      </div>

      <HeaderPanel caseRow={caseRow} analysts={analysts} onChange={refresh} />

      <Tabs defaultValue="investigation" className="space-y-4">
        <TabsList>
          <TabsTrigger value="investigation">Investigation</TabsTrigger>
          <TabsTrigger value="evidence">Evidence ({evidence.length})</TabsTrigger>
          <TabsTrigger value="communications">Communications ({communications.length})</TabsTrigger>
          <TabsTrigger value="risk">Risk summary</TabsTrigger>
          <TabsTrigger value="report">Report ({reports.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="investigation">
          <InvestigationTab sections={sections} checks={checks} caseId={caseRow.id} onChange={refresh} />
        </TabsContent>
        <TabsContent value="evidence">
          <EvidenceTab caseId={caseRow.id} evidence={evidence} checks={checks} onChange={refresh} />
        </TabsContent>
        <TabsContent value="communications">
          <CommsTab caseId={caseRow.id} items={communications} onChange={refresh} />
        </TabsContent>
        <TabsContent value="risk">
          <RiskTab caseRow={caseRow} checks={checks} onChange={refresh} />
        </TabsContent>
        <TabsContent value="report">
          <ReportTab caseRow={caseRow} reports={reports} checks={checks} sections={sections} onChange={refresh} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab items={activity} />
        </TabsContent>
      </Tabs>

      {documents.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Customer-uploaded documents</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1">
            {documents.map((d: any) => <div key={d.id}>{d.filename} — {d.note ?? "—"}</div>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HeaderPanel({ caseRow, analysts, onChange }: { caseRow: any; analysts: any[]; onChange: () => void }) {
  const upd = useServerFn(updateCase);
  async function patch(p: any) {
    try { await upd({ data: { caseId: caseRow.id, patch: p } }); onChange(); }
    catch (e: any) { toast.error(e?.message ?? "Update failed"); }
  }
  return (
    <Card>
      <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3 text-xs">
        <Field label="Case ID"><span className="font-mono text-sm font-semibold">{caseRow.case_reference}</span></Field>
        <Field label="Customer">
          <div className="text-sm font-medium">{caseRow.customer?.company}</div>
          <div className="text-muted-foreground">{caseRow.customer?.full_name} · {caseRow.customer?.email}</div>
        </Field>
        <Field label="Supplier (stated)">{caseRow.supplier?.stated_name ?? "—"}</Field>
        <Field label="Registered legal name">{caseRow.supplier?.registered_legal_name ?? <span className="text-muted-foreground italic">not yet set</span>}</Field>
        <Field label="CN / VN legal name">{caseRow.supplier?.cn_vn_legal_name ?? <span className="text-muted-foreground italic">not yet set</span>}</Field>
        <Field label="Country">{caseRow.supplier?.country ?? "—"}</Field>
        <Field label="Website / Marketplace">
          {caseRow.supplier?.website ? <a className="text-primary hover:underline truncate block" href={caseRow.supplier.website} target="_blank" rel="noopener noreferrer">{caseRow.supplier.website}</a> : "—"}
        </Field>
        <Field label="Supplier contact">{caseRow.supplier?.contact_person ?? "—"}</Field>
        <Field label="Product category">{caseRow.product_category ?? "—"}</Field>
        <Field label="Destination market">{caseRow.destination_market ?? "—"}</Field>
        <Field label="Estimated order value">{caseRow.estimated_order_value ?? "—"}</Field>
        <Field label="Package">{caseRow.package}</Field>
        <Field label="Deadline">{caseRow.deadline ? format(new Date(caseRow.deadline), "PPp") : "—"}</Field>
        <Field label="Status">
          <Select value={caseRow.status} onValueChange={(v) => patch({ status: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CASE_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Assigned analyst">
          <Select value={caseRow.assigned_analyst ?? "__unassigned"} onValueChange={(v) => patch({ assigned_analyst: v === "__unassigned" ? null : v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned" className="text-xs">Unassigned</SelectItem>
              {analysts.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.full_name || a.email}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Overall risk rating">
          <Select value={caseRow.overall_risk_rating ?? "__none"} onValueChange={(v) => patch({ overall_risk_rating: v === "__none" ? null : v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none" className="text-xs">Not set</SelectItem>
              {RISK_RATING_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Completion">
          <div className="flex items-center gap-2">
            <Progress value={caseRow.completion_pct} className="h-1.5" />
            <span className="text-xs tabular-nums">{caseRow.completion_pct}%</span>
          </div>
        </Field>
        <Field label="Customer concerns" className="md:col-span-4">
          <div className="text-xs text-foreground whitespace-pre-wrap">{caseRow.customer_concerns ?? "—"}</div>
        </Field>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function InvestigationTab({ sections, checks, caseId, onChange }: { sections: any[]; checks: any[]; caseId: string; onChange: () => void }) {
  const checksBySection = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const c of checks) (m[c.section_id] ||= []).push(c);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.display_order - b.display_order);
    return m;
  }, [checks]);

  return (
    <Accordion type="multiple" defaultValue={sections.slice(0, 1).map((s: any) => s.id)} className="space-y-2">
      {sections.map((s: any, idx: number) => {
        const items = checksBySection[s.id] ?? [];
        const counts = items.reduce((acc: any, c: any) => {
          if (c.status) acc[c.status] = (acc[c.status] ?? 0) + 1;
          return acc;
        }, {});
        return (
          <AccordionItem key={s.id} value={s.id} className="border rounded-lg bg-card px-3">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center justify-between w-full pr-3">
                <div className="text-left">
                  <div className="text-sm font-semibold">{idx + 1}. {s.name}</div>
                  <div className="text-xs text-muted-foreground">{items.length} questions</div>
                </div>
                <div className="flex gap-1 text-[10px]">
                  {counts.pass && <Badge className="bg-success/15 text-success border-success/40" variant="outline">{counts.pass} pass</Badge>}
                  {counts.caution && <Badge className="bg-warning/20 text-warning-foreground border-warning/40" variant="outline">{counts.caution} caution</Badge>}
                  {counts.fail && <Badge className="bg-danger/15 text-danger border-danger/40" variant="outline">{counts.fail} fail</Badge>}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              {items.length === 0 && <div className="text-xs text-muted-foreground italic">No questions in this section.</div>}
              {items.map((c: any) => <CheckRow key={c.id} check={c} onChange={onChange} />)}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function CheckRow({ check, onChange }: { check: any; onChange: () => void }) {
  const upd = useServerFn(updateCheck);
  const [local, setLocal] = useState(check);
  const [saving, setSaving] = useState(false);

  async function save(patch: any) {
    setSaving(true);
    const next = { ...local, ...patch };
    setLocal(next);
    try { await upd({ data: { checkId: check.id, patch } }); onChange(); }
    catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="border rounded-md p-3 space-y-2 bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium">{check.question}</div>
          {check.is_critical && <Badge variant="outline" className="mt-1 border-danger/40 text-danger text-[10px]">Critical</Badge>}
        </div>
        <CheckStatusBadge value={local.status} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <SmallSelect label="Status" value={local.status ?? ""} options={CHECK_STATUS_OPTIONS} onChange={(v) => save({ status: v || null })} />
        <SmallSelect label="Confidence" value={local.confidence ?? ""} options={CONFIDENCE_OPTIONS} onChange={(v) => save({ confidence: v || null })} />
        <SmallText label="Source name" value={local.source_name ?? ""} onBlur={(v) => v !== (check.source_name ?? "") && save({ source_name: v || null })} onLocal={(v) => setLocal({ ...local, source_name: v })} />
        <SmallText label="Retrieved on" type="date" value={local.source_retrieval_date ?? ""} onBlur={(v) => v !== (check.source_retrieval_date ?? "") && save({ source_retrieval_date: v || null })} onLocal={(v) => setLocal({ ...local, source_retrieval_date: v })} />
      </div>
      <SmallTextarea label="Finding" value={local.finding ?? ""} onBlur={(v) => v !== (check.finding ?? "") && save({ finding: v || null })} onLocal={(v) => setLocal({ ...local, finding: v })} />
      <SmallTextarea label="Evidence summary" value={local.evidence_summary ?? ""} onBlur={(v) => v !== (check.evidence_summary ?? "") && save({ evidence_summary: v || null })} onLocal={(v) => setLocal({ ...local, evidence_summary: v })} />
      <SmallText label="Source URL" value={local.source_url ?? ""} onBlur={(v) => v !== (check.source_url ?? "") && save({ source_url: v || null })} onLocal={(v) => setLocal({ ...local, source_url: v })} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <SmallTextarea label="Buyer impact" value={local.buyer_impact ?? ""} onBlur={(v) => v !== (check.buyer_impact ?? "") && save({ buyer_impact: v || null })} onLocal={(v) => setLocal({ ...local, buyer_impact: v })} />
        <SmallTextarea label="Recommended action" value={local.recommended_action ?? ""} onBlur={(v) => v !== (check.recommended_action ?? "") && save({ recommended_action: v || null })} onLocal={(v) => setLocal({ ...local, recommended_action: v })} />
      </div>
      <SmallTextarea label="Internal notes (not in report)" value={local.internal_notes ?? ""} onBlur={(v) => v !== (check.internal_notes ?? "") && save({ internal_notes: v || null })} onLocal={(v) => setLocal({ ...local, internal_notes: v })} />
      <div className="flex items-center gap-4 pt-1">
        <label className="inline-flex items-center gap-2 text-xs"><Switch checked={!!local.include_in_report} onCheckedChange={(v) => save({ include_in_report: v })} /> Include in client report</label>
        <label className="inline-flex items-center gap-2 text-xs"><Switch checked={!!local.reviewer_approved} onCheckedChange={(v) => save({ reviewer_approved: v })} /> Reviewer approved</label>
        <ConfidenceBadge value={local.confidence} />
        {saving && <span className="text-[10px] text-muted-foreground">Saving…</span>}
      </div>
    </div>
  );
}

function SmallSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none" className="text-xs">— unset —</SelectItem>
          {options.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function SmallText({ label, value, onBlur, onLocal, type = "text" }: { label: string; value: string; onBlur: (v: string) => void; onLocal: (v: string) => void; type?: string }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input className="h-8 text-xs" type={type} value={value} onChange={(e) => onLocal(e.target.value)} onBlur={(e) => onBlur(e.target.value)} />
    </div>
  );
}

function SmallTextarea({ label, value, onBlur, onLocal }: { label: string; value: string; onBlur: (v: string) => void; onLocal: (v: string) => void }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Textarea rows={2} className="text-xs" value={value} onChange={(e) => onLocal(e.target.value)} onBlur={(e) => onBlur(e.target.value)} />
    </div>
  );
}

function EvidenceTab({ caseId, evidence, checks, onChange }: { caseId: string; evidence: any[]; checks: any[]; onChange: () => void }) {
  const add = useServerFn(addEvidence);
  const del = useServerFn(deleteEvidence);
  const [form, setForm] = useState<any>({ evidence_type: "screenshot", title: "", url: "", source: "", retrieval_date: "", related_legal_entity: "", analyst_comments: "", check_id: null, client_visible: false });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await add({ data: { case_id: caseId, ...form } });
      setForm({ ...form, title: "", url: "", analyst_comments: "" });
      onChange();
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle className="text-sm">Add evidence</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <SmallSelect label="Type" value={form.evidence_type} options={EVIDENCE_TYPE_OPTIONS} onChange={(v) => setForm({ ...form, evidence_type: v })} />
            <div><Label className="text-xs">Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label className="text-xs">URL (file or page)</Label><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
            <div><Label className="text-xs">Source</Label><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></div>
            <div><Label className="text-xs">Retrieved on</Label><Input type="date" value={form.retrieval_date} onChange={(e) => setForm({ ...form, retrieval_date: e.target.value })} /></div>
            <div><Label className="text-xs">Related legal entity</Label><Input value={form.related_legal_entity} onChange={(e) => setForm({ ...form, related_legal_entity: e.target.value })} /></div>
            <div>
              <Label className="text-xs">Linked question</Label>
              <Select value={form.check_id ?? "__none"} onValueChange={(v) => setForm({ ...form, check_id: v === "__none" ? null : v })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none" className="text-xs">— none —</SelectItem>
                  {checks.map((c: any) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.question.slice(0, 70)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Analyst comments</Label><Textarea rows={2} value={form.analyst_comments} onChange={(e) => setForm({ ...form, analyst_comments: e.target.value })} /></div>
            <label className="inline-flex items-center gap-2 text-xs"><Switch checked={form.client_visible} onCheckedChange={(v) => setForm({ ...form, client_visible: v })} /> Client-visible</label>
            <Button type="submit" size="sm" className="w-full"><FilePlus className="h-3.5 w-3.5" />Add</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-sm">Evidence items ({evidence.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {evidence.length === 0 && <div className="text-xs text-muted-foreground italic">No evidence yet.</div>}
          {evidence.map((e: any) => (
            <div key={e.id} className="border rounded p-3 text-xs space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-medium text-sm">{e.title}</div>
                  <div className="text-muted-foreground">{labelOf(EVIDENCE_TYPE_OPTIONS, e.evidence_type)} · {e.source ?? "—"} · {e.retrieval_date ?? ""}</div>
                  {e.url && <a className="text-primary hover:underline break-all" href={e.url} target="_blank" rel="noopener noreferrer">{e.url}</a>}
                  {e.analyst_comments && <div className="mt-1">{e.analyst_comments}</div>}
                  {e.client_visible && <Badge variant="outline" className="mt-1 text-[10px]">client-visible</Badge>}
                </div>
                <Button size="icon" variant="ghost" onClick={async () => { await del({ data: { id: e.id } }); onChange(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CommsTab({ caseId, items, onChange }: { caseId: string; items: any[]; onChange: () => void }) {
  const add = useServerFn(addCommunication);
  const [form, setForm] = useState<any>({ question: "", response: "", documents_received: "", analyst_assessment: "", response_status: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await add({ data: { case_id: caseId, ...form, response_status: form.response_status || null } });
      setForm({ question: "", response: "", documents_received: "", analyst_assessment: "", response_status: "" });
      onChange();
    } catch (err: any) { toast.error(err?.message ?? "Failed"); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Log a question / response</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div><Label className="text-xs">Question sent</Label><Textarea required rows={2} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} /></div>
            <div><Label className="text-xs">Response received</Label><Textarea rows={2} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} /></div>
            <div><Label className="text-xs">Documents received</Label><Input value={form.documents_received} onChange={(e) => setForm({ ...form, documents_received: e.target.value })} /></div>
            <div><Label className="text-xs">Analyst assessment</Label><Textarea rows={2} value={form.analyst_assessment} onChange={(e) => setForm({ ...form, analyst_assessment: e.target.value })} /></div>
            <SmallSelect label="Response status" value={form.response_status} options={RESPONSE_STATUS_OPTIONS} onChange={(v) => setForm({ ...form, response_status: v })} />
            <Button type="submit" size="sm">Log</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Communications log ({items.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && <div className="text-xs text-muted-foreground italic">No communications yet.</div>}
          {items.map((c: any) => (
            <div key={c.id} className="border rounded p-3 text-xs space-y-1">
              <div className="text-muted-foreground text-[10px]">{c.comm_date}</div>
              <div><b>Q:</b> {c.question}</div>
              {c.response && <div><b>A:</b> {c.response}</div>}
              {c.documents_received && <div className="text-muted-foreground">Docs: {c.documents_received}</div>}
              {c.analyst_assessment && <div className="italic">{c.analyst_assessment}</div>}
              {c.response_status && <Badge variant="outline" className="text-[10px]">{labelOf(RESPONSE_STATUS_OPTIONS, c.response_status)}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RiskTab({ caseRow, checks, onChange }: { caseRow: any; checks: any[]; onChange: () => void }) {
  const upd = useServerFn(updateCase);
  const input: CheckInput[] = checks.map((c: any) => ({
    id: c.id, status: c.status, is_critical: c.is_critical, finding: c.finding, hard_stop_flags: c.hard_stop_flags ?? null,
  }));
  const r = deriveRisk(input);

  async function saveOutcome(v: string) {
    try { await upd({ data: { caseId: caseRow.id, patch: { final_outcome: v } } }); onChange(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function syncCompletion() {
    await upd({ data: { caseId: caseRow.id, patch: { completion_pct: r.completion_pct, suggested_outcome: r.suggested_outcome, overall_risk_rating: r.suggested_rating } } });
    onChange();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Counts</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Stat label="PASS" value={r.pass} cls="text-success" />
          <Stat label="CAUTION" value={r.caution} cls="text-warning-foreground" />
          <Stat label="FAIL" value={r.fail} cls="text-danger" />
          <Stat label="NOT VERIFIED" value={r.not_verified} cls="text-muted-foreground" />
          <Stat label="Unanswered" value={r.missing} cls="text-muted-foreground" />
          <Stat label="N/A" value={r.not_applicable} cls="text-muted-foreground" />
          <div className="pt-2"><Progress value={r.completion_pct} /></div>
          <div className="text-xs text-muted-foreground">{r.completion_pct}% complete · missing answers are never treated as PASS</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Hard-stop warnings</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {r.hard_stops.length === 0 && <div className="text-muted-foreground italic">None triggered.</div>}
          {r.hard_stops.map((k: HardStopKey) => (
            <div key={k} className="flex items-start gap-2 p-2 border border-danger/40 bg-danger/5 rounded">
              <AlertTriangle className="h-3.5 w-3.5 text-danger shrink-0 mt-0.5" />
              <div className="text-danger">{HARD_STOP_LABELS[k]}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Outcome</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">System suggests</div>
            <OutcomeBadge value={r.suggested_outcome} />
            <div className="mt-1 text-muted-foreground">Suggested rating: <RiskRatingBadge value={r.suggested_rating} /></div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Final outcome (analyst/admin only)</div>
            <Select value={caseRow.final_outcome ?? "__none"} onValueChange={(v) => saveOutcome(v === "__none" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none" className="text-xs">Not set</SelectItem>
                {FINAL_OUTCOME_OPTIONS.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={syncCompletion}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Apply suggestions to case
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: number; cls?: string }) {
  return <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><span className={`font-semibold tabular-nums ${cls}`}>{value}</span></div>;
}

function ReportTab({ caseRow, reports, checks, sections, onChange }: { caseRow: any; reports: any[]; checks: any[]; sections: any[]; onChange: () => void }) {
  const create = useServerFn(createReportDraft);
  const update = useServerFn(updateReportDraft);
  const finalise = useServerFn(finaliseReport);
  const deliver = useServerFn(markReportDelivered);
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const current = reports.find((r: any) => r.id === selectedId) ?? reports[0];

  async function newDraft() {
    try {
      const v = await create({ data: { case_id: caseRow.id } });
      setSelectedId(v.id);
      onChange();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-sm">Versions</CardTitle>
          <Button size="sm" variant="outline" onClick={newDraft}>New draft</Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {reports.length === 0 && <div className="text-xs text-muted-foreground italic">No versions yet.</div>}
          {reports.map((r: any) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={`w-full text-left text-xs p-2 rounded border ${selectedId === r.id ? "border-primary bg-primary/5" : ""}`}>
              <div className="font-medium">v{r.version_number} · {r.status}</div>
              <div className="text-muted-foreground">{format(new Date(r.created_at), "PPp")}</div>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="lg:col-span-3">
        {!current ? (
          <CardContent className="text-sm text-muted-foreground p-8 text-center">Create the first draft to start writing the report.</CardContent>
        ) : (
          <ReportEditor key={current.id} version={current} checks={checks} sections={sections}
            onSave={async (patch) => { await update({ data: { id: current.id, patch } }); onChange(); }}
            onFinalise={async () => { await finalise({ data: { id: current.id } }); onChange(); toast.success("Report finalised"); }}
            onDeliver={async () => { await deliver({ data: { id: current.id } }); onChange(); toast.success("Marked delivered"); }}
          />
        )}
      </Card>
    </div>
  );
}

function ReportEditor({ version, checks, sections, onSave, onFinalise, onDeliver }: { version: any; checks: any[]; sections: any[]; onSave: (p: any) => Promise<void>; onFinalise: () => Promise<void>; onDeliver: () => Promise<void> }) {
  const [v, setV] = useState(version);
  const readOnly = version.status !== "draft";
  const included = checks.filter((c: any) => c.include_in_report);

  function patch(p: any) { const next = { ...v, ...p }; setV(next); if (!readOnly) onSave(p); }

  return (
    <CardContent className="space-y-3 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Version {v.version_number}</div>
          <div className="text-xs text-muted-foreground">Status: {v.status}</div>
        </div>
        <div className="flex gap-2">
          {v.status === "draft" && <Button size="sm" onClick={onFinalise}>Finalise</Button>}
          {v.status === "final" && <Button size="sm" onClick={onDeliver}>Mark delivered</Button>}
          <Button size="sm" variant="outline" onClick={() => window.print()}>Print / PDF</Button>
        </div>
      </div>
      {readOnly && <div className="p-2 border rounded bg-muted text-xs">This version is {v.status} and cannot be edited. Create a new draft to make changes.</div>}

      <div className="grid grid-cols-2 gap-3">
        <SmallSelect label="Overall risk rating" value={v.overall_risk_rating ?? ""} options={RISK_RATING_OPTIONS} onChange={(val) => patch({ overall_risk_rating: val || null })} />
        <SmallSelect label="Final outcome" value={v.final_outcome ?? ""} options={FINAL_OUTCOME_OPTIONS} onChange={(val) => patch({ final_outcome: val || null })} />
      </div>
      <ReportField label="Executive summary" value={v.executive_summary} onChange={(val) => patch({ executive_summary: val })} readOnly={readOnly} />
      <ReportField label="Buyer implications" value={v.buyer_implications} onChange={(val) => patch({ buyer_implications: val })} readOnly={readOnly} />
      <ReportField label="Recommended safeguards" value={v.recommended_safeguards} onChange={(val) => patch({ recommended_safeguards: val })} readOnly={readOnly} />
      <div className="grid grid-cols-3 gap-3">
        <ReportField label="Payment recommendation" value={v.payment_recommendation} onChange={(val) => patch({ payment_recommendation: val })} readOnly={readOnly} />
        <ReportField label="Inspection recommendation" value={v.inspection_recommendation} onChange={(val) => patch({ inspection_recommendation: val })} readOnly={readOnly} />
        <ReportField label="Testing recommendation" value={v.testing_recommendation} onChange={(val) => patch({ testing_recommendation: val })} readOnly={readOnly} />
      </div>
      <ReportField label="Methodology" value={v.methodology} onChange={(val) => patch({ methodology: val })} readOnly={readOnly} />
      <ReportField label="Limitations" value={v.limitations} onChange={(val) => patch({ limitations: val })} readOnly={readOnly} />
      <ReportField label="Independence statement" value={v.independence_statement} onChange={(val) => patch({ independence_statement: val })} readOnly={readOnly} />

      <div className="pt-3 border-t">
        <div className="text-xs font-semibold mb-1">Included findings ({included.length})</div>
        <div className="text-xs text-muted-foreground mb-2">Toggle "Include in client report" in the Investigation tab to add/remove findings.</div>
        <ul className="text-xs list-disc pl-5 space-y-1">
          {included.map((c: any) => (
            <li key={c.id}>
              <span className="font-medium">{c.question}</span> — <CheckStatusBadge value={c.status} />
              {c.finding && <div className="text-muted-foreground">{c.finding}</div>}
            </li>
          ))}
        </ul>
      </div>
    </CardContent>
  );
}

function ReportField({ label, value, onChange, readOnly }: { label: string; value: string | null; onChange: (v: string) => void; readOnly: boolean }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Textarea rows={3} className="text-xs" defaultValue={value ?? ""} onBlur={(e) => onChange(e.target.value)} disabled={readOnly} />
    </div>
  );
}

function ActivityTab({ items }: { items: any[] }) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-2">
        {items.length === 0 && <div className="text-xs text-muted-foreground italic">No activity recorded yet.</div>}
        {items.map((a: any) => (
          <div key={a.id} className="flex gap-3 text-xs border-b pb-2 last:border-0">
            <div className="text-muted-foreground tabular-nums">{format(new Date(a.created_at), "MMM d HH:mm")}</div>
            <div className="font-medium">{a.action}</div>
            {a.payload && <div className="text-muted-foreground truncate">{JSON.stringify(a.payload)}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
