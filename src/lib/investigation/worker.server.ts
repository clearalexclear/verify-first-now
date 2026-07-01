import {
  claimNextInvestigationJob,
  markJobFailed,
  markJobSucceeded,
  runStep,
  type InvestigationStepKey,
} from "./job-queue.server";
import { runInvestigation } from "./pipeline.server";

export async function runInvestigationWorkerOnce(
  workerId = `worker-${crypto.randomUUID()}`,
  opts: { deliver?: boolean; allowRerun?: boolean } = {},
) {
  const job = await claimNextInvestigationJob(workerId);
  if (!job) return { claimed: false };

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
      fn: async () =>
        runInvestigation(job.case_id, {
          jobId: job.id,
          deliver: opts.deliver ?? true,
          allowRerun: opts.allowRerun ?? false,
        }),
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
