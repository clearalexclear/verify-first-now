import { CANONICAL_CHECKLIST, type ChecklistId } from "../checklist";
import type { EvidenceClassification, Finding, FindingConfidence, FindingStatus } from "../types";

export const OFFICIAL_BROWSER_ASSISTED_PROVIDER = "official_browser_assisted";
export const OFFICIAL_BROWSER_ASSISTED_SOURCE = "Official browser-assisted verification";

export const OFFICIAL_REGISTRY_CHECKS: Array<{ id: ChecklistId; item: string; field: keyof OfficialRegistryFields }> = [
  { id: "legal_company_existence", item: "Legal company existence", field: "chineseLegalName" },
  { id: "chinese_legal_name", item: "Chinese legal name", field: "chineseLegalName" },
  { id: "unified_social_credit_code", item: "Unified Social Credit Code", field: "uscc" },
  { id: "registration_status", item: "Registration status", field: "registrationStatus" },
  { id: "incorporation_date", item: "Incorporation date", field: "incorporationDate" },
  { id: "registered_capital", item: "Registered capital", field: "registeredCapital" },
  { id: "legal_representative", item: "Legal representative", field: "legalRepresentative" },
  { id: "registered_address", item: "Registered address", field: "registeredAddress" },
  { id: "business_scope", item: "Business scope", field: "businessScope" },
  { id: "shareholders_beneficial_ownership", item: "Shareholders and beneficial ownership", field: "shareholdersOwnership" },
  { id: "related_companies", item: "Related companies", field: "relatedCompanies" },
  { id: "litigation_court_records", item: "Litigation and court records", field: "litigationEnforcementPenalties" },
  { id: "enforcement_administrative_penalties", item: "Enforcement and administrative penalties", field: "litigationEnforcementPenalties" },
];

export interface OfficialRegistryFields {
  sourceName: string;
  sourceUrl: string | null;
  retrievalDate: string;
  citation: string | null;
  attachmentPaths: string[];
  chineseLegalName: string | null;
  englishName: string | null;
  uscc: string | null;
  registrationStatus: string | null;
  incorporationDate: string | null;
  registeredCapital: string | null;
  registeredAddress: string | null;
  legalRepresentative: string | null;
  businessScope: string | null;
  shareholdersOwnership: string | null;
  relatedCompanies: string | null;
  litigationEnforcementPenalties: string | null;
  abnormalOperationRecords: string | null;
  businessLicenceMatchesOfficial: boolean;
}

export interface OfficialRegistryFactRow {
  id: string;
  checklist_id: string | null;
  fact_key: string | null;
  fact_value: any;
  classification: EvidenceClassification;
  confidence: FindingConfidence | null;
  retrieval_date: string;
  evidence_excerpt: string | null;
  source_name: string;
  source_url: string | null;
  source_citation: string | null;
  attachment_paths: unknown;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function valueText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function hasOfficialEvidence(fields: Pick<OfficialRegistryFields, "sourceUrl" | "citation" | "attachmentPaths">): boolean {
  return hasText(fields.sourceUrl) || hasText(fields.citation) || fields.attachmentPaths.length > 0;
}

export function classificationForOfficialRegistry(fields: Pick<OfficialRegistryFields, "sourceUrl" | "citation" | "attachmentPaths">): EvidenceClassification {
  return hasOfficialEvidence(fields) ? "VERIFIED" : "NOT_INDEPENDENTLY_VERIFIED";
}

function statusForClassification(classification: EvidenceClassification, item: string): FindingStatus {
  if (classification !== "VERIFIED") return "NOT_VERIFIED";
  if (/litigation|enforcement|penalties|abnormal operation/i.test(item)) return "CAUTION";
  return "PASS";
}

function confidenceForClassification(classification: EvidenceClassification): FindingConfidence {
  return classification === "VERIFIED" ? "high" : "low";
}

function checklistDef(id: string) {
  return CANONICAL_CHECKLIST.find((item) => item.id === id);
}

function findingFromValue(args: {
  id: ChecklistId;
  item: string;
  value: string;
  fields: OfficialRegistryFields;
  evidenceId?: string;
}): Finding {
  const classification = classificationForOfficialRegistry(args.fields);
  const citationText = hasText(args.fields.citation) ? ` Citation: ${args.fields.citation}.` : "";
  const attachmentText = args.fields.attachmentPaths.length ? ` Attachments stored: ${args.fields.attachmentPaths.length}.` : "";
  const sourceLabel = args.fields.sourceName.trim() || OFFICIAL_BROWSER_ASSISTED_SOURCE;
  const def = checklistDef(args.id);
  return {
    section: def?.section ?? "legal_entity",
    item: args.item,
    status: statusForClassification(classification, args.item),
    confidence: confidenceForClassification(classification),
    source_name: OFFICIAL_BROWSER_ASSISTED_SOURCE,
    source_url: args.fields.sourceUrl,
    retrieval_date: args.fields.retrievalDate,
    evidence_excerpt: `${args.item}: ${args.value}. Source: ${sourceLabel}.${citationText}${attachmentText}`.trim(),
    evidence_ids: args.evidenceId ? [args.evidenceId] : [],
    evidence_classification: classification,
    buyer_impact:
      classification === "VERIFIED"
        ? "This registry item was verified by analyst review of an official/public source."
        : "This registry item was recorded but lacks official/public evidence citation or attachment, so it is not independently verified.",
    recommended_action:
      classification === "VERIFIED"
        ? "Retain the cited official/public source evidence with the case file."
        : "Attach or cite official/public source evidence before treating this registry item as verified.",
  };
}

export function officialRegistryFieldsToFindings(fields: OfficialRegistryFields): Finding[] {
  const findings: Finding[] = [];
  for (const entry of OFFICIAL_REGISTRY_CHECKS) {
    const value = valueText(fields[entry.field]);
    if (!value) continue;
    findings.push(findingFromValue({ id: entry.id, item: entry.item, value, fields }));
  }
  if (fields.businessLicenceMatchesOfficial && (hasText(fields.uscc) || hasText(fields.chineseLegalName))) {
    const value = fields.uscc ? `Uploaded licence fields match official registry USCC ${fields.uscc}.` : `Uploaded licence fields match official registry legal name ${fields.chineseLegalName}.`;
    findings.push(findingFromValue({
      id: "business_licence_validation",
      item: "Business licence validation",
      value,
      fields,
    }));
  }
  if (hasText(fields.abnormalOperationRecords)) {
    findings.push(findingFromValue({
      id: "enforcement_administrative_penalties",
      item: "Enforcement and administrative penalties",
      value: `Abnormal operation records: ${fields.abnormalOperationRecords}`,
      fields,
    }));
  }
  return findings;
}

export function officialRegistryRowToFinding(row: OfficialRegistryFactRow): Finding | null {
  const checklistId = String(row.checklist_id || row.fact_key || "");
  const def = checklistDef(checklistId);
  if (!def) return null;
  const attachmentPaths = Array.isArray(row.attachment_paths) ? row.attachment_paths.map(String) : [];
  const fields: OfficialRegistryFields = {
    sourceName: row.fact_value?.source_name || OFFICIAL_BROWSER_ASSISTED_SOURCE,
    sourceUrl: row.source_url,
    retrievalDate: row.retrieval_date,
    citation: row.source_citation,
    attachmentPaths,
    chineseLegalName: null,
    englishName: null,
    uscc: null,
    registrationStatus: null,
    incorporationDate: null,
    registeredCapital: null,
    registeredAddress: null,
    legalRepresentative: null,
    businessScope: null,
    shareholdersOwnership: null,
    relatedCompanies: null,
    litigationEnforcementPenalties: null,
    abnormalOperationRecords: null,
    businessLicenceMatchesOfficial: false,
  };
  const classification = row.classification === "VERIFIED"
    ? classificationForOfficialRegistry(fields)
    : row.classification;
  return {
    section: def.section,
    item: def.title,
    status: statusForClassification(classification, def.title),
    confidence: row.confidence ?? confidenceForClassification(classification),
    source_name: OFFICIAL_BROWSER_ASSISTED_SOURCE,
    source_url: row.source_url,
    retrieval_date: row.retrieval_date,
    evidence_excerpt: String(row.evidence_excerpt || "").trim(),
    evidence_ids: [row.id],
    evidence_classification: classification,
    buyer_impact:
      classification === "VERIFIED"
        ? "This registry item was verified by analyst review of an official/public source."
        : "This registry item lacks enough official/public source evidence to verify the checklist item.",
    recommended_action:
      classification === "VERIFIED"
        ? "Retain the official/public source evidence with the case file."
        : "Attach or cite official/public source evidence before treating this registry item as verified.",
  };
}

export async function loadOfficialRegistryFindings(caseId: string): Promise<Finding[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("evidence_facts")
    .select("id, checklist_id, fact_key, fact_value, classification, confidence, retrieval_date, evidence_excerpt, source_name, source_url, source_citation, attachment_paths")
    .eq("case_id", caseId)
    .eq("source_name", OFFICIAL_BROWSER_ASSISTED_SOURCE)
    .is("retracted_at", null)
    .order("retrieval_date", { ascending: false });

  if (error) throw new Error(`Could not load official browser-assisted registry evidence: ${error.message}`);

  return (data ?? [])
    .map((row: OfficialRegistryFactRow) => officialRegistryRowToFinding(row))
    .filter((finding: Finding | null): finding is Finding => Boolean(finding));
}

export async function createOfficialRegistryTask(args: {
  caseId: string;
  jobId?: string | null;
  searchTerms: string[];
  reason: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("official_registry_verification_tasks")
    .upsert({
      case_id: args.caseId,
      job_id: args.jobId ?? null,
      status: "pending",
      requested_search_terms: args.searchTerms,
      reason: args.reason,
      updated_at: new Date().toISOString(),
    }, { onConflict: "case_id,status" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not create official registry verification task: ${error.message}`);
  return data ?? null;
}
