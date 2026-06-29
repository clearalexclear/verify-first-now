import { createFileRoute, Link } from "@tanstack/react-router";
import { getReportByShareToken } from "@/lib/investigation/investigation.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import type { Finding, InvestigationReport } from "@/lib/investigation/types";
import {
  CONFIDENCE_LABEL,
  OUTCOME_LABEL,
  SECTION_TITLES,
  STATUS_LABEL,
} from "@/lib/investigation/types";

export const Route = createFileRoute("/r/$shareToken")({
  head: () => ({
    meta: [
      { title: "VerifyFirst supplier verification report" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  loader: async ({ params }) => {
    const data = await getReportByShareToken({ data: { shareToken: params.shareToken } });
    return data;
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-xl p-12 text-center">
      <h1 className="text-2xl font-bold text-navy">Report not found</h1>
      <p className="mt-3 text-muted-foreground">{error.message}</p>
      <Button asChild className="mt-6">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl p-12 text-center">
      <h1 className="text-2xl font-bold text-navy">Report not found</h1>
    </div>
  ),
  component: ReportPage,
});

const STATUS_STYLE: Record<Finding["status"], string> = {
  PASS: "bg-success text-success-foreground",
  CAUTION: "bg-amber-500 text-white",
  FAIL: "bg-destructive text-destructive-foreground",
  NOT_VERIFIED: "bg-muted text-muted-foreground border border-border",
  NOT_APPLICABLE: "bg-muted text-muted-foreground border border-border",
};

const OUTCOME_STYLE: Record<InvestigationReport["final_outcome"], string> = {
  GO: "bg-success text-success-foreground",
  PROCEED_WITH_SAFEGUARDS: "bg-amber-500 text-white",
  PAUSE_PENDING_CLARIFICATION: "bg-amber-600 text-white",
  NO_GO: "bg-destructive text-destructive-foreground",
};

function ReportPage() {
  const { reportJson, pdfUrl } = Route.useLoaderData();
  const r = JSON.parse(reportJson || "null") as InvestigationReport | null;
  if (!r) {
    return (
      <div className="mx-auto max-w-xl p-12 text-center">
        <h1 className="text-2xl font-bold text-navy">Report unavailable.</h1>
      </div>
    );
  }

  const sectionFindings: Record<string, Finding[]> = {};
  for (const f of r.findings) (sectionFindings[f.section] ||= []).push(f);

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 print:py-2">
        {/* Action bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-muted-foreground">
            Report generated {new Date(r.generated_at).toLocaleString()}
          </p>
          <div className="flex gap-2">
            {pdfUrl && (
              <Button asChild variant="outline">
                <a href={pdfUrl} download>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </a>
              </Button>
            )}
            <Button onClick={() => window.print()} variant="outline">
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
          </div>
        </div>

        {/* Cover */}
        <header className="rounded-2xl bg-navy p-8 text-navy-foreground sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-wider text-white/70">
            VerifyFirst — independent supplier verification
          </p>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{r.supplier_input.name}</h1>
          {r.resolved_entity.legal_name_en && r.resolved_entity.legal_name_en !== r.supplier_input.name && (
            <p className="mt-1 text-white/80">Resolved entity: {r.resolved_entity.legal_name_en}</p>
          )}
          {r.supplier_input.chinese_name && (
            <p className="mt-1 text-white/80">Local name: {r.supplier_input.chinese_name}</p>
          )}
          <div className={`mt-6 inline-flex flex-col rounded-lg px-6 py-4 ${OUTCOME_STYLE[r.final_outcome]}`}>
            <span className="text-xs font-semibold uppercase tracking-wider opacity-80">Final recommendation</span>
            <span className="mt-1 text-2xl font-bold">{OUTCOME_LABEL[r.final_outcome]}</span>
            <span className="mt-1 text-xs uppercase opacity-80">
              Overall risk: {r.overall_risk_rating}
            </span>
          </div>
          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <Meta label="Order reference" value={r.order_reference} mono />
            <Meta label="Case reference" value={r.case_reference} mono />
            <Meta label="Prepared for" value={`${r.customer_input.name} (${r.customer_input.company})`} />
            <Meta label="Destination market" value={r.customer_input.destination_market} />
            <Meta label="Estimated order value" value={r.customer_input.estimated_order_value} />
            <Meta label="Product category" value={r.customer_input.product_category} />
          </dl>
        </header>

        {/* Executive */}
        <Section title="Executive summary">
          <p className="whitespace-pre-wrap leading-relaxed">{r.executive_summary || "(not generated)"}</p>
          {r.key_findings.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold text-navy">Key findings</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {r.key_findings.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            </>
          )}
        </Section>

        {/* Resolved entity */}
        <Section title={SECTION_TITLES.legal_entity}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ["Legal name (English)", r.resolved_entity.legal_name_en],
              ["Legal name (local)", r.resolved_entity.legal_name_local],
              ["Registration number", r.resolved_entity.registration_number],
              ["Country", r.resolved_entity.registration_country],
              ["Status", r.resolved_entity.registration_status],
              ["Registration date", r.resolved_entity.registration_date],
              ["Registered capital", r.resolved_entity.registered_capital],
              ["Registered address", r.resolved_entity.registered_address],
              ["Legal representative", r.resolved_entity.legal_representative],
              ["Confidence", r.resolved_entity.confidence.replace("_", "-")],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v && String(v).length ? String(v) : "Not independently verified"}</dd>
              </div>
            ))}
          </dl>
          {r.resolved_entity.business_scope && (
            <>
              <h3 className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Business scope</h3>
              <p className="mt-1 text-sm">{r.resolved_entity.business_scope}</p>
            </>
          )}
          {r.resolved_entity.notes && (
            <p className="mt-3 text-xs text-muted-foreground">{r.resolved_entity.notes}</p>
          )}
        </Section>

        {/* Findings sections */}
        {Object.entries(sectionFindings).map(([key, items]) => {
          if (key === "legal_entity") return null;
          return (
            <Section
              key={key}
              title={SECTION_TITLES[key as keyof typeof SECTION_TITLES] || key}
            >
              <div className="space-y-5">
                {items.map((f, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="font-semibold text-navy">{f.item}</h4>
                      <span className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLE[f.status]}`}>
                        {STATUS_LABEL[f.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Confidence: {CONFIDENCE_LABEL[f.confidence]} • Source: {f.source_name} • Retrieved {f.retrieval_date.slice(0, 10)}
                    </p>
                    {f.source_url && (
                      <a href={f.source_url} className="text-xs text-navy underline break-all" target="_blank" rel="noreferrer">
                        {f.source_url}
                      </a>
                    )}
                    {f.evidence_excerpt && (
                      <p className="mt-3 text-sm"><span className="font-semibold">Evidence:</span> {f.evidence_excerpt}</p>
                    )}
                    {f.buyer_impact && (
                      <p className="mt-2 text-sm"><span className="font-semibold">Buyer impact:</span> {f.buyer_impact}</p>
                    )}
                    {f.recommended_action && (
                      <p className="mt-2 text-sm"><span className="font-semibold">Recommended action:</span> {f.recommended_action}</p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          );
        })}

        {/* Implications + safeguards */}
        <Section title="Buyer implications">
          <p className="whitespace-pre-wrap leading-relaxed">{r.buyer_implications}</p>
        </Section>
        <Section title="Recommended safeguards">
          <p className="whitespace-pre-wrap leading-relaxed">{r.recommended_safeguards}</p>
          <ul className="mt-3 space-y-1 text-sm">
            <li><strong>Payment:</strong> {r.payment_recommendation}</li>
            <li><strong>Pre-shipment inspection:</strong> {r.inspection_recommendation}</li>
            <li><strong>Product testing:</strong> {r.testing_recommendation}</li>
          </ul>
        </Section>

        <Section title="Sources, methodology and limitations">
          <h3 className="text-sm font-semibold text-navy">Methodology</h3>
          <p className="mt-1 text-sm leading-relaxed">{r.methodology}</p>
          <h3 className="mt-4 text-sm font-semibold text-navy">Limitations</h3>
          <p className="mt-1 text-sm leading-relaxed">{r.limitations}</p>
          <h3 className="mt-4 text-sm font-semibold text-navy">Sources consulted</h3>
          <ul className="mt-2 space-y-1 text-xs">
            {r.sources_used.map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-navy underline break-all">{s.name}</a>
                ) : s.name}
                <span className="text-muted-foreground"> — retrieved {s.retrieved_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <div className="print:hidden">
        <SiteFooter />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-8 print:break-inside-avoid">
      <h2 className="text-xl font-bold text-navy">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-white/60">{label}</dt>
      <dd className={mono ? "font-mono font-semibold text-white" : "font-medium text-white"}>{value}</dd>
    </div>
  );
}
