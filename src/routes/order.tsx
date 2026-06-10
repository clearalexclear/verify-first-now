import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Check, ArrowLeft, ArrowRight, ShieldCheck, Lock } from "lucide-react";

const TIERS = {
  standard: { name: "Standard", price: 490, delivery: "72 hours" },
  priority: { name: "Priority", price: 690, delivery: "24 hours" },
  onsite: { name: "On-Site", price: 1290, delivery: "7 days" },
} as const;

type TierId = keyof typeof TIERS;

const searchSchema = z.object({
  tier: z.enum(["standard", "priority", "onsite"]).catch("standard"),
});

export const Route = createFileRoute("/order")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Order a verification — VerifyFirst" },
      { name: "description", content: "Start your independent supplier verification. Takes about 5 minutes." },
    ],
  }),
  component: OrderPage,
});

type FormData = {
  // Step 1
  supplierName: string;
  country: string;
  supplierUrl: string;
  supplierContact: string;
  productCategory: string;
  destinationMarket: string;
  documents: string;
  concerns: string;
  // Step 2
  yourName: string;
  yourCompany: string;
  yourEmail: string;
  orderValue: string;
};

const empty: FormData = {
  supplierName: "",
  country: "",
  supplierUrl: "",
  supplierContact: "",
  productCategory: "",
  destinationMarket: "",
  documents: "",
  concerns: "",
  yourName: "",
  yourCompany: "",
  yourEmail: "",
  orderValue: "",
};

function OrderPage() {
  const { tier: initialTier } = Route.useSearch();
  const navigate = useNavigate();
  const [tier, setTier] = useState<TierId>(initialTier);
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(empty);
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState("");

  const tierInfo = TIERS[tier];

  const update = (k: keyof FormData) => (v: string) => setData((d) => ({ ...d, [k]: v }));

  const step1Valid =
    data.supplierName.trim() &&
    data.country &&
    data.supplierUrl.trim() &&
    data.productCategory.trim() &&
    data.destinationMarket;

  const step2Valid =
    data.yourName.trim() &&
    data.yourCompany.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.yourEmail) &&
    data.orderValue;

  const handleSubmit = () => {
    const id = `VF-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    setOrderId(id);
    // Store locally so it can be processed manually until backend is wired
    try {
      const order = {
        id,
        tier,
        price: tierInfo.price,
        delivery: tierInfo.delivery,
        createdAt: new Date().toISOString(),
        ...data,
      };
      const existing = JSON.parse(localStorage.getItem("verifyfirst_orders") || "[]");
      existing.push(order);
      localStorage.setItem("verifyfirst_orders", JSON.stringify(existing));
    } catch {
      /* ignore */
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
          <div className="rounded-2xl border border-success/30 bg-success/5 p-8 text-center sm:p-12">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success text-success-foreground">
              <Check className="h-7 w-7" />
            </span>
            <h1 className="mt-6 text-2xl font-bold text-navy sm:text-3xl">Order received.</h1>
            <p className="mt-4 text-base leading-relaxed text-foreground">
              Your report will be delivered to <strong>{data.yourEmail}</strong> within{" "}
              <strong>{tierInfo.delivery}</strong>. We'll email you if we need anything.
            </p>
            <div className="mt-6 inline-block rounded-md border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
              Order reference: <span className="font-mono font-semibold text-foreground">{orderId}</span>
            </div>
            <div className="mt-8">
              <Button asChild variant="outline">
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          </div>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <button
          onClick={() => navigate({ to: "/" })}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* Stepper */}
        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  step >= n
                    ? "bg-navy text-navy-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > n ? <Check className="h-4 w-4" /> : n}
              </span>
              <div className="hidden text-xs font-medium text-muted-foreground sm:block">
                {n === 1 ? "Supplier" : n === 2 ? "Your details" : "Payment"}
              </div>
              {n < 3 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-10">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold text-navy">Tell us about the supplier</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Whatever you have. We can work with partial information.
              </p>

              <div className="mt-8 space-y-5">
                <Field label="Supplier company name" required>
                  <Input
                    value={data.supplierName}
                    onChange={(e) => update("supplierName")(e.target.value)}
                    placeholder="e.g. Ningbo Brightway Industry & Trade Co., Ltd."
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Country" required>
                    <Select value={data.country} onValueChange={update("country")}>
                      <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="China">China</SelectItem>
                        <SelectItem value="Vietnam">Vietnam</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Destination market" required>
                    <Select value={data.destinationMarket} onValueChange={update("destinationMarket")}>
                      <SelectTrigger><SelectValue placeholder="Select market" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USA">USA</SelectItem>
                        <SelectItem value="EU">EU</SelectItem>
                        <SelectItem value="UK">UK</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label="Website or marketplace URL" required>
                  <Input
                    value={data.supplierUrl}
                    onChange={(e) => update("supplierUrl")(e.target.value)}
                    placeholder="https://... or Alibaba listing URL"
                  />
                </Field>

                <Field label="Contact person at supplier" hint="Optional">
                  <Input
                    value={data.supplierContact}
                    onChange={(e) => update("supplierContact")(e.target.value)}
                    placeholder="Name / WeChat / email"
                  />
                </Field>

                <Field label="Product category" required>
                  <Input
                    value={data.productCategory}
                    onChange={(e) => update("productCategory")(e.target.value)}
                    placeholder="e.g. Stainless steel kitchenware"
                  />
                </Field>

                <Field
                  label="Business license or certificates received"
                  hint="Optional — paste filenames or links; you'll email files after ordering"
                >
                  <Input
                    value={data.documents}
                    onChange={(e) => update("documents")(e.target.value)}
                    placeholder="e.g. ISO 9001 cert, business license PDF"
                  />
                </Field>

                <Field label="Any concerns you already have" hint="Optional">
                  <Textarea
                    rows={4}
                    value={data.concerns}
                    onChange={(e) => update("concerns")(e.target.value)}
                    placeholder="e.g. asking for 50% deposit, factory address looks suspicious…"
                  />
                </Field>
              </div>

              <div className="mt-8 flex justify-end">
                <Button
                  size="lg"
                  disabled={!step1Valid}
                  onClick={() => setStep(2)}
                  className="bg-navy text-navy-foreground hover:bg-navy/90"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-2xl font-bold text-navy">Your details</h2>
              <p className="mt-2 text-sm text-muted-foreground">Where should we deliver the report?</p>

              <div className="mt-8 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Your name" required>
                    <Input
                      value={data.yourName}
                      onChange={(e) => update("yourName")(e.target.value)}
                    />
                  </Field>
                  <Field label="Company" required>
                    <Input
                      value={data.yourCompany}
                      onChange={(e) => update("yourCompany")(e.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Email" required>
                  <Input
                    type="email"
                    value={data.yourEmail}
                    onChange={(e) => update("yourEmail")(e.target.value)}
                    placeholder="you@company.com"
                  />
                </Field>

                <Field label="Estimated order value" required>
                  <Select value={data.orderValue} onValueChange={update("orderValue")}>
                    <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="under_10k">Under €10K</SelectItem>
                      <SelectItem value="10_50k">€10K – €50K</SelectItem>
                      <SelectItem value="50_150k">€50K – €150K</SelectItem>
                      <SelectItem value="150_500k">€150K – €500K</SelectItem>
                      <SelectItem value="over_500k">Over €500K</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  size="lg"
                  disabled={!step2Valid}
                  onClick={() => setStep(3)}
                  className="bg-navy text-navy-foreground hover:bg-navy/90"
                >
                  Review order <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-bold text-navy">Review & pay</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirm your verification tier and complete payment.
              </p>

              {/* Tier picker */}
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {(Object.keys(TIERS) as TierId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTier(id)}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      tier === id
                        ? "border-navy bg-navy/5 ring-2 ring-navy"
                        : "border-border hover:border-navy/40"
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {TIERS[id].name}
                    </div>
                    <div className="mt-1 text-xl font-bold text-navy">€{TIERS[id].price}</div>
                    <div className="text-xs text-muted-foreground">{TIERS[id].delivery}</div>
                  </button>
                ))}
              </div>

              {/* Summary */}
              <div className="mt-8 rounded-lg border border-border bg-muted/40 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Order summary
                </h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <SummaryRow label="Supplier" value={data.supplierName} />
                  <SummaryRow label="Country" value={data.country} />
                  <SummaryRow label="Product" value={data.productCategory} />
                  <SummaryRow label="Delivery to" value={data.yourEmail} />
                  <SummaryRow label="Tier" value={`${tierInfo.name} — ${tierInfo.delivery}`} />
                </dl>
                <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
                  <span className="text-sm font-semibold text-foreground">Total</span>
                  <span className="text-2xl font-bold text-navy">€{tierInfo.price}</span>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-4 text-xs leading-relaxed text-foreground">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <span>
                  <strong>Test mode:</strong> Stripe is not yet wired in. Clicking "Pay" below records your order so we can process it manually and contact you. Enable Lovable Cloud + Stripe to take live payments.
                </span>
              </div>

              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  className="bg-success text-success-foreground hover:bg-success/90"
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Pay €{tierInfo.price} & start verification
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-danger">*</span>}
        {hint && <span className="text-xs font-normal text-muted-foreground">— {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}
