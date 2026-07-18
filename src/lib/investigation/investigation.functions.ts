// Public server functions backing the status page and the signed report
// view. Both are public (no auth) because customers don't have accounts.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

export const getReportByShareToken = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ shareToken: z.string().min(20).max(128) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rv } = await supabaseAdmin
      .from("report_versions")
      .select("id, snapshot, pdf_storage_path, finalised_at")
      .eq("share_token", data.shareToken)
      .maybeSingle();
    if (!rv) throw new Error("This report link is invalid or has expired.");
    let pdfUrl: string | null = null;
    if (rv.pdf_storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from("reports")
        .createSignedUrl(rv.pdf_storage_path as string, 60 * 60 * 24);
      pdfUrl = signed?.signedUrl ?? null;
    }
    return {
      reportJson: JSON.stringify(rv.snapshot ?? null),
      pdfUrl,
      finalised_at: rv.finalised_at as string | null,
    };
  });
