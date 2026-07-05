import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { listCases, getCase } from "@/lib/admin/admin.functions";
import { ManualEvidenceTab } from "@/components/admin/manual-evidence-tab";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/manual-evidence")({
  component: ManualEvidencePage,
});

function ManualEvidencePage() {
  const list = useServerFn(listCases);
  const fetchCase = useServerFn(getCase);
  const [caseId, setCaseId] = useState<string | null>(null);

  const casesQuery = useQuery({ queryKey: ["manual-evidence-cases"], queryFn: () => list() });
  const selectedCaseId = caseId ?? casesQuery.data?.[0]?.id ?? null;
  const caseQuery = useQuery({
    queryKey: ["case", selectedCaseId, "manual-evidence"],
    queryFn: () => fetchCase({ data: { caseId: selectedCaseId! } }),
    enabled: Boolean(selectedCaseId),
  });
  const selectedCase = useMemo(
    () => casesQuery.data?.find((row: any) => row.id === selectedCaseId) ?? casesQuery.data?.[0] ?? null,
    [casesQuery.data, selectedCaseId],
  );

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/admin" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Admin
        </Link>
        <span>/</span>
        <span>Manual evidence</span>
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
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer</div>
            <div>{selectedCase?.customer?.company ?? selectedCase?.customer?.full_name ?? "-"}</div>
          </div>
        </CardContent>
      </Card>

      {caseQuery.isLoading && <div className="text-sm text-muted-foreground">Loading case...</div>}
      {caseQuery.error && <div className="text-sm text-destructive">Failed to load case.</div>}
      {caseQuery.data && selectedCaseId && (
        <ManualEvidenceTab
          caseId={selectedCaseId}
          reports={caseQuery.data.reports ?? []}
          onChange={() => caseQuery.refetch()}
        />
      )}
    </div>
  );
}
