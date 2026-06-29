import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listTemplatesAdmin, upsertTemplate, deleteTemplate } from "@/lib/admin/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const qc = useQueryClient();
  const fn = useServerFn(listTemplatesAdmin);
  const up = useServerFn(upsertTemplate);
  const del = useServerFn(deleteTemplate);
  const q = useQuery({ queryKey: ["templates"], queryFn: () => fn() });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const { sections = [], templates = [] } = q.data ?? {};
  const refresh = () => qc.invalidateQueries({ queryKey: ["templates"] });

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Investigation templates</h1>
        <p className="text-sm text-muted-foreground">Edits apply only to new cases. Existing cases keep their original snapshot.</p>
      </div>
      {sections.map((s: any) => {
        const items = templates.filter((t: any) => t.section_id === s.id).sort((a: any, b: any) => a.display_order - b.display_order);
        return (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle className="text-sm">{s.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((t: any) => (
                <TemplateRow key={t.id} t={t} onSave={async (patch) => { await up({ data: { ...t, ...patch } }); refresh(); }} onDelete={async () => { await del({ data: { id: t.id } }); refresh(); toast.success("Deleted"); }} />
              ))}
              <NewTemplate sectionId={s.id} nextOrder={(items[items.length - 1]?.display_order ?? 0) + 1}
                onCreate={async (vals) => { await up({ data: { section_id: s.id, ...vals } }); refresh(); }} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TemplateRow({ t, onSave, onDelete }: { t: any; onSave: (p: any) => Promise<void>; onDelete: () => Promise<void> }) {
  const [q, setQ] = useState(t.question);
  const [g, setG] = useState(t.guidance ?? "");
  return (
    <div className="border rounded p-3 space-y-2">
      <Textarea rows={1} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== t.question && onSave({ question: q })} />
      <Textarea rows={1} placeholder="Guidance (optional)" value={g} onChange={(e) => setG(e.target.value)} onBlur={() => g !== (t.guidance ?? "") && onSave({ guidance: g || null })} />
      <div className="flex items-center gap-4 text-xs">
        <label className="inline-flex items-center gap-2"><Switch checked={t.is_active} onCheckedChange={(v) => onSave({ is_active: v })} /> Active</label>
        <label className="inline-flex items-center gap-2"><Switch checked={t.is_critical} onCheckedChange={(v) => onSave({ is_critical: v })} /> Critical</label>
        <div className="ml-auto"><Button size="icon" variant="ghost" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button></div>
      </div>
    </div>
  );
}

function NewTemplate({ sectionId, nextOrder, onCreate }: { sectionId: string; nextOrder: number; onCreate: (v: any) => Promise<void> }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex gap-2 pt-2 border-t">
      <Input placeholder="New question…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Button size="sm" onClick={async () => { if (!q.trim()) return; await onCreate({ question: q, display_order: nextOrder, is_active: true }); setQ(""); }}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}
