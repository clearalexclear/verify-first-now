import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getIntegrationDiagnostics } from "@/lib/admin/integration-diagnostics.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/integration-diagnostics")({
  component: IntegrationDiagnostics,
});

function statusBadge(status: string) {
  const map: Record<string, string> = {
    configured: "bg-green-600 text-white",
    official_free: "bg-blue-600 text-white",
    web_intelligence_only: "bg-amber-500 text-white",
    not_configured: "bg-muted text-foreground",
  };
  return <Badge className={map[status] ?? "bg-muted"}>{status.replace(/_/g, " ")}</Badge>;
}

function runBadge(s: string | null) {
  if (!s) return <span className="text-muted-foreground text-xs">never run</span>;
  const map: Record<string, string> = {
    success: "bg-green-600 text-white",
    not_found: "bg-blue-500 text-white",
    error: "bg-red-600 text-white",
    not_configured: "bg-muted text-foreground",
    skipped: "bg-muted text-foreground",
    rate_limited: "bg-amber-600 text-white",
  };
  return <Badge className={map[s] ?? "bg-muted"}>{s}</Badge>;
}

function IntegrationDiagnostics() {
  const [caseId, setCaseId] = useState("");
  const fn = useServerFn(getIntegrationDiagnostics);
  const q = useQuery({
    queryKey: ["integration-diagnostics", caseId],
    queryFn: () => fn({ data: caseId ? { caseId } : {} }),
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integration diagnostics</h1>
        <p className="text-sm text-muted-foreground">
          Provider-by-provider status of the VerifyFirst investigation pipeline. Optionally scope
          to a specific case ID to see per-case run/evidence counts.
        </p>
      </div>
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Optional case UUID"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {q.error ? (
        <div className="rounded border border-destructive/50 bg-destructive/10 text-destructive p-3 text-sm">
          {String((q.error as Error).message)}
        </div>
      ) : null}

      {q.data ? (
        <>
          <div className="space-y-3">
            {q.data.providers.map((p) => (
              <div key={p.id} className="rounded-lg border bg-card p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    <span className="text-xs text-muted-foreground">{p.category}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(p.status)}
                    {runBadge(p.lastRun.status)}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{p.notes}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="font-medium">Required env</div>
                    {p.requiredEnv.length === 0 ? (
                      <div className="text-muted-foreground">none</div>
                    ) : (
                      <ul className="list-disc pl-4">
                        {p.requiredEnv.map((k) => (
                          <li key={k}>
                            <code>{k}</code>{" "}
                            {p.envConfigured[k] ? (
                              <span className="text-green-600">configured</span>
                            ) : (
                              <span className="text-red-600">missing</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 font-medium">Checklist items affected</div>
                    <div className="text-muted-foreground">
                      {p.checklistItemsAffected.join(", ") || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Last run</div>
                    <div className="text-muted-foreground">
                      {p.lastRun.at ? new Date(p.lastRun.at).toLocaleString() : "never"}
                    </div>
                    {p.lastRun.sourceUrl && (
                      <div className="text-muted-foreground truncate">
                        <a href={p.lastRun.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                          {p.lastRun.sourceUrl}
                        </a>
                      </div>
                    )}
                    {p.lastRun.error && (
                      <div className="mt-1 rounded bg-destructive/10 text-destructive p-2 whitespace-pre-wrap">
                        {p.lastRun.error}
                      </div>
                    )}
                    <div className="mt-2 font-medium">Evidence produced</div>
                    <div className="text-muted-foreground">{p.evidenceCount} fact(s)</div>
                    {p.lastEvidenceExcerpt && (
                      <div className="mt-1 rounded bg-muted p-2 whitespace-pre-wrap">
                        {p.lastEvidenceExcerpt}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border p-4 space-y-1">
            <h3 className="font-semibold text-sm">Providers explicitly NOT implemented</h3>
            <p className="text-xs text-muted-foreground">
              These are never called and never listed as queried in any report.
            </p>
            <ul className="text-xs list-disc pl-4">
              {q.data.notImplemented.map((n) => (
                <li key={n.id}>
                  <code>{n.id}</code> — {n.reason}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
