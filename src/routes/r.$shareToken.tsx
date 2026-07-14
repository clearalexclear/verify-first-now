import { createFileRoute, Link } from "@tanstack/react-router";
import { getReportByShareToken } from "@/lib/investigation/investigation.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import type { ChecklistReportResult, FindingStatus, InvestigationReport } from "@/lib/investigation/types";
import {
  CLASSIFICATION_LABEL,
  CONFIDENCE_LABEL,
  OUTCOME_LABEL,
  SECTION_TITLES,
  STATUS_LABEL,
  humanizeOrderValue,
  type ReportSectionKey,
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

const STATUS_STYLE: Record<FindingStatus, string> = {
  PASS: "bg-success text-success-foreground",
  CAUTION: "bg-amber-500 text-white",
  FAIL: "bg-destructive text-destructive-foreground",
  NOT_VERIFIED: "border border-border bg-muted text-muted-foreground",
  NOT_APPLICABLE: "border border-border bg-muted text-muted-foreground",
};

const OUTCOME_STYLE: Record<InvestigationReport["final_outcome"], string> = {
  GO: "bg-success text-success-foreground",
  PROCEED_WITH_SAFEGUARDS: "bg-amber-500 text-white",
  PAUSE_PENDING_CLARIFICATION: "bg-amber-600 text-white",
  NO_GO: "bg-destructive text-destructive-foreground",
};

const SECTION_ORDER: ReportSectionKey[] = [
  "legal_entity",
  "ownership",
  "factory_vs_trader",
  "digital_footprint",
  "certificates_documents",
  "sanctions_forced_labour",
  "litigation_enforcement",
  "export_history",
  "regulatory",
  "payment_safeguards",
];

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

  const checklist = r.checklist_results ?? [];
  const grouped = new Map<ReportSectionKey, ChecklistReportResult[]>();
  for (const item of checklist) {
    grouped.set(item.section, [...(grouped.get(item.section) ?? []), item]);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden"><SiteHeader /></div>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 print:py-2">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-muted-foreground">Report generated {r.generated_at.slice(0, 19).replace("T", " ")} UTC</p>
          <div className="flex gap-2">
            {pdfUrl && (
              <Button asChild variant="outline">
                <a href={pdfUrl} download><Download className="mr-2 h-4 w-4" /> Download PDF</a>
              </Button>
            )}
            <Button onClick={() => window.print()} variant="outline"><Printer className="mr-2 h-4 w-4" /> Print</Button>
          </div>
        </div>

        <header className="rounded-2xl bg-navy p-8 text-navy-foreground sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-wider text-white/70">VerifyFirst - independent supplier verification</p>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{r.supplier_input.name}</h1>
          {r.resolved_entity.legal_name_en && r.resolved_entity.legal_name_en !== r.supplier_input.name && (
            <p className="mt-1 text-white/80">Resolved entity: {r.resolved_entity.legal_name_en}</p>
          )}
          {r.supplier_input.chinese_name && <p className="mt-1 text-white/80">Local name: {r.supplier_input.chinese_name}</p>}
          <div className={`mt-6 inline-flex flex-col rounded-lg px-6 py-4 ${OUTCOME_STYLE[r.final_outcome]}`}>
            <span className="text-xs font-semibold uppercase tracking-wider opacity-80">Commercial recommendation</span>
            <span className="mt-1 text-2xl font-bold">{OUTCOME_LABEL[r.final_outcome]}</span>
            <span className="mt-1 text-xs uppercase opacity-80">Overall risk: {r.overall_risk_rating}</span>
          </div>
          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <Meta label="Order reference" value={r.order_reference} mono />
            <Meta label="Case reference" value={r.case_reference} mono />
            <Meta label="Prepared for" value={`${r.customer_input.name} (${r.customer_input.company})`} />
            <Meta label="Destination market" value={r.customer_input.destination_market} />
            <Meta label="Estimated order value" value={humanizeOrderValue(r.customer_input.estimated_order_value)} />
            <Meta label="Product category" value={r.customer_input.product_category} />
          </dl>
        </header>

        {r.verified_report_decision && <VerifiedReportDecisionPanel decision={r.verified_report_decision} />}

        <Section title="Executive summary">
          <p className="whitespace-pre-wrap leading-relaxed">{r.executive_summary || "(not generated)"}</p>
          <p className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            This report contains {checklist.length} canonical VerifyFirst checklist items. NOT_VERIFIED means evidence is missing or the available source is not sufficient to verify that item. {r.verified_report_decision ? "The Payment decision above reflects the consistency of the documents you provided (business licence, proforma invoice, and any certificates)." : "This is an automated pre-screen (Instant Scan). Documents were not required; if you plan to wire money, upgrade to a Verified Supplier Report so we can check the invoice, bank and entity consistency against your supplier's paperwork."}
          </p>
        </Section>

        {SECTION_ORDER.map((sectionKey) => {
          const items = grouped.get(sectionKey) ?? [];
          if (items.length === 0) return null;
          const title = sectionKey === "payment_safeguards"
            ? "Contradictions, missing information and next actions"
            : SECTION_TITLES[sectionKey];
          return (
            <Section key={sectionKey} title={title}>
              <div className="space-y-4">
                {items.map((item) => <ChecklistItem key={item.id} item={item} />)}
              </div>
            </Section>
          );
        })}

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
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-navy underline">{s.name}</a> : s.name}
                <span className="text-muted-foreground"> - retrieved {s.retrieved_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <div className="print:hidden"><SiteFooter /></div>
    </div>
  );
}

function ChecklistItem({ item }: { item: ChecklistReportResult }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-navy">{item.title}</h4>
        </div>
        <span className={`whitespace-nowrap rounded-full px-3 py-0.5 text-xs font-semibold ${STATUS_STYLE[item.status]}`}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Classification: {CLASSIFICATION_LABEL[item.evidence_classification]} | Confidence: {CONFIDENCE_LABEL[item.confidence]} | Retrieved {item.last_retrieval_date?.slice(0, 10) ?? "not retrieved"}
      </p>
      <p className="mt-2 text-sm"><span className="font-semibold">Explanation:</span> {item.explanation}</p>
      {item.missing_information_required.length > 0 && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          <span className="font-semibold">Missing information required:</span> {item.missing_information_required.join("; ")}
        </p>
      )}
      <p className="mt-2 text-sm"><span className="font-semibold">Buyer impact:</span> {item.buyer_impact}</p>
      <p className="mt-2 text-sm"><span className="font-semibold">Recommended action:</span> {item.recommended_action}</p>
      {item.paid_connector_dependency && (
        <p className="mt-2 text-xs text-muted-foreground">Paid connector dependency: {item.paid_connector_dependency}</p>
      )}
      <div className="mt-3 text-xs text-muted-foreground">
        <p>Sources: {item.source_names.length ? item.source_names.join("; ") : "No independent source evidence"}</p>
        {item.source_urls.length > 0 && (
          <ul className="mt-1 space-y-1">
            {item.source_urls.map((url) => (
              <li key={url}><a href={url} target="_blank" rel="noreferrer" className="break-all text-navy underline">{url}</a></li>
            ))}
          </ul>
        )}
      </div>
    </article>
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
