import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  classificationForOfficialRegistry,
  officialRegistryFieldsToFindings,
  OFFICIAL_BROWSER_ASSISTED_PROVIDER,
  OFFICIAL_BROWSER_ASSISTED_SOURCE,
  OFFICIAL_REGISTRY_CHECKS,
  type OfficialRegistryFields,
} from "@/lib/investigation/sources/official-browser-assisted.server";

const AttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  fileBase64: z.string().min(1),
});

const OfficialRegistryInput = z.object({
  caseId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  sourceName: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
  retrievalDate: z.string().min(1),
  citation: z.string().nullable().optional(),
  chineseLegalName: z.string().nullable().optional(),
  englishName: z.string().nullable().optional(),
  uscc: z.string().nullable().optional(),
  registrationStatus: z.string().nullable().optional(),
  incorporationDate: z.string().nullable().optional(),
  registeredCapital: z.string().nullable().optional(),
  registeredAddress: z.string().nullable().optional(),
  legalRepresentative: z.string().nullable().optional(),
  businessScope: z.string().nullable().optional(),
  shareholdersOwnership: z.string().nullable().optional(),
  relatedCompanies: z.string().nullable().optional(),
  litigationEnforcementPenalties: z.string().nullable().optional(),
  abnormalOperationRecords: z.string().nullable().optional(),
  businessLicenceMatchesOfficial: z.boolean().optional(),
  attachments: z.array(AttachmentSchema).max(5).optional(),
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

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function decodeBase64(input: string) {
  const cleanInput = input.includes(",") ? input.split(",").pop() || "" : input;
  return Buffer.from(cleanInput, "base64");
}

async function uploadAttachments(args: {
  caseId: string;
  attachments: z.infer<typeof AttachmentSchema>[];
}) {
  if (args.attachments.length === 0) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg"]);
  const paths: string[] = [];

  for (const file of args.attachments) {
    if (!allowed.has(file.contentType)) throw new Error("Official registry evidence must be PDF, PNG or JPG.");
    const bytes = decodeBase64(file.fileBase64);
    if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("Official registry evidence files must be 25MB or smaller.");
    const path = `official-registry/${args.caseId}/${Date.now()}-${safeFilename(file.filename)}`;
    const { error } = await (supabaseAdmin as any).storage
      .from("case-documents")
      .upload(path, bytes, { contentType: file.contentType, upsert: true });
    if (error) throw new Error(`Could not store official registry evidence: ${error.message}`);
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
  const worker = await runInvestigationWorkerOnce(`official-registry-${crypto.randomUUID()}`, { deliver: false, allowRerun: true });
  return { job, worker };
}

function toFields(data: z.infer<typeof OfficialRegistryInput>, attachmentPaths: string[]): OfficialRegistryFields {
  return {
    sourceName: data.sourceName,
    sourceUrl: clean(data.sourceUrl),
    retrievalDate: data.retrievalDate,
    citation: clean(data.citation),
    attachmentPaths,
    chineseLegalName: clean(data.chineseLegalName),
    englishName: clean(data.englishName),
    uscc: clean(data.uscc),
    registrationStatus: clean(data.registrationStatus),
    incorporationDate: clean(data.incorporationDate),
    registeredCapital: clean(data.registeredCapital),
    registeredAddress: clean(data.registeredAddress),
    legalRepresentative: clean(data.legalRepresentative),
    businessScope: clean(data.businessScope),
    shareholdersOwnership: clean(data.shareholdersOwnership),
    relatedCompanies: clean(data.relatedCompanies),
    litigationEnforcementPenalties: clean(data.litigationEnforcementPenalties),
    abnormalOperationRecords: clean(data.abnormalOperationRecords),
    businessLicenceMatchesOfficial: Boolean(data.businessLicenceMatchesOfficial),
  };
}

export const listOfficialRegistryTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = (supabaseAdmin as any)
      .from("official_registry_verification_tasks")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data.caseId) q = q.eq("case_id", data.caseId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveOfficialRegistryEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => OfficialRegistryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const attachmentPaths = await uploadAttachments({ caseId: data.caseId, attachments: data.attachments ?? [] });
    const fields = toFields(data, attachmentPaths);
    const findings = officialRegistryFieldsToFindings(fields);
    if (findings.length === 0) throw new Error("Enter at least one official registry finding.");
    const classification = classificationForOfficialRegistry(fields);

    const { data: run, error: runError } = await db
      .from("connector_runs")
      .insert({
        connector_id: OFFICIAL_BROWSER_ASSISTED_PROVIDER,
        case_id: data.caseId,
        status: "success",
        mode: "official_free",
        retrieved_at: fields.retrievalDate,
        confidence: classification === "VERIFIED" ? "high" : "low",
        source_url: fields.sourceUrl,
        raw_response_storage_allowed: false,
        metadata: {
          source_name: fields.sourceName,
          evidence_count: findings.length,
          fields_returned: findings.map((finding) => finding.item),
          attachment_paths: attachmentPaths,
          citation: fields.citation,
        },
      })
      .select("id")
      .single();
    if (runError || !run) throw new Error(`Could not save official registry connector run: ${runError?.message ?? "unknown"}`);

    const insertedIds: string[] = [];
    for (const finding of findings) {
      const checklistId =
        OFFICIAL_REGISTRY_CHECKS.find((entry) => entry.item === finding.item)?.id ??
        (finding.item === "Business licence validation" ? "business_licence_validation" : null);
      const { data: inserted, error } = await db
        .from("evidence_facts")
        .insert({
          case_id: data.caseId,
          connector_run_id: run.id,
          checklist_id: checklistId,
          finding_key: `${finding.section}:${finding.item}`,
          fact_key: finding.item,
          fact_value: { fields, finding_text: finding.evidence_excerpt },
          classification,
          confidence: finding.confidence,
          source_name: OFFICIAL_BROWSER_ASSISTED_SOURCE,
          source_url: fields.sourceUrl,
          retrieval_date: fields.retrievalDate,
          evidence_excerpt: finding.evidence_excerpt,
          source_citation: fields.citation,
          attachment_paths: attachmentPaths,
          manual_entry_created_by: userId,
          license_notes: "Official browser-assisted registry verification; no CAPTCHA bypass or automated scraping.",
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(`Could not save official registry evidence: ${error?.message ?? "unknown"}`);
      insertedIds.push(inserted.id);
    }

    await db
      .from("official_registry_verification_tasks")
      .upsert({
        id: data.taskId ?? undefined,
        case_id: data.caseId,
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: userId,
        evidence_fact_ids: insertedIds,
        updated_at: new Date().toISOString(),
      }, { onConflict: data.taskId ? "id" : "case_id,status" });

    await supabase.from("case_activity_log").insert({
      case_id: data.caseId,
      actor_id: userId,
      action: "official_registry_evidence_added",
      payload: { task_id: data.taskId ?? null, evidence_fact_ids: insertedIds, classification },
    });

    const rerun = await rerunCaseInvestigation(data.caseId, "official browser-assisted registry evidence added");
    return { ok: true, connectorRunId: run.id, evidenceFactIds: insertedIds, classification, rerun };
  });
