// Public server functions backing the status page and the signed report
// view. Both are public (no auth) because customers don't have accounts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { InvestigationReport } from "./types";

const tokenInput = z.object({ token: z.string().min(10).max(128) });

export const getOrderStatusByToken = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin
      .from("supplier_cases")
      .select(
        `id, case_reference, status, investigation_error, package,
         orders(order_reference, supplier_company_name, customer_email)`,
      )
      .eq("upload_token", data.token)
      .maybeSingle();
    if (!c) throw new Error("This link is invalid or has expired.");
    const order = Array.isArray(c.orders) ? c.orders[0] : (c.orders as any);

    // Latest activity for stage display
    const { data: activity } = await supabaseAdmin
      .from("case_activity_log")
      .select("action, payload, created_at")
      .eq("case_id", c.id)
      .order("created_at", { ascending: true });

    // If the case is delivered, expose the share token to redirect
    let shareToken: string | null = null;
    if (c.status === "delivered" || c.status === "report_ready") {
      const { data: rv } = await supabaseAdmin
        .from("report_versions")
        .select("share_token")
        .eq("case_id", c.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      shareToken = (rv?.share_token as string) ?? null;
    }

    // Keep signed case metadata available for legacy status-page display only.
    const { signCaseId } = await import("@/lib/investigation/hmac.server");
    const signature = await signCaseId(c.id as string);

    return {
      caseId: c.id as string,
      caseReference: c.case_reference as string,
      orderReference: order?.order_reference ?? "",
      supplierName: order?.supplier_company_name ?? "",
      customerEmail: order?.customer_email ?? "",
      status: c.status as string,
      package: c.package as string | null,
      error: (c.investigation_error as string) ?? null,
      shareToken,
      signature,
      activity: (activity ?? []).map((a: any) => ({
        action: a.action as string,
        payload: JSON.stringify(a.payload ?? null),
        created_at: a.created_at as string,
      })),
    };
  });

function isVerifiedReportPackage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => isVerifiedReportPackage(item));
  if (value && typeof value === "object" && "package" in value) return (value as any).package === "verified_report";
  return value === "verified_report";
}

export async function getReportByShareTokenImpl(args: {
  shareToken: string;
  db: any;
}): Promise<{ reportJson: string; pdfUrl: string | null; finalised_at: string | null }> {
  const { data: rv } = await args.db
      .from("report_versions")
      .select("id, case_id, snapshot, pdf_storage_path, finalised_at, supplier_cases(package)")
      .eq("share_token", args.shareToken)
      .maybeSingle();
  if (!rv) throw new Error("This report link is invalid or has expired.");

  const snapshot = (rv.snapshot ?? null) as InvestigationReport | null;
  const forceVerifiedReport = isVerifiedReportPackage((rv as any).supplier_cases);
  let pdfPath = (rv.pdf_storage_path as string | null) ?? null;

  if (snapshot && (forceVerifiedReport || snapshot.verified_report_decision || (snapshot.customer_evidence ?? []).length > 0)) {
    const { renderReportPdf } = await import("./pdf.server");
    const pdfBytes = await renderReportPdf(snapshot, { forceVerifiedReport });
    pdfPath = pdfPath || `cases/${rv.case_id ?? "shared"}/${rv.id}.pdf`;
    const { error: upErr } = await args.db.storage
      .from("reports")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error("Could not refresh customer PDF: " + upErr.message);
    if (pdfPath !== rv.pdf_storage_path) {
      await args.db.from("report_versions").update({ pdf_storage_path: pdfPath }).eq("id", rv.id);
    }
  }

  let pdfUrl: string | null = null;
  if (pdfPath) {
    const { data: signed } = await args.db.storage
      .from("reports")
      .createSignedUrl(pdfPath, 60 * 60 * 24);
    pdfUrl = signed?.signedUrl ?? null;
  }
  return {
    reportJson: JSON.stringify(snapshot),
    pdfUrl,
    finalised_at: rv.finalised_at as string | null,
  };
}

export const getReportByShareToken = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ shareToken: z.string().min(20).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getReportByShareTokenImpl({ shareToken: data.shareToken, db: supabaseAdmin });
  });
