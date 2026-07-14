import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runDemoInvestigation } from "@/lib/demo/demo.functions";
import { Loader2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Run a supplier risk scan — VerifyFirst demo" },
      { name: "description", content: "Try the VerifyFirst supplier verification pipeline live. Enter a supplier and get a real risk report in minutes." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  const navigate = useNavigate();
  const run = useServerFn(runDemoInvestigation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    supplier_name: "",
    supplier_website: "",
    supplier_country: "China",
    product_category: "",
    destination_market: "United States",
    estimated_order_value: "",
    buyer_email: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await run({ data: form });
      navigate({ to: "/r/$shareToken", params: { shareToken: res.shareToken } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-navy text-navy-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-success">Instant Supplier Risk Scan · from €49</p>
          <h1 className="mt-2 text-3xl font-bold text-navy sm:text-4xl">Automated supplier risk pre-screen — before you wire money</h1>
          <p className="mt-3 text-muted-foreground">
            Enter a supplier below. We run the live VerifyFirst pipeline — open-web China registry (GSXT/CODS-style), RDAP, UFLPA, CPSC, sanctions, adverse media — and return an honest risk summary. No payment, no uploads. Documents may be requested only as a next-step safeguard, never up front.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <Field label="Supplier name *" htmlFor="supplier_name">
            <Input id="supplier_name" required value={form.supplier_name} onChange={set("supplier_name")}
              placeholder="Jiangmen Changwen Cookware & Kitchenware Co., Ltd." />
          </Field>
          <Field label="Supplier website *" htmlFor="supplier_website">
            <Input id="supplier_website" required value={form.supplier_website} onChange={set("supplier_website")}
              placeholder="cookwarecw.com" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Supplier country *" htmlFor="supplier_country">
              <Input id="supplier_country" required value={form.supplier_country} onChange={set("supplier_country")} />
            </Field>
            <Field label="Destination market *" htmlFor="destination_market">
              <Input id="destination_market" required value={form.destination_market} onChange={set("destination_market")} />
            </Field>
          </div>
          <Field label="Product category *" htmlFor="product_category">
            <Input id="product_category" required value={form.product_category} onChange={set("product_category")}
              placeholder="Non-stick cookware" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Estimated order value (optional)" htmlFor="estimated_order_value">
              <Input id="estimated_order_value" value={form.estimated_order_value} onChange={set("estimated_order_value")}
                placeholder="$25,000" />
            </Field>
            <Field label="Your email (optional)" htmlFor="buyer_email">
              <Input id="buyer_email" type="email" value={form.buyer_email} onChange={set("buyer_email")}
                placeholder="you@company.com" />
            </Field>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" disabled={busy} className="w-full bg-navy text-navy-foreground hover:bg-navy/90" size="lg">
            {busy ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running investigation… (30–90 seconds)</>
            ) : (
              "Run instant risk scan"
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Uses the live production pipeline. Items without independent official proof are reported as NOT_VERIFIED — we never fabricate registry data.
          </p>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
