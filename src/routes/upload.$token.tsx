import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUploadCase, uploadCaseDocument, type DocCategory } from "@/lib/upload.functions";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, FileText, Lock, Upload, Loader2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/upload/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Upload supporting documents — VerifyFirst" }, { name: "robots", content: "noindex" }] }),
  component: UploadPage,
});

const CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: "business_licence", label: "Business licence" },
  { value: "quotation", label: "Quotation" },
  { value: "pro_forma_invoice", label: "Pro forma invoice" },
  { value: "contract", label: "Contract" },
  { value: "payment_instructions", label: "Payment / bank instructions" },
  { value: "certificate", label: "Certificate" },
  { value: "test_report", label: "Test report" },
  { value: "product_specification", label: "Product specification" },
  { value: "factory_presentation", label: "Factory presentation" },
  { value: "other", label: "Other" },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function UploadPage() {
  const { token } = Route.useParams();
  const getCase = useServerFn(getUploadCase);
  const upload = useServerFn(uploadCaseDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocCategory>("business_licence");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["upload-case", token],
    queryFn: () => getCase({ data: { token } }),
    retry: false,
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const b64 = await fileToBase64(file);
        await upload({
          data: {
            token,
            filename: file.name,
            category,
            contentType: file.type || "application/octet-stream",
            fileBase64: b64,
          },
        });
        setLastUploaded(file.name);
      }
      await q.refetch();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-10">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Secure upload — no account required
          </div>
          <h1 className="mt-3 text-2xl font-bold text-navy sm:text-3xl">Upload supporting documents</h1>

          {q.isLoading && (
            <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your case…
            </div>
          )}

          {q.isError && (
            <div className="mt-6 rounded-md border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
              This upload link is invalid or has expired. If you believe this is a mistake, please reply to your VerifyFirst confirmation email.
            </div>
          )}

          {q.data && (
            <>
              <div className="mt-4 rounded-md border border-border bg-muted/40 p-4 text-sm">
                <div className="text-muted-foreground">Order reference</div>
                <div className="font-mono font-semibold text-foreground">{q.data.caseReference}</div>
                {q.data.supplierName && (
                  <div className="mt-2 text-muted-foreground">
                    Supplier: <span className="text-foreground">{q.data.supplierName}</span>
                  </div>
                )}
              </div>

              <p className="mt-6 text-sm leading-relaxed text-foreground">
                Send whatever you have. Missing documents are fine — we will tell you if anything essential is required.
              </p>

              <div className="mt-8 space-y-4">
                <div>
                  <Label className="text-sm font-semibold text-navy">Document type</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as DocCategory)}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                    disabled={uploading}
                  />
                  <Button
                    type="button"
                    size="lg"
                    className="w-full bg-navy text-navy-foreground hover:bg-navy/90"
                    disabled={uploading}
                    onClick={() => inputRef.current?.click()}
                  >
                    {uploading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
                    ) : (
                      <><Upload className="mr-2 h-4 w-4" /> Choose files to upload</>
                    )}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    PDF, DOCX, XLSX, JPG, PNG — up to 25 MB each. You can upload multiple files.
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                  </div>
                )}
                {lastUploaded && !error && (
                  <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
                    <Check className="h-4 w-4" /> Uploaded: {lastUploaded}
                  </div>
                )}
              </div>

              <div className="mt-10">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Uploaded so far ({q.data.documents.length})
                </h2>
                {q.data.documents.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No documents uploaded yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                    {q.data.documents.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{d.filename}</span>
                        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {CATEGORY_LABEL[d.category ?? ""] ?? d.category ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
                You can come back to this page at any time using the same link in your confirmation email.
                We will email you directly if clarification is required.
              </p>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
