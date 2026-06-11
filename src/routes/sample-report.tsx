import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RiskBadge } from "@/components/RiskBadge";
import { Check, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/sample-report")({
  head: () => ({
    meta: [
      { title: "Sample Supplier Verification Report — VerifyFirst" },
      {
        name: "description",
        content:
          "See exactly what a VerifyFirst supplier verification report looks like — structure, depth and risk rating illustrated on a fictional Chinese supplier.",
      },
      { property: "og:title", content: "Sample report — VerifyFirst" },
      {
        property: "og:description",
        content: "A fictional sample illustrating the structure and depth of a VerifyFirst report.",
      },
    ],
  }),
  component: SampleReport,
});

function SampleReport() {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="bg-muted/50 pb-48 pt-10 sm:pt-14">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {/* Paper container */}
          <article className="sample-watermark relative overflow-hidden rounded-lg bg-card shadow-sm ring-1 ring-border">
            <div className="sample-watermark-text" aria-hidden="true" />

            {/* Header band */}
            <header className="relative z-10 bg-navy px-6 py-8 text-navy-foreground sm:px-12 sm:py-10">
              <div className="flex items-center gap-2 text-navy-foreground/90">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-navy-foreground/10">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold tracking-wide">VerifyFirst</span>
              </div>
              <h1 className="mt-5 text-xl font-bold tracking-tight sm:text-2xl">
                SUPPLIER VERIFICATION REPORT
              </h1>
              <p className="mt-1 text-sm text-navy-foreground/70">Independent due diligence</p>
            </header>

            <div className="relative z-10 px-6 py-8 sm:px-12 sm:py-12">
              {/* Disclaimer */}
              <div className="rounded-md border border-border bg-muted/40 p-4 text-xs italic leading-relaxed text-muted-foreground">
                This is a fictional sample report created to illustrate the structure and depth of a typical VerifyFirst supplier verification report. Real findings depend on available supplier, country, product, and registry data.
              </div>

              {/* Report metadata — executive cover panel */}
              <section className="mt-8 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                <header className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-navy">
                    Executive information
                  </h2>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Confidential
                  </span>
                </header>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-6 text-sm sm:grid-cols-2">
                  <MetaRow label="Report ID" value="VF-2026-0147 (SAMPLE)" />
                  <MetaRow label="Date of issue" value={today} />
                  <MetaRow label="Prepared for" value="[Client name redacted]" />
                  <MetaRow label="Subject" value="Ningbo Brightway Industry & Trade Co., Ltd." />
                  <MetaRow label="Country" value="China (Zhejiang Province)" />
                  <MetaRow label="Product category" value="Stainless steel kitchenware" />
                  <MetaRow label="Stated order value" value="€45,000" />
                </dl>
              </section>

              {/* Overall rating */}
              <div className="mt-8 rounded-lg border border-warning/40 bg-warning/10 p-6">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Overall Risk Rating
                  </span>
                  <RiskBadge level="caution">Caution</RiskBadge>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-foreground">
                  <strong>Recommendation:</strong> Proceed only with structured payment terms and pre-shipment inspection. Do not pay more than 30% deposit. Key concern: subject is a trading company presenting itself as a manufacturer, with certification inconsistencies.
                </p>
              </div>

              {/* Key findings */}
              <div className="mt-6 rounded-lg border border-border bg-card p-5 shadow-sm">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-navy">
                  Key findings
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {[
                    { ok: true, text: "Legal entity verified" },
                    { ok: false, text: "Trading company, not direct manufacturer" },
                    { ok: true, text: "Export history found in relevant product category" },
                    { ok: false, text: "One certificate unverifiable" },
                    { ok: false, text: "Proceed only with safeguards" },
                  ].map((f) => (
                    <li key={f.text} className="flex items-start gap-2">
                      {f.ok ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-warning" />
                      )}
                      <span>{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>


              {/* Exec summary */}
              <SectionTitle>Executive summary</SectionTitle>
              <p className="text-sm leading-relaxed text-foreground">
                Ningbo Brightway Industry & Trade Co., Ltd. is a legally registered and operating Chinese company with verifiable export history in the stated product category. However, our verification identified three material findings: (1) the company is a trading intermediary, not the factory it presents itself as in its marketplace listings; (2) one of three certifications provided could not be verified with the issuing body; (3) registered capital is modest relative to the order volumes the company claims to handle. None of these findings individually indicates fraud, but together they warrant adjusted payment terms and independent quality control before shipment.
              </p>

              {/* Section 1 */}
              <SectionTitle number="1">Legal entity verification</SectionTitle>
              <div className="mb-4"><RiskBadge level="pass">Pass</RiskBadge></div>
              <ReportTable
                rows={[
                  ["Registered name (Chinese)", "宁波明路工贸有限公司"],
                  ["Registered name (English)", "Ningbo Brightway Industry & Trade Co., Ltd."],
                  ["Unified Social Credit Code", "91330212MA2H4XXXXX"],
                  ["Registration date", "14 March 2017"],
                  ["Registered capital", "RMB 1,000,000 (~€128,000) — NOTE: subscribed, not necessarily paid-in"],
                  ["Legal representative", "Chen W."],
                  ["Registered address", "Yinzhou District, Ningbo, Zhejiang"],
                  ["Business scope", "Wholesale and trade of metal products, kitchenware, daily-use goods; import/export of goods"],
                  ["Company status", "Active, in good standing"],
                  ["Legal disputes", "1 minor civil dispute (2022, supplier payment, settled). No ongoing litigation."],
                ]}
              />
              <AnalystNote>
                Business scope is registered as <strong>WHOLESALE AND TRADE</strong> — manufacturing is not included in the registered scope. This is the first indicator that the entity does not operate its own production facility.
              </AnalystNote>

              {/* Section 2 */}
              <SectionTitle number="2">Factory vs. trading company determination</SectionTitle>
              <div className="mb-4"><RiskBadge level="caution">Caution</RiskBadge></div>
              <p className="text-sm leading-relaxed text-foreground">
                <strong>Finding:</strong> Subject is a <strong>TRADING COMPANY</strong> presenting as a manufacturer.
              </p>
              <p className="mt-4 text-sm font-semibold text-foreground">Evidence:</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground">
                <li>Registered business scope excludes manufacturing (Section 1).</li>
                <li>The factory address shown in the supplier's marketplace listing belongs to a different legal entity: <em>Ningbo Hengfeng Metalware Manufacturing Co., Ltd.</em> No ownership link between the two entities was found in registry records.</li>
                <li>Social insurance filings indicate approximately 11 employees — consistent with a trading office, not the "300+ workers" claimed in marketing materials.</li>
              </ul>
              <AnalystNote>
                <strong>Implication for buyer:</strong> A 15–25% intermediary margin is likely priced into quotations. More importantly, quality control responsibility is diluted: the seller does not control production. This is common practice in Chinese export trade — approximately half of "manufacturers" on B2B marketplaces are intermediaries — but it changes how the relationship should be managed. Direct factory identification is possible on request.
              </AnalystNote>

              {/* Section 3 */}
              <SectionTitle number="3">Export history analysis</SectionTitle>
              <div className="mb-4"><RiskBadge level="pass">Pass</RiskBadge></div>
              <p className="text-xs italic text-muted-foreground">Source: customs shipment records, 36-month lookback.</p>
              <div className="mt-4">
                <ReportTable
                  rows={[
                    ["Total recorded export shipments (36 mo)", "87"],
                    ["Primary destination markets", "Germany (34%), USA (28%), Netherlands (12%), Australia (9%), other (17%)"],
                    ["Product categories shipped", "Stainless steel kitchenware (HS 7323), aluminum cookware (HS 7615) — consistent with stated category"],
                    ["Largest single shipment value (est.)", "~US$ 62,000"],
                    ["Shipment frequency trend", "Stable, 2–3 shipments/month average"],
                    ["Known buyers include", "Mid-size EU kitchenware importers; one recurring US Amazon-focused buyer"],
                  ]}
                />
              </div>
              <AnalystNote>
                Export history is genuine, recent, and in the correct product category. Volumes are consistent with a functioning trade operation. The company has demonstrably shipped to demanding markets (Germany, USA) repeatedly — a meaningful positive signal.
              </AnalystNote>

              {/* Section 4 */}
              <SectionTitle number="4">Certification authenticity check</SectionTitle>
              <div className="mb-4"><RiskBadge level="caution">Caution</RiskBadge></div>
              <p className="text-sm text-foreground">
                Certificates provided by supplier: <strong>3</strong>. Verified: <strong>2</strong>. Unverifiable: <strong>1</strong>.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-left">
                      <th className="py-2 pr-3 font-semibold text-foreground">Certificate</th>
                      <th className="py-2 pr-3 font-semibold text-foreground">Issuing body</th>
                      <th className="py-2 font-semibold text-foreground">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border align-top">
                      <td className="py-3 pr-3">ISO 9001:2015</td>
                      <td className="py-3 pr-3 text-muted-foreground">TÜV-affiliated certifier</td>
                      <td className="py-3 text-sm">
                        <span className="font-semibold text-success">✓ Verified</span> — valid, but issued to <em>Ningbo Hengfeng Metalware</em> (the factory), not to the subject company.
                      </td>
                    </tr>
                    <tr className="border-b border-border align-top">
                      <td className="py-3 pr-3">LFGB food contact (DE)</td>
                      <td className="py-3 pr-3 text-muted-foreground">SGS</td>
                      <td className="py-3 text-sm">
                        <span className="font-semibold text-success">✓ Verified</span> — test report genuine, dated 14 months ago, specific to one product SKU only.
                      </td>
                    </tr>
                    <tr className="align-top">
                      <td className="py-3 pr-3">"FDA certificate"</td>
                      <td className="py-3 pr-3 text-muted-foreground">"FDA"</td>
                      <td className="py-3 text-sm">
                        <span className="font-semibold text-danger">✗ Unverifiable</span> — the document presented is not an FDA-issued certificate. The FDA does not issue "certificates" of this type for food-contact kitchenware. Document appears to be a third-party template. This is a widespread practice and not necessarily intentional fraud, but the document has no regulatory value for US import.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <AnalystNote>
                <strong>Implication for buyer:</strong> For US-bound kitchenware, do not rely on the provided "FDA certificate." Independent food-contact testing of your actual production batch (~€400–800) is recommended.
              </AnalystNote>

              {/* Section 5 */}
              <SectionTitle number="5">Red flag screening</SectionTitle>
              <div className="mb-4"><RiskBadge level="pass">Pass</RiskBadge></div>
              <ReportTable
                rows={[
                  ["International sanctions lists (OFAC, EU, UN)", "No match"],
                  ["US UFLPA / forced labor entity lists", "No match"],
                  ["Chinese court enforcement (\"dishonest debtor\") list", "No match"],
                  ["Marketplace blacklists & fraud databases", "No match"],
                  ["Negative media screening", "None found"],
                ]}
              />

              {/* Section 6 */}
              <SectionTitle number="6">Final assessment & recommendations</SectionTitle>
              <div className="mb-4 flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Overall rating:</span>
                <RiskBadge level="caution">Caution — transactable with safeguards</RiskBadge>
              </div>
              <p className="text-sm leading-relaxed text-foreground">
                This supplier is a real, operating trade business with genuine export history in your product category — not a fraud risk in the classic sense. The caution rating stems from misrepresentation of manufacturing status and one unverifiable certificate, both of which materially affect how you should structure the deal.
              </p>
              <p className="mt-5 text-sm font-semibold text-foreground">Recommended safeguards:</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-foreground">
                <li><strong>Payment terms:</strong> maximum 30% deposit, balance against copy of bill of lading. Do not accept 50/70% deposit requests.</li>
                <li><strong>Quality control:</strong> commission a pre-shipment inspection (PSI) at the actual factory before balance payment. Budget €250–350.</li>
                <li><strong>Compliance:</strong> for US sales, run independent food-contact testing on your production batch; disregard the provided FDA document.</li>
                <li><strong>Optional:</strong> we can identify and verify the actual manufacturing factory (<em>Ningbo Hengfeng Metalware Manufacturing Co., Ltd.</em>) as a separate engagement — buying direct could recover the intermediary margin on repeat orders.</li>
              </ol>

              {/* Methodology */}
              <SectionTitle>Methodology & limitations</SectionTitle>
              <p className="text-sm leading-relaxed text-foreground">
                This report is based on official corporate registry records, customs shipment databases, certification body verification, sanctions and litigation databases, and open-source intelligence, accurate as of the date of issue. It is a desk-based investigation and does not include a physical site visit unless the On-Site tier was purchased. This report is provided for the exclusive use of the client and does not constitute a guarantee of supplier performance.
              </p>

              <h4 className="mt-8 text-sm font-semibold uppercase tracking-wide text-navy">Source confidence</h4>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-border text-left">
                      <th className="py-2 pr-3 font-semibold text-foreground">Verification area</th>
                      <th className="py-2 font-semibold text-foreground">Confidence level</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ConfRow area="Legal entity records" level="high">High</ConfRow>
                    <ConfRow area="Export/shipment history" level="amber-green">Medium to High, depending on data availability</ConfRow>
                    <ConfRow area="Certificate authenticity" level="amber-green">Medium to High, depending on issuer response</ConfRow>
                    <ConfRow area="Factory vs trading company determination" level="amber">Medium</ConfRow>
                    <ConfRow area="Fraud/red flag screening" level="amber-green">Medium to High</ConfRow>
                  </tbody>
                </table>
              </div>

              <div className="mt-6 rounded-md border-l-4 border-navy bg-muted/50 p-4 text-sm leading-relaxed text-foreground">
                Where a fact cannot be independently verified, the report marks it clearly as <em>"Not independently verified"</em> rather than assuming it is true.
              </div>

              <div className="mt-8 rounded-md border border-success/30 bg-success/5 p-4 text-sm leading-relaxed text-foreground">
                <strong className="text-success">Independence statement —</strong> VerifyFirst accepts no payment, commission, or referral fee from suppliers, factories, or sourcing agents. We are paid exclusively by buyers.
              </div>

              <div className="mt-10 border-t border-border pt-6 text-center text-xs uppercase tracking-widest text-muted-foreground">
                — End of sample report —
              </div>
            </div>
          </article>

          {/* What we need from you */}
          <div className="mt-10 rounded-xl border border-border bg-card p-6 sm:p-8">
            <h3 className="text-lg font-bold text-navy">What we need from you</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Ordering takes 5 minutes. To start a verification, we ask for:
            </p>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {[
                "Supplier company name",
                "Website or marketplace link",
                "Contact person",
                "Business license or certificates received, if available",
                "Product category",
                "Destination market",
                "Estimated order value",
                "Any concerns you already have",
              ].map((it) => (
                <li key={it} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-muted-foreground">
              Don't have everything? Send what you have — we work with partial information.
            </p>
          </div>

          {/* Closing */}
          <div className="mt-10 rounded-xl border border-border bg-navy p-8 text-center text-navy-foreground sm:p-12">
            <h3 className="text-2xl font-bold sm:text-3xl">This is what €490 buys you.</h3>
            <p className="mt-4 text-sm leading-relaxed text-navy-foreground/80 sm:text-base">
              Every report is researched and written for your specific supplier and your specific order. Average delivery: 72 hours.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-6 h-12 bg-success px-8 text-base font-semibold text-success-foreground hover:bg-success/90"
            >
              <Link to="/order" search={{ tier: "standard" }}>Check my supplier before I pay the deposit</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm font-medium text-foreground">
            Check my supplier before I pay the deposit — <span className="font-bold text-navy">€490</span>
          </p>
          <Button asChild size="sm" className="bg-navy text-navy-foreground hover:bg-navy/90">
            <Link to="/order" search={{ tier: "standard" }}>Start verification</Link>
          </Button>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SectionTitle({ children, number }: { children: React.ReactNode; number?: string }) {
  return (
    <h3 className="mt-12 mb-5 border-b border-border pb-2 text-base font-bold uppercase tracking-wide text-navy">
      {number && <span className="mr-2 text-muted-foreground">§{number}</span>}
      {children}
    </h3>
  );
}

function ReportTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="border-b border-border align-top last:border-0">
              <td className="w-2/5 py-2.5 pr-4 font-medium text-muted-foreground">{k}</td>
              <td className="py-2.5 text-foreground">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalystNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-md border-l-4 border-navy/40 bg-muted/40 p-4 text-sm italic leading-relaxed text-foreground">
      <span className="mr-1 font-sans not-italic font-semibold text-navy">Analyst note:</span>
      {children}
    </div>
  );
}

function ConfRow({
  area,
  level,
  children,
}: {
  area: string;
  level: "high" | "amber-green" | "amber";
  children: React.ReactNode;
}) {
  const colorClass =
    level === "high"
      ? "text-success font-semibold"
      : level === "amber-green"
        ? "font-semibold"
        : "text-warning-foreground font-semibold";
  const style =
    level === "amber-green"
      ? { color: "oklch(0.65 0.15 110)" }
      : undefined;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2.5 pr-3 text-foreground">{area}</td>
      <td className={`py-2.5 ${colorClass}`} style={style}>{children}</td>
    </tr>
  );
}
