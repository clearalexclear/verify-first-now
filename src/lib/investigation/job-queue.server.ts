export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export const INVESTIGATION_STEPS = [
  "document_extraction",
  "entity_resolution",
  "connector_retrieval",
  "evidence_analysis",
  "report_generation",
] as const;

export type InvestigationStepKey = (typeof INVESTIGATION_STEPS)[number];

const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export function nextBackoff(attemptCount: number, now = Date.now()): string {
  const exponent = Math.max(0, attemptCount - 1);
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** exponent);
  return new Date(now + delay).toISOString();
}

export function jobIdempotencyKey(orderId: string): string {
  return `stripe-paid:${orderId}`;
}

export async function createInvestigationJobForOrder(args: {
  orderId: string;
  caseId: string;
  sourceEventId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const idempotencyKey = jobIdempotencyKey(args.orderId);

  const { data: existing } = await db
    .from("investigation_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) return { jobId: existing.id as string, created: false };

  const { data: job, error } = await db
    .from("investigation_jobs")
    .insert({
      order_id: args.orderId,
      case_id: args.caseId,
      idempotency_key: idempotencyKey,
      status: "queued",
      metadata: { source_event_id: args.sourceEventId ?? null },
    })
    .select("id")
    .single();

  if (error || !job) throw new Error(`Could not create investigation job: ${error?.message ?? "unknown"}`);

  for (const stepKey of INVESTIGATION_STEPS) {
    await db.from("investigation_steps").insert({
      job_id: job.id,
      case_id: args.caseId,
      step_key: stepKey,
      status: "pending",
    });
  }

  await db.from("supplier_cases").update({ status: "investigation_queued" }).eq("id", args.caseId);
  await db.from("case_activity_log").insert({
    case_id: args.caseId,
    action: "status_changed",
    payload: { to: "investigation_queued", job_id: job.id } as any,
  });

  return { jobId: job.id as string, created: true };
}

export async function claimNextInvestigationJob(workerId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();

  const { data: candidates, error } = await db
    .from("investigation_jobs")
    .select("id, order_id, case_id, attempt_count, max_attempts")
    .eq("status", "queued")
    .lte("next_run_at", now)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) throw new Error(`Could not list queued jobs: ${error.message}`);

  for (const candidate of candidates ?? []) {
    const { data: claimed } = await db
      .from("investigation_jobs")
      .update({
        status: "running",
        locked_at: now,
        locked_by: workerId,
        started_at: now,
        attempt_count: Number(candidate.attempt_count ?? 0) + 1,
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("id, order_id, case_id, attempt_count, max_attempts")
      .maybeSingle();

    if (claimed) return claimed;
  }

  return null;
}

export async function markJobSucceeded(jobId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await (supabaseAdmin as any)
    .from("investigation_jobs")
    .update({
      status: "succeeded",
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function markJobFailed(job: { id: string; attempt_count: number; max_attempts: number }, error: unknown) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = Number(job.attempt_count ?? 0) >= Number(job.max_attempts ?? 5);

  await db
    .from("investigation_jobs")
    .update({
      status: exhausted ? "dead" : "queued",
      locked_at: null,
      locked_by: null,
      next_run_at: exhausted ? new Date().toISOString() : nextBackoff(Number(job.attempt_count ?? 1)),
      last_error: message,
      completed_at: exhausted ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

export async function runStep<T>(args: {
  jobId: string;
  caseId: string;
  stepKey: InvestigationStepKey;
  fn: () => Promise<T>;
}): Promise<T | undefined> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { data: existing } = await db
    .from("investigation_steps")
    .select("id, status, attempt_count, max_attempts")
    .eq("job_id", args.jobId)
    .eq("step_key", args.stepKey)
    .maybeSingle();

  if (existing?.status === "succeeded") return undefined;

  const stepId = existing?.id;
  if (!stepId) throw new Error(`Missing investigation step row: ${args.stepKey}`);

  await db
    .from("investigation_steps")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempt_count: Number(existing.attempt_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stepId);

  try {
    const output = await args.fn();
    await db
      .from("investigation_steps")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        output: output === undefined ? null : output,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", stepId);
    return output;
  } catch (error) {
    const attempt = Number(existing.attempt_count ?? 0) + 1;
    const maxAttempts = Number(existing.max_attempts ?? 3);
    await db
      .from("investigation_steps")
      .update({
        status: attempt >= maxAttempts ? "failed" : "pending",
        next_run_at: nextBackoff(attempt),
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", stepId);
    throw error;
  }
}
