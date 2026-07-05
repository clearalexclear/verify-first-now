import { CANONICAL_CHECKLIST, type ChecklistId } from "../checklist";
import type { EvidenceClassification, Finding, FindingConfidence, FindingStatus } from "../types";

const MANUAL_SOURCE = "manual_analyst_entry";

function statusForClassification(classification: EvidenceClassification): FindingStatus {
  if (classification === "VERIFIED") return "PASS";
  if (classification === "CONTRADICTED") return "CAUTION";
  if (classification === "CORROBORATED") return "CAUTION";
  return "NOT_VERIFIED";
}

function confidenceForClassification(classification: EvidenceClassification): FindingConfidence {
  if (classification === "VERIFIED") return "high";
  if (classification === "CORROBORATED" || classification === "CONTRADICTED") return "medium_high";
  if (classification === "SUPPLIER_CLAIMED" || classification === "INFERRED") return "medium";
  return "low";
}

function checklistDef(id: string) {
  return CANONICAL_CHECKLIST.find((item) => item.id === id);
}

export async function loadManualEvidenceFindings(caseId: string): Promise<Finding[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("evidence_facts")
    .select("id, checklist_id, fact_key, fact_value, classification, confidence, retrieval_date, evidence_excerpt, source_citation, attachment_paths")
    .eq("case_id", caseId)
    .eq("source_name", MANUAL_SOURCE)
    .is("retracted_at", null)
    .order("retrieval_date", { ascending: false });

  if (error) throw new Error(`Could not load manual analyst evidence: ${error.message}`);

  const findings: Finding[] = [];
  for (const row of data ?? []) {
    const checklistId = String(row.checklist_id || row.fact_key || "");
    const def = checklistDef(checklistId);
    if (!def) continue;

    const classification = row.classification as EvidenceClassification;
    const status = statusForClassification(classification);
    const citation = typeof row.source_citation === "string" && row.source_citation.trim()
      ? row.source_citation.trim()
      : null;
    const attachmentCount = Array.isArray(row.attachment_paths) ? row.attachment_paths.length : 0;
    const text = String(row.evidence_excerpt || row.fact_value?.finding_text || "").trim();
    const citationText = citation ? ` Citation: ${citation}.` : "";
    const attachmentText = attachmentCount > 0 ? ` Attachments stored: ${attachmentCount}.` : "";

    findings.push({
      section: def.section,
      item: def.title,
      status,
      confidence: (row.confidence as FindingConfidence | null) ?? confidenceForClassification(classification),
      source_name: MANUAL_SOURCE,
      source_url: null,
      retrieval_date: row.retrieval_date,
      evidence_excerpt: `${text}${citationText}${attachmentText}`.trim(),
      evidence_ids: [row.id],
      evidence_classification: classification,
      buyer_impact:
        status === "PASS"
          ? "This checklist item was verified by analyst review of cited evidence."
          : "This manual evidence is recorded but does not independently verify the checklist item as passed.",
      recommended_action:
        status === "PASS"
          ? "Retain the cited evidence with the case file and re-check if new supplier information conflicts with it."
          : "Obtain independently verifiable evidence before treating this item as passed.",
    });
  }

  return findings;
}

export { MANUAL_SOURCE };
export type { ChecklistId };
