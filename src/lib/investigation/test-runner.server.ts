import { createTestInvestigationJobForOrder } from "./job-queue.server";
import { runInvestigationWorkerOnce } from "./worker.server";

export function assertTestInvestigationEnabled(env = process.env) {
  if (env.VERIFYFIRST_ENABLE_TEST_INVESTIGATION !== "true") {
    throw new Error("Test investigation trigger is disabled. Set VERIFYFIRST_ENABLE_TEST_INVESTIGATION=true.");
  }
  if (env.NODE_ENV === "production" && env.VERIFYFIRST_ALLOW_PRODUCTION_TEST_INVESTIGATION !== "true") {
    throw new Error(
      "Production test investigation trigger is disabled. Set VERIFYFIRST_ALLOW_PRODUCTION_TEST_INVESTIGATION=true only for a controlled manual run.",
    );
  }
}

export async function resolveOrderAndCase(args: { orderId?: string; caseId?: string }) {
  if (!args.orderId && !args.caseId) throw new Error("Provide either --order-id or --case-id.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  if (args.orderId) {
    const { data, error } = await db
      .from("orders")
      .select("id, case_id, order_reference, supplier_company_name, customer_email")
      .eq("id", args.orderId)
      .maybeSingle();
    if (error || !data?.case_id) throw new Error(error?.message ?? `No order/case found for order ${args.orderId}`);
    return {
      orderId: data.id as string,
      caseId: data.case_id as string,
      orderReference: data.order_reference as string | null,
      supplierName: data.supplier_company_name as string | null,
      customerEmail: data.customer_email as string | null,
    };
  }

  const { data, error } = await db
    .from("supplier_cases")
    .select("id, case_reference, orders(id, order_reference, supplier_company_name, customer_email)")
    .eq("id", args.caseId)
    .maybeSingle();
  const order = Array.isArray(data?.orders) ? data.orders[0] : data?.orders;
  if (error || !data?.id || !order?.id) throw new Error(error?.message ?? `No order found for case ${args.caseId}`);
  return {
    orderId: order.id as string,
    caseId: data.id as string,
    orderReference: order.order_reference as string | null,
    supplierName: order.supplier_company_name as string | null,
    customerEmail: order.customer_email as string | null,
  };
}

export async function runTestInvestigation(args: { orderId?: string; caseId?: string; reason?: string }) {
  assertTestInvestigationEnabled();
  const resolved = await resolveOrderAndCase(args);
  const job = await createTestInvestigationJobForOrder({
    orderId: resolved.orderId,
    caseId: resolved.caseId,
    reason: args.reason ?? "manual test investigation",
  });
  const worker = await runInvestigationWorkerOnce(`test-investigation-${crypto.randomUUID()}`, {
    deliver: false,
    allowRerun: true,
  });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: report } = await (supabaseAdmin as any)
    .from("report_versions")
    .select("id, share_token, pdf_storage_path, snapshot, finalised_at")
    .eq("case_id", resolved.caseId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ...resolved,
    jobId: job.jobId,
    jobCreated: job.created,
    worker,
    report: report
      ? {
          id: report.id as string,
          shareToken: report.share_token as string,
          pdfStoragePath: report.pdf_storage_path as string | null,
          finalisedAt: report.finalised_at as string | null,
          findingCount: Array.isArray(report.snapshot?.findings) ? report.snapshot.findings.length : 0,
          finalOutcome: report.snapshot?.final_outcome ?? null,
          overallRiskRating: report.snapshot?.overall_risk_rating ?? null,
        }
      : null,
  };
}
