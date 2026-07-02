import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { listCases } from "@/lib/admin/admin.functions";
import { runVerifyFirstJiangmen } from "@/lib/admin/run-verifyfirst.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CaseStatusBadge, RiskRatingBadge } from "@/components/admin/badges";
import { CASE_STATUS_OPTIONS, RISK_RATING_OPTIONS, PACKAGE_LABELS } from "@/lib/admin/constants";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(listCases);
  const q = useQuery({ queryKey: ["admin-cases"], queryFn: () => fn() });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("any");
  const [analyst, setAnalyst] = useState<string>("any");
  const [country, setCountry] = useState<string>("any");
  const [risk, setRisk] = useState<string>("any");
  const [deadline, setDeadline] = useState<string>("any");

  const rows = q.data ?? [];
  const analysts = useMemo(() => Array.from(new Set(rows.map((r: any) => r.analyst_name).filter(Boolean))) as string[], [rows]);
  const countries = useMemo(() => Array.from(new Set(rows.map((r: any) => r.supplier?.country).filter(Boolean))) as string[], [rows]);

  const filtered = rows.filter((r: any) => {
    if (status !== "any" && r.status !== status) return false;
    if (analyst !== "any" && r.analyst_name !== analyst) return false;
    if (country !== "any" && r.supplier?.country !== country) return false;
    if (risk !== "any" && r.overall_risk_rating !== risk) return false;
    if (deadline !== "any" && r.deadline) {
      const d = new Date(r.deadline).getTime(); const now = Date.now();
      if (deadline === "overdue" && d > now) return false;
      if (deadline === "today" && (d < now || d > now + 24*3600*1000)) return false;
      if (deadline === "week" && (d < now || d > now + 7*24*3600*1000)) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const hay = [r.case_reference, r.customer?.full_name, r.customer?.company, r.supplier?.stated_name, r.product_category].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cases</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {rows.length} cases</p>
        </div>
      </div>

      <JiangmenDiagnosticPanel />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 p-3 border rounded-lg bg-card">
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="md:col-span-2" />
        <FilterSelect value={status} onChange={setStatus} placeholder="Status" options={[{value:"any",label:"All statuses"}, ...CASE_STATUS_OPTIONS]} />
        <FilterSelect value={risk} onChange={setRisk} placeholder="Risk" options={[{value:"any",label:"Any risk"}, ...RISK_RATING_OPTIONS]} />
        <FilterSelect value={analyst} onChange={setAnalyst} placeholder="Analyst" options={[{value:"any",label:"Any analyst"}, ...analysts.map(a=>({value:a,label:a}))]} />
        <FilterSelect value={country} onChange={setCountry} placeholder="Country" options={[{value:"any",label:"Any country"}, ...countries.map(c=>({value:c,label:c}))]} />
        <FilterSelect value={deadline} onChange={setDeadline} placeholder="Deadline" options={[
          {value:"any",label:"Any deadline"},
          {value:"overdue",label:"Overdue"},
          {value:"today",label:"Next 24h"},
          {value:"week",label:"Next 7d"},
        ]} />
      </div>

      <div className="border rounded-lg overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Order value</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Analyst</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading && <TableRow><TableCell colSpan={12} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>}
            {!q.isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={12} className="text-center text-sm text-muted-foreground py-8">No cases match these filters.</TableCell></TableRow>
            )}
            {filtered.map((r: any) => (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                <TableCell className="font-mono text-xs">
                  <Link to="/admin/cases/$caseId" params={{ caseId: r.id }} className="text-primary hover:underline">{r.case_reference}</Link>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{r.customer?.company ?? "—"}</div>
                  <div className="text-muted-foreground">{r.customer?.full_name}</div>
                </TableCell>
                <TableCell className="text-xs">{r.supplier?.stated_name ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.supplier?.country ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.product_category ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.estimated_order_value ?? "—"}</TableCell>
                <TableCell className="text-xs">{PACKAGE_LABELS[r.package] ?? r.package}</TableCell>
                <TableCell className="text-xs">
                  {r.deadline ? (
                    <div>
                      <div>{format(new Date(r.deadline), "MMM d, HH:mm")}</div>
                      <div className="text-muted-foreground">{formatDistanceToNow(new Date(r.deadline), { addSuffix: true })}</div>
                    </div>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-xs">{r.analyst_name ?? <span className="text-muted-foreground italic">unassigned</span>}</TableCell>
                <TableCell><CaseStatusBadge value={r.status} /></TableCell>
                <TableCell><RiskRatingBadge value={r.overall_risk_rating} /></TableCell>
                <TableCell className="text-xs tabular-nums">{r.completion_pct}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: readonly { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
