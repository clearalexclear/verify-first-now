import {
  claimNextInvestigationJob,
  markJobFailed,
  markJobSucceeded,
  runStep,
  type InvestigationStepKey,
} from "./job-queue.server";
import { runInvestigation } from "./pipeline.server";

type WorkerJob = {
  id: string;
  order_id: string;
  case_id: string;
  attempt_count: number;
  max_attempts: number;
};

export async function runInvestigationWorkerOnce(
  workerId = `worker-${crypto.randomUUID()}`,
  opts: { deliver?: boolean; allowRerun?: boolean } = {},
) {
  const job = await claimNextInvestigationJob(workerId);
  if (!job) return { claimed: false, status: "idle" as const, error: null };
  return processInvestigationJob(job, opts);
}

export async function runInvestigationJobById(
  jobId: string,
  workerId = `worker-${crypto.randomUUID()}`,
  opts: { deliver?: boolean; allowRerun?: boolean } = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();
  const { data: job, error } = await db
    .from("investigation_jobs")
    .update({
      status: "running",
      locked_at: now,
      locked_by: workerId,
      started_at: now,
      attempt_count: 1,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id, order_id, case_id, attempt_count, max_attempts")
    .maybeSingle();
  if (error) throw new Error(`Could not claim investigation job ${jobId}: ${error.message}`);
  if (!job) return { claimed: false, jobId, status: "idle" as const, error: null };
  return processInvestigationJob(job, opts);
}

async function processInvestigationJob(
  job: WorkerJob,
  opts: { deliver?: boolean; allowRerun?: boolean } = {},
) {
  try {
    await runStep({
      jobId: job.id,
      caseId: job.case_id,
      stepKey: "document_extraction",
      fn: async () => ({ delegated_to_pipeline: true }),
    });
    await runStep({
      jobId: job.id,
      caseId: job.case_id,
      stepKey: "entity_resolution",
      fn: async () => ({ delegated_to_pipeline: true }),
    });
    await runStep({
      jobId: job.id,
      caseId: job.case_id,
      stepKey: "connector_retrieval",
      fn: async () => ({ delegated_to_pipeline: true }),
    });
    await runStep({
      jobId: job.id,
      caseId: job.case_id,
      stepKey: "evidence_analysis",
      fn: async () => ({ delegated_to_pipeline: true }),
    });
    await runStep({
      jobId: job.id,
      caseId: job.case_id,
      stepKey: "report_generation",
      fn: async () => {
        const result = await runInvestigation(job.case_id, {
          jobId: job.id,
          deliver: opts.deliver ?? true,
          allowRerun: opts.allowRerun ?? false,
        });
        if (!result.ok) throw new Error(result.error);
        return result;
      },
    });
    await markJobSucceeded(job.id);
    return { claimed: true, jobId: job.id, status: "succeeded" as const };
  } catch (error) {
    await markJobFailed(job, error);
    return {
      claimed: true,
      jobId: job.id,
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function markStepSkipped(jobId: string, caseId: string, stepKey: InvestigationStepKey, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await (supabaseAdmin as any)
    .from("investigation_steps")
    .update({
      status: "skipped",
      completed_at: new Date().toISOString(),
      output: { reason },
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("case_id", caseId)
    .eq("step_key", stepKey);
}
