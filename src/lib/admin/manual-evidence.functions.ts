import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CANONICAL_CHECKLIST, type ChecklistId } from "@/lib/investigation/checklist";
import { MANUAL_SOURCE, confidenceForManualClassification } from "@/lib/investigation/sources/manual-evidence.server";
import type { EvidenceClassification } from "@/lib/investigation/types";

const CLASSIFICATIONS = [
  "VERIFIED",
  "CORROBORATED",
  "SUPPLIER_CLAIMED",
  "INFERRED",
  "NOT_INDEPENDENTLY_VERIFIED",
  "CONTRADICTED",
] as const;

const AttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  fileBase64: z.string().min(1),
});

async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error("Role lookup failed");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("analyst")) {
    throw new Error("Forbidden: staff role required");
  }
}

async function logActivity(
  supabase: any,
  caseId: string,
  actorId: string,
  action: string,
  payload?: any,
) {
  await supabase.from("case_activity_log").insert({
    case_id: caseId,
    actor_id: actorId,
    action,
    payload: payload ?? null,
  });
}

function checklistDef(checklistId: string) {
  return CANONICAL_CHECKLIST.find((item) => item.id === checklistId);
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function decodeBase64(input: string) {
  const clean = input.includes(",") ? input.split(",").pop() || "" : input;
  return Buffer.from(clean, "base64");
}

async function uploadAttachments(args: {
  caseId: string;
  checklistId: ChecklistId;
  evidenceId: string;
  attachments: z.infer<typeof AttachmentSchema>[];
}) {
  if (args.attachments.length === 0) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg"]);
  const paths: string[] = [];

  for (const file of args.attachments) {
    if (!allowed.has(file.contentType)) {
      throw new Error("Manual evidence attachments must be PDF, PNG or JPG files.");
    }
    const bytes = decodeBase64(file.fileBase64);
    if (bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error("Manual evidence attachments must be 25MB or smaller.");
    }
    const path = `manual-evidence/${args.caseId}/${args.evidenceId}/${Date.now()}-${safeFilename(file.filename)}`;
    const { error } = await (supabaseAdmin as any).storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.contentType, upsert: true });
    if (error) throw new Error(`Could not store manual evidence attachment: ${error.message}`);
    paths.push(path);
  }

  return paths;
}

async function rerunCaseInvestigation(caseId: string, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { createTestInvestigationJobForOrder } = await import("@/lib/investigation/job-queue.server");
  const { runInvestigationWorkerOnce } = await import("@/lib/investigation/worker.server");
  const db = supabaseAdmin as any;

  const { data: order, error } = await db
    .from("orders")
    .select("id")
    .eq("case_id", caseId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load order for rerun: ${error.message}`);
  if (!order?.id) throw new Error("Cannot rerun investigation because no order is attached to this case.");

  const job = await createTestInvestigationJobForOrder({ orderId: order.id, caseId, reason });
  const worker = await runInvestigationWorkerOnce(`manual-evidence-${crypto.randomUUID()}`, { deliver: false, allowRerun: true });

  const { data: latestReport } = await db
    .from("report_versions")
    .select("id, version_number, final_outcome, overall_risk_rating, pdf_storage_path, snapshot")
    .eq("case_id", caseId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { job, worker, latestReport: latestReport ?? null };
}

export const listManualEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any)
      .from("evidence_facts")
      .select("id, case_id, checklist_id, fact_value, classification, confidence, retrieval_date, evidence_excerpt, source_citation, attachment_paths, created_at, retracted_at, retraction_reason")
      .eq("case_id", data.caseId)
      .eq("source_name", MANUAL_SOURCE)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addManualEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    caseId: z.string().uuid(),
    checklistId: z.string(),
    findingText: z.string().min(1),
    classification: z.enum(CLASSIFICATIONS),
    citation: z.string().min(1),
    attachments: z.array(AttachmentSchema).max(5).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const def = checklistDef(data.checklistId);
    if (!def) throw new Error("Unknown VerifyFirst checklist item.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const classification = data.classification as EvidenceClassification;
    const { data: inserted, error } = await (supabaseAdmin as any)
      .from("evidence_facts")
      .insert({
        case_id: data.caseId,
        checklist_id: def.id,
        finding_key: def.id,
        fact_key: def.id,
        fact_value: { finding_text: data.findingText, citation: data.citation },
        classification,
        confidence: confidenceForManualClassification(classification),
        source_name: MANUAL_SOURCE,
        source_url: null,
        retrieval_date: now,
        evidence_excerpt: data.findingText,
        source_citation: data.citation,
        attachment_paths: [],
        manual_entry_created_by: userId,
        license_notes: "Manual analyst entry",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Could not save manual evidence: ${error?.message ?? "unknown"}`);

    const attachmentPaths = await uploadAttachments({
      caseId: data.caseId,
      checklistId: def.id,
      evidenceId: inserted.id,
      attachments: data.attachments ?? [],
    });
    if (attachmentPaths.length > 0) {
      await (supabaseAdmin as any)
        .from("evidence_facts")
        .update({ attachment_paths: attachmentPaths, fact_value: { finding_text: data.findingText, citation: data.citation, attachments: attachmentPaths } })
        .eq("id", inserted.id);
    }

    await logActivity(supabase, data.caseId, userId, "manual_evidence_added", { checklist_id: def.id, evidence_fact_id: inserted.id });
    const rerun = await rerunCaseInvestigation(data.caseId, `manual evidence added for ${def.id}`);
    return { ok: true, evidenceFactId: inserted.id, attachmentPaths, rerun };
  });

export const updateManualEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    evidenceFactId: z.string().uuid(),
    findingText: z.string().min(1),
    classification: z.enum(CLASSIFICATIONS),
    citation: z.string().min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before, error: beforeErr } = await (supabaseAdmin as any)
      .from("evidence_facts")
      .select("id, case_id, checklist_id, source_name, retracted_at")
      .eq("id", data.evidenceFactId)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before || before.source_name !== MANUAL_SOURCE) throw new Error("Manual evidence entry not found.");
    if (before.retracted_at) throw new Error("Retracted manual evidence cannot be edited.");

    const classification = data.classification as EvidenceClassification;
    const { error } = await (supabaseAdmin as any)
      .from("evidence_facts")
      .update({
        fact_value: { finding_text: data.findingText, citation: data.citation },
        classification,
        confidence: confidenceForManualClassification(classification),
        evidence_excerpt: data.findingText,
        source_citation: data.citation,
        retrieval_date: new Date().toISOString(),
      })
      .eq("id", data.evidenceFactId);
    if (error) throw new Error(error.message);

    await logActivity(supabase, before.case_id, userId, "manual_evidence_updated", { checklist_id: before.checklist_id, evidence_fact_id: before.id });
    const rerun = await rerunCaseInvestigation(before.case_id, `manual evidence updated for ${before.checklist_id}`);
    return { ok: true, rerun };
  });

export const retractManualEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ evidenceFactId: z.string().uuid(), reason: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before, error: beforeErr } = await (supabaseAdmin as any)
      .from("evidence_facts")
      .select("id, case_id, checklist_id, source_name, retracted_at")
      .eq("id", data.evidenceFactId)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before || before.source_name !== MANUAL_SOURCE) throw new Error("Manual evidence entry not found.");
    if (before.retracted_at) return { ok: true, alreadyRetracted: true };

    const { error } = await (supabaseAdmin as any)
      .from("evidence_facts")
      .update({
        retracted_at: new Date().toISOString(),
        retracted_by: userId,
        retraction_reason: data.reason ?? null,
      })
      .eq("id", data.evidenceFactId);
    if (error) throw new Error(error.message);

    await logActivity(supabase, before.case_id, userId, "manual_evidence_retracted", { checklist_id: before.checklist_id, evidence_fact_id: before.id, reason: data.reason ?? null });
    const rerun = await rerunCaseInvestigation(before.case_id, `manual evidence retracted for ${before.checklist_id}`);
    return { ok: true, rerun };
  });
