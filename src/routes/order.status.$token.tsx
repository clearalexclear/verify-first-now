import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getOrderStatusByToken } from "@/lib/investigation/investigation.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, AlertTriangle, FileText } from "lucide-react";

export const Route = createFileRoute("/order/status/$token")({
  head: () => ({
    meta: [
      { title: "Investigation status — VerifyFirst" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: StatusPage,
});

const STAGES = [
  { key: "document_extraction", label: "Reading uploaded documents" },
  { key: "entity_resolution", label: "Resolving registered legal entity" },
  { key: "risk_screening", label: "Screening connected evidence sources" },
  { key: "report_generated", label: "Generating sourced report" },
  { key: "report_delivered", label: "Emailing PDF to you" },
] as const;

type Status = Awaited<ReturnType<typeof getOrderStatusByToken>>;

function StatusPage() {
  const { token } = Route.useParams();
  const fetchStatus = useServerFn(getOrderStatusByToken);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await fetchStatus({ data: { token } });
        if (!alive) return;
        setStatus(s);
        if (s.status !== "delivered" && s.status !== "report_ready" && s.status !== "investigation_failed") {
          timer = setTimeout(tick, 5000);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [fetchStatus, token]);

  const isDone = status?.status === "delivered" || status?.status === "report_ready";
  const isFailed = status?.status === "investigation_failed";
  const isPaymentPending = status?.status === "payment_pending";

  const completedStages = new Set(
    (status?.activity ?? [])
      .filter((a) => ["evidence_added", "report_generated", "report_delivered"].includes(a.action))
      .map((a) => {
        if (a.action === "report_generated") return "report_generated";
        if (a.action === "report_delivered") return "report_delivered";
        try {
          const payload = JSON.parse(a.payload || "null") as { stage?: string };
          return payload?.stage ?? "";
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-8 sm:p-10">
          <h1 className="text-2xl font-bold text-navy">
            {isDone ? "Your report is ready" : isFailed ? "Investigation paused" : isPaymentPending ? "Payment pending" : "Investigation in progress"}
          </h1>
          {status?.orderReference && (
            <p className="mt-2 text-sm text-muted-foreground">
              Order reference: <span className="font-mono font-semibold text-foreground">{status.orderReference}</span>
            </p>
          )}
          {status?.supplierName && (
            <p className="mt-1 text-sm text-muted-foreground">Supplier: {status.supplierName}</p>
          )}

          {!isDone && !isFailed && (
            <div className="mt-6 rounded-lg border border-border bg-muted/30 p-5 text-sm leading-relaxed">
              {isPaymentPending ? (
                <>
                  Your order is saved, but the investigation has not started. It will begin only after Stripe confirms payment server-side.
                </>
              ) : (
                <>
                  Your investigation is running in the background. You can safely close this page — the report will arrive by email at{" "}
                  <strong>{status?.customerEmail || "the address you provided"}</strong>.
                </>
              )}
            </div>
          )}

          {!isPaymentPending && (
            <ul className="mt-6 space-y-3">
              {STAGES.map((s) => {
                const done = completedStages.has(s.key) || isDone;
                const current = !done && !isFailed;
                return (
                  <li key={s.key} className="flex items-center gap-3 text-sm">
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : current ? (
                      <Loader2 className="h-5 w-5 animate-spin text-navy" />
                    ) : (
                      <span className="block h-5 w-5 rounded-full border-2 border-border" />
                    )}
                    <span className={done ? "text-foreground" : current ? "font-semibold text-navy" : "text-muted-foreground"}>
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {isDone && status?.shareToken && (
            <div className="mt-8 rounded-lg border border-success/30 bg-success/5 p-5">
              <p className="text-sm">
                We have emailed the report to <strong>{status.customerEmail}</strong>.
              </p>
              <div className="mt-4">
                <Button asChild className="bg-navy text-navy-foreground hover:bg-navy/90">
                  <Link to="/r/$shareToken" params={{ shareToken: status.shareToken }}>
                    <FileText className="mr-2 h-4 w-4" /> Open report online
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
                <div className="text-sm leading-relaxed">
                  <p className="font-semibold text-destructive">
                    The automated investigation could not complete.
                  </p>
                  <p className="mt-1">
                    Our team has been notified and will deliver your report manually. You will hear from us by email within 1 business day.
                  </p>
                  {status?.error && (
                    <p className="mt-2 break-all text-xs text-muted-foreground">Reason: {status.error}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {err && <p className="mt-6 text-sm text-destructive">{err}</p>}
        </div>
        <div className="mt-6 text-center">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
