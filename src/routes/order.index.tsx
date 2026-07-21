import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
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
import { submitOrder } from "@/lib/orders.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import {
  Check,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Lock,
  Upload,
  X,
  FileText,
} from "lucide-react";

const TIERS = {
  standard: { name: "Standard", price: 490, delivery: "AI report by email" },
  priority: { name: "Priority", price: 690, delivery: "Priority queue" },
  onsite: { name: "On-Site", price: 1290, delivery: "7 days incl. inspection" },
} as const;

type TierId = keyof typeof TIERS;

const DOC_CATEGORIES = [
  { value: "business_licence", label: "Business licence" },
  { value: "certificate", label: "Certificate / test report" },
  { value: "quotation", label: "Quotation / payment instructions" },
] as const;
type DocCategory = (typeof DOC_CATEGORIES)[number]["value"];

const MAX_FILES = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const ALLOWED_EXTS = ["pdf", "jpg", "jpeg", "png"];

interface PendingDoc {
  file: File;
  category: DocCategory;
  error?: string;
}

const searchSchema = z.object({
  tier: z.enum(["standard", "priority", "onsite"]).catch("standard"),
});

export const Route = createFileRoute("/order/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Order a verification — VerifyFirst" },
      { name: "description", content: "Start your automated AI supplier investigation. Report by email." },
    ],
  }),
  component: OrderPage,
});

type FormData = {
  supplierName: string;
  supplierChineseName: string;
  country: string;
  supplierUrl: string;
  supplierContact: string;
  productCategory: string;
  productDescription: string;
  destinationMarket: string;
  concerns: string;
  yourName: string;
  yourCompany: string;
  yourEmail: string;
  orderValue: string;
};

const empty: FormData = {
  supplierName: "",
  supplierChineseName: "",
  country: "",
  supplierUrl: "",
  supplierContact: "",
  productCategory: "",
  productDescription: "",
  destinationMarket: "",
  concerns: "",
  yourName: "",
  yourCompany: "",
  yourEmail: "",
  orderValue: "",
};

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

function OrderPage() {
  const { tier: initialTier } = Route.useSearch();
  const navigate = useNavigate();
  const [tier, setTier] = useState<TierId>(initialTier);
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(empty);
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitOrderFn = useServerFn(submitOrder);

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

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setDocs((cur) => {
      const out = [...cur];
      for (const file of Array.from(files)) {
        if (out.length >= MAX_FILES) break;
        const ext = file.name.toLowerCase().split(".").pop() ?? "";
        let error: string | undefined;
        if (!ALLOWED_EXTS.includes(ext) && !ALLOWED_TYPES.includes(file.type)) {
          error = "Only PDF, JPG, JPEG, PNG are accepted.";
        } else if (file.size > MAX_BYTES) {
          error = "Maximum 10 MB per file.";
        }
        out.push({ file, category: "business_licence", error });
      }
      return out;
    });
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const docPayload = await Promise.all(
        docs
          .filter((d) => !d.error)
          .map(async (d) => ({
            filename: d.file.name,
            category: d.category,
            contentType: d.file.type || "application/octet-stream",
            fileBase64: await fileToBase64(d.file),
          })),
      );
      const result = await submitOrderFn({
        data: {
          tier_selected: tier,
          supplier_company_name: data.supplierName.trim(),
          supplier_chinese_name: data.supplierChineseName.trim(),
          supplier_country: data.country,
          destination_market: data.destinationMarket,
          website_marketplace_url: data.supplierUrl.trim(),
          supplier_contact_person: data.supplierContact.trim(),
          product_category: data.productCategory.trim(),
          product_description: data.productDescription.trim(),
          certificates_info: "",
          concerns_text: data.concerns.trim(),
          customer_name: data.yourName.trim(),
          customer_company: data.yourCompany.trim(),
          customer_email: data.yourEmail.trim(),
          estimated_order_value: data.orderValue,
          documents: docPayload,
        },
      });
      navigate({ to: "/order/status/$token", params: { token: result.statusToken } });
    } catch (e) {
      console.error(e);
      setSubmitError(
        e instanceof Error ? e.message : "Something went wrong saving your order. Please try again.",
      );
      setIsSubmitting(false);
    }
  };

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

        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  step >= n ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"
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
                Whatever you have. Documents are optional — you can order without them.
              </p>

              <div className="mt-8 space-y-5">
                <Field label="Supplier company name" required>
                  <Input
                    value={data.supplierName}
                    onChange={(e) => update("supplierName")(e.target.value)}
                    placeholder="e.g. Ningbo Brightway Industry & Trade Co., Ltd."
                  />
                </Field>

                <Field label="Supplier Chinese or Vietnamese legal name" hint="Optional — if known">
                  <Input
                    value={data.supplierChineseName}
                    onChange={(e) => update("supplierChineseName")(e.target.value)}
                    placeholder="e.g. Ningbo Brightway Industry & Trade Co., Ltd."
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Supplier country" required>
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

                <Field label="Exact product / model / material" hint="Optional but helpful">
                  <Textarea
                    rows={3}
                    value={data.productDescription}
                    onChange={(e) => update("productDescription")(e.target.value)}
                    placeholder="e.g. 304 stainless steel mixing bowls, 24 cm, model BX-240"
                  />
                </Field>

                <Field label="Customer concerns" hint="Optional">
                  <Textarea
                    rows={3}
                    value={data.concerns}
                    onChange={(e) => update("concerns")(e.target.value)}
                    placeholder="e.g. asking for 50% deposit, factory address looks suspicious..."
                  />
                </Field>

                <div>
                  <Label className="mb-2 block text-sm font-medium">
                    Supporting documents{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      — Optional. Max {MAX_FILES} files, 10 MB each. PDF, JPG or PNG.
                    </span>
                  </Label>

                  {docs.length < MAX_FILES && (
                    <label
                      htmlFor="doc-upload"
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground hover:border-navy/40 hover:bg-muted/50"
                    >
                      <Upload className="h-4 w-4" />
                      Add document
                      <input
                        id="doc-upload"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}

                  {docs.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {docs.map((d, idx) => (
                        <li
                          key={idx}
                          className={`flex items-center gap-3 rounded-lg border bg-card p-3 ${
                            d.error ? "border-destructive/40" : "border-border"
                          }`}
                        >
                          <FileText className="h-5 w-5 shrink-0 text-navy" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{d.file.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {(d.file.size / 1024 / 1024).toFixed(2)} MB
                              {d.error && <span className="ml-2 text-destructive">— {d.error}</span>}
                            </div>
                          </div>
                          <Select
                            value={d.category}
                            onValueChange={(v) =>
                              setDocs((cur) =>
                                cur.map((x, i) => (i === idx ? { ...x, category: v as DocCategory } : x)),
                              )
                            }
                          >
                            <SelectTrigger className="h-8 w-[180px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DOC_CATEGORIES.map((c) => (
                                <SelectItem key={c.value} value={c.value} className="text-xs">
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            type="button"
                            onClick={() => setDocs((cur) => cur.filter((_, i) => i !== idx))}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
                    <Input value={data.yourName} onChange={(e) => update("yourName")(e.target.value)} />
                  </Field>
                  <Field label="Company" required>
                    <Input value={data.yourCompany} onChange={(e) => update("yourCompany")(e.target.value)} />
                  </Field>
                </div>

                <Field label="Email" required hint="The report PDF will be sent here">
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
                      <SelectItem value="under_10k">Under EUR10K</SelectItem>
                      <SelectItem value="10_50k">EUR10K - EUR50K</SelectItem>
                      <SelectItem value="50_150k">EUR50K - EUR150K</SelectItem>
                      <SelectItem value="150_500k">EUR150K - EUR500K</SelectItem>
                      <SelectItem value="over_500k">Over EUR500K</SelectItem>
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
              <h2 className="text-2xl font-bold text-navy">Review & payment setup</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Confirm your verification tier. The investigation will only start after Stripe confirms payment server-side.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {(Object.keys(TIERS) as TierId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTier(id)}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      tier === id ? "border-navy bg-navy/5 ring-2 ring-navy" : "border-border hover:border-navy/40"
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {TIERS[id].name}
                    </div>
                    <div className="mt-1 text-xl font-bold text-navy">EUR{TIERS[id].price}</div>
                    <div className="text-xs text-muted-foreground">{TIERS[id].delivery}</div>
                  </button>
                ))}
              </div>

              <div className="mt-8 rounded-lg border border-border bg-muted/40 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Order summary</h3>
                <dl className="mt-3 space-y-2 text-sm">
                  <SummaryRow label="Supplier" value={data.supplierName} />
                  <SummaryRow label="Country" value={data.country} />
                  <SummaryRow label="Product" value={data.productCategory} />
                  <SummaryRow label="Documents" value={`${docs.filter((d) => !d.error).length} attached`} />
                  <SummaryRow label="Delivery to" value={data.yourEmail} />
                  <SummaryRow label="Tier" value={tierInfo.name} />
                </dl>
                <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
                  <span className="text-sm font-semibold text-foreground">Total</span>
                  <span className="text-2xl font-bold text-navy">EUR{tierInfo.price}</span>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-4 text-xs leading-relaxed text-foreground">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                <span>
                  <strong>Payment is verified by Stripe on the server.</strong> Submitting this form creates a pending order only.
                  No investigation job can start until VerifyFirst receives a valid Stripe webhook for this order.
                </span>
              </div>

              {submitError && (
                <div className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
                  {submitError}
                </div>
              )}

              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(2)} disabled={isSubmitting}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="bg-success text-success-foreground hover:bg-success/90"
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {isSubmitting ? "Creating pending order..." : `Create pending order - EUR${tierInfo.price}`}
                </Button>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need help? <Link to="/" className="underline">Contact us</Link>
        </p>
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
