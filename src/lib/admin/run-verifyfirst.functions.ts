// Temporary admin-only diagnostic action: runs the VerifyFirst investigation
// pipeline end-to-end against the existing Jiangmen Changwen order without
// emailing the customer. Admin role is required; there is no public route.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FOUNDATION_TABLES = [
  "investigation_jobs",
  "investigation_steps",
  "connectors",
  "connector_runs",
  "evidence_facts",
  "report_artifacts",
  "source_snapshots",
  "webhook_events",
] as const;

const REPORTS_BUCKET = "reports";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error("Role lookup failed");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin role required");
}

export const runVerifyFirstJiangmen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        reason: z.string().max(200).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // 1. Validate foundation tables exist
    const tableCheck: Record<string, boolean> = {};
    for (const t of FOUNDATION_TABLES) {
      const { error } = await db.from(t).select("*", { count: "exact", head: true }).limit(1);
      tableCheck[t] = !error;
    }
    const missingTables = Object.entries(tableCheck).filter(([, ok]) => !ok).map(([n]) => n);
    if (missingTables.length) {
      throw new Error(`Missing investigation foundation tables: ${missingTables.join(", ")}`);
    }

    // 2. Confirm reports bucket exists
    const { data: buckets, error: bucketErr } = await db.storage.listBuckets();
    if (bucketErr) throw new Error(`Could not list buckets: ${bucketErr.message}`);
    const reportsBucket = (buckets ?? []).find((b: any) => b.name === REPORTS_BUCKET);
    if (!reportsBucket) throw new Error(`Storage bucket "${REPORTS_BUCKET}" does not exist`);

    // 3. Refresh DHS UFLPA snapshot
    const { refreshUflpaSnapshot } = await import("@/lib/investigation/sources/uflpa.server");
    let uflpa: { snapshotVersion: string; checksum: string; entityCount: number } | { error: string };
    try {
      uflpa = await refreshUflpaSnapshot();
    } catch (e) {
      uflpa = { error: e instanceof Error ? e.message : String(e) };
    }

    // 4. Find the Jiangmen Changwen order and case
    const { data: order, error: orderErr } = await db
      .from("orders")
      .select("id, case_id, order_reference, supplier_company_name")
      .ilike("supplier_company_name", "%Jiangmen Changwen%")
      .maybeSingle();
    if (orderErr || !order?.id || !order.case_id) {
      throw new Error("Could not find the Jiangmen Changwen order/case: " + (orderErr?.message ?? "not found"));
    }

    // 5. Enqueue a test job + run one worker cycle with delivery disabled
    process.env.VERIFYFIRST_ENABLE_TEST_INVESTIGATION = "true";
    process.env.VERIFYFIRST_ALLOW_PRODUCTION_TEST_INVESTIGATION = "true";
    const { runTestInvestigation } = await import("@/lib/investigation/test-runner.server");
    const runResult = await runTestInvestigation({
      orderId: order.id as string,
      caseId: order.case_id as string,
      reason: data.reason ?? "Admin diagnostic run (email delivery disabled)",
    });

    // 6. Load the latest report
    const { data: rv, error: rvErr } = await db
      .from("report_versions")
      .select("id, share_token, pdf_storage_path, snapshot, finalised_at")
      .eq("case_id", order.case_id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rvErr || !rv) {
      // Gather full diagnostic detail so the failure is actionable.
      const { data: caseRow } = await db
        .from("supplier_cases")
        .select("status, investigation_error, investigation_started_at, investigation_completed_at")
        .eq("id", order.case_id)
        .maybeSingle();
      const { data: jobRow } = await db
        .from("investigation_jobs")
        .select("id, status, attempt_count, max_attempts, last_error, next_run_at, created_at, completed_at, metadata")
        .eq("id", runResult.jobId)
        .maybeSingle();
      const { data: steps } = await db
        .from("investigation_steps")
        .select("step_key, status, attempt_count, max_attempts, last_error, started_at, completed_at")
        .eq("job_id", runResult.jobId)
        .order("step_key", { ascending: true });

      const worker: any = runResult.worker ?? {};
      const pipelineError =
        (steps ?? []).find((s: any) => s.step_key === "report_generation")?.last_error ??
        jobRow?.last_error ??
        caseRow?.investigation_error ??
        worker?.error ??
        null;

      return {
        ok: false as const,
        caseId: order.case_id as string,
        orderId: order.id as string,
        orderReference: order.order_reference as string | null,
        supplierName: order.supplier_company_name as string | null,
        tableCheck,
        reportsBucket: { name: REPORTS_BUCKET, exists: true },
        uflpa,
        supplierCase: caseRow ?? null,
        job: jobRow
          ? {
              id: jobRow.id,
              status: jobRow.status,
              attemptCount: jobRow.attempt_count,
              maxAttempts: jobRow.max_attempts,
              lastError: jobRow.last_error,
              nextRunAt: jobRow.next_run_at,
              createdAt: jobRow.created_at,
              completedAt: jobRow.completed_at,
              metadata: jobRow.metadata,
              created: runResult.jobCreated,
            }
          : { id: runResult.jobId, created: runResult.jobCreated, status: "unknown" },
        steps: steps ?? [],
        worker,
        pipelineError,
        error: "No report version was produced",
      };
    }


    const snapshot: any = rv.snapshot ?? {};
    const checklist: any[] = Array.isArray(snapshot.checklist_results) ? snapshot.checklist_results : [];
    const findings: any[] = Array.isArray(snapshot.findings) ? snapshot.findings : [];
    const jsonStoragePath = `cases/${order.case_id}/${rv.id}.json`;

    // 7. Count checklist statuses and findings statuses
    const checklistStatusCounts: Record<string, number> = {};
    for (const c of checklist) {
      const k = String(c.status ?? "UNKNOWN");
      checklistStatusCounts[k] = (checklistStatusCounts[k] ?? 0) + 1;
    }
    const findingStatusCounts: Record<string, number> = {};
    for (const f of findings) {
      const k = String(f.status ?? "UNKNOWN");
      findingStatusCounts[k] = (findingStatusCounts[k] ?? 0) + 1;
    }

    return {
      ok: true as const,
      caseId: order.case_id as string,
      orderId: order.id as string,
      orderReference: order.order_reference as string | null,
      supplierName: order.supplier_company_name as string | null,
      tableCheck,
      reportsBucket: { name: REPORTS_BUCKET, exists: true },
      uflpa,
      job: { id: runResult.jobId, created: runResult.jobCreated },
      worker: runResult.worker,
      report: {
        versionId: rv.id as string,
        shareToken: rv.share_token as string,
        pdfStoragePath: rv.pdf_storage_path as string | null,
        jsonStoragePath,
        finalisedAt: rv.finalised_at as string | null,
        finalOutcome: snapshot.final_outcome as string | null,
        overallRiskRating: snapshot.overall_risk_rating as string | null,
      },
      checklistCount: checklist.length,
      checklistExactly32: checklist.length === 32,
      checklistStatusCounts,
      findingsCount: findings.length,
      findingStatusCounts,
    };
  });
