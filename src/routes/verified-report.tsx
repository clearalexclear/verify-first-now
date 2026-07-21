import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitVerifiedReport } from "@/lib/verified-report.functions";
import { getVerifiedReportFlags } from "@/lib/verified-report-flags.functions";
import { FileText, Loader2, ShieldCheck } from "lucide-react";


export const Route = createFileRoute("/verified-report")({
  head: () => ({
    meta: [
      { title: "Verified Supplier Report — VerifyFirst" },
      { name: "description", content: "Send us what the supplier sent you. VerifyFirst checks whether the story holds together before you wire money." },
    ],
  }),
  component: VerifiedReportPage,
});

type DocCategory = "business_licence" | "proforma_invoice" | "certificate_or_test_report";

interface PendingDoc {
  file: File;
  category: DocCategory;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const i = result.indexOf(",");
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function VerifiedReportPage() {
  const submit = useServerFn(submitVerifiedReport);
  const flagsFn = useServerFn(getVerifiedReportFlags);
  const flagsQuery = useQuery({ queryKey: ["verified-report-flags"], queryFn: () => flagsFn() });
  const bypassEnabled = Boolean(flagsQuery.data?.bypassEnabled);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ statusUrl: string; missingRequiredDocuments: string[]; message?: string | null; paymentBypassedForTest?: boolean } | null>(null);
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [form, setForm] = useState({
    supplier_name: "",
    website: "",
    country: "China",
    product_category: "",
    destination_market: "United States",
    order_value: "",
    customer_name: "",
    customer_company: "",
    customer_email: "",
    supplier_refused_licence: false,
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const addDoc = (category: DocCategory) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDocs((current) => [...current.filter((doc) => doc.category !== category || category === "certificate_or_test_report"), { file, category }]);
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payloadDocs = await Promise.all(docs.map(async (doc) => ({
        filename: doc.file.name,
        category: doc.category,
        contentType: doc.file.type || "application/octet-stream",
        fileBase64: await fileToBase64(doc.file),
      })));
      const response = await submit({ data: { ...form, documents: payloadDocs } });
      setResult({
        statusUrl: response.statusUrl,
        missingRequiredDocuments: response.missingRequiredDocuments,
        message: response.message,
        paymentBypassedForTest: response.paymentBypassedForTest,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create verified report case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-navy text-navy-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Verified Supplier Report · €490 · 72-hour delivery</p>
          <h1 className="mt-2 text-3xl font-bold text-navy">Verified Supplier Report</h1>
          <p className="mt-3 text-muted-foreground">
            Send us what your supplier sent you. We check whether the legal, invoice, bank and product story holds together before you pay — and return a clear <span className="font-semibold text-navy">Payment decision: Proceed / Pause / No-Go</span> with deal-specific blockers and exact next actions. Business licence and proforma invoice are required; certificates and test reports are optional.
          </p>
        </div>

        {result ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-xl font-semibold text-navy">Case created</h2>
            {result.missingRequiredDocuments.length ? (
              <p className="mt-2 text-sm text-muted-foreground">
                The case is incomplete and paused until we receive: {result.missingRequiredDocuments.join("; ")}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {result.paymentBypassedForTest
                  ? result.message || "Test mode: payment bypassed. Investigation started."
                  : "Your verified report case is ready for payment setup."}
              </p>
            )}
            <Button asChild className="mt-5 bg-navy text-navy-foreground hover:bg-navy/90">
              <a href={result.statusUrl}>Open case status</a>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Supplier name" required><Input required value={form.supplier_name} onChange={set("supplier_name")} /></Field>
              <Field label="Supplier website" required><Input required value={form.website} onChange={set("website")} /></Field>
              <Field label="Country" required><Input required value={form.country} onChange={set("country")} /></Field>
              <Field label="Product category" required><Input required value={form.product_category} onChange={set("product_category")} /></Field>
              <Field label="Destination market" required><Input required value={form.destination_market} onChange={set("destination_market")} /></Field>
              <Field label="Order value" required><Input required value={form.order_value} onChange={set("order_value")} /></Field>
              <Field label="Your name" required><Input required value={form.customer_name} onChange={set("customer_name")} /></Field>
              <Field label="Company" required><Input required value={form.customer_company} onChange={set("customer_company")} /></Field>
            </div>
            <Field label="Email" required><Input required type="email" value={form.customer_email} onChange={set("customer_email")} /></Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <UploadField label="Business licence required" doc={docs.find((doc) => doc.category === "business_licence")} onChange={addDoc("business_licence")} />
              <UploadField label="Proforma invoice required" doc={docs.find((doc) => doc.category === "proforma_invoice")} onChange={addDoc("proforma_invoice")} />
              <UploadField label="Certificates/test reports optional" doc={docs.find((doc) => doc.category === "certificate_or_test_report")} onChange={addDoc("certificate_or_test_report")} />
            </div>

            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={form.supplier_refused_licence} onChange={set("supplier_refused_licence")} className="mt-1" />
              Supplier refused to provide a business licence
            </label>

            {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

            <Button disabled={busy} className="bg-navy text-navy-foreground hover:bg-navy/90">
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating case...</> : "Start verified report"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-sm text-muted-foreground">
          Need an automated scan without required uploads? <Link to="/demo" className="underline">Run the instant supplier risk scan</Link>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <Label>{label}{required ? " *" : ""}</Label>
      {children}
    </label>
  );
}

function UploadField({ label, doc, onChange }: { label: string; doc?: PendingDoc; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-5 text-center text-sm text-muted-foreground hover:border-navy/40">
      <FileText className="h-5 w-5 text-navy" />
      <span>{doc ? doc.file.name : label}</span>
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={onChange} />
    </label>
  );
}
