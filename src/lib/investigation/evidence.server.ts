import { MANUAL_SOURCE } from "./sources/manual-evidence.server";
import { PANDA360_SOURCE, QINCHECK_SOURCE } from "./sources/china-registry.server";
import { OFFICIAL_BROWSER_ASSISTED_SOURCE } from "./sources/official-browser-assisted.server";
import { OPEN_WEB_CHINA_REGISTRY_SOURCE } from "./sources/open-web-china-registry.server";
import type { EvidenceClassification, Finding } from "./types";

function inferClassification(finding: Finding): EvidenceClassification {
  if (finding.evidence_classification) return finding.evidence_classification;
  if (finding.status === "NOT_VERIFIED") return "NOT_INDEPENDENTLY_VERIFIED";
  if (finding.source_name.toLowerCase().includes("customer") || finding.source_name.toLowerCase().includes("upload")) {
    return "SUPPLIER_CLAIMED";
  }
  if (finding.source_name.toLowerCase().includes("firecrawl") || finding.source_name.toLowerCase().includes("web search")) {
    return "INFERRED";
  }
  return "VERIFIED";
}

function genericSearchCannotVerify(finding: Finding): boolean {
  const source = finding.source_name.toLowerCase();
  const isGeneric = source.includes("firecrawl") || source.includes("web search") || source.includes("public shipping-data web search");
  if (!isGeneric) return false;
  return [
    "legal_entity",
    "export_history",
    "certificates_documents",
    "litigation_enforcement",
  ].includes(finding.section);
}

export function enforceEvidenceIds(findings: Finding[]): Finding[] {
  return findings.map((finding) => {
    const evidenceIds = finding.evidence_ids ?? [];
    const hasEvidence = evidenceIds.length > 0;
    if (finding.status === "NOT_APPLICABLE") {
      return {
        ...finding,
        evidence_ids: evidenceIds,
        evidence_classification: finding.evidence_classification ?? "NOT_INDEPENDENTLY_VERIFIED",
      };
    }
    if (!hasEvidence || !finding.evidence_excerpt?.trim() || genericSearchCannotVerify(finding)) {
      return {
        ...finding,
        status: "NOT_VERIFIED",
        confidence: "low",
        evidence_ids: evidenceIds,
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      };
    }
    return {
      ...finding,
      evidence_ids: evidenceIds,
      evidence_classification: inferClassification(finding),
    };
  });
}

export async function persistFindingEvidence(caseId: string, findings: Finding[], jobId?: string | null): Promise<Finding[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const out: Finding[] = [];

  for (const finding of findings) {
    if (
      (finding.source_name === MANUAL_SOURCE ||
        finding.source_name === QINCHECK_SOURCE ||
        finding.source_name === PANDA360_SOURCE ||
        finding.source_name === OFFICIAL_BROWSER_ASSISTED_SOURCE ||
        finding.source_name.startsWith(OPEN_WEB_CHINA_REGISTRY_SOURCE)) &&
      (finding.evidence_ids ?? []).length > 0
    ) {
      out.push({
        ...finding,
        evidence_classification: finding.evidence_classification ?? inferClassification(finding),
      });
      continue;
    }

    if (!finding.evidence_excerpt?.trim()) {
      out.push({
        ...finding,
        evidence_ids: finding.evidence_ids ?? [],
        evidence_classification: finding.evidence_classification ?? "NOT_INDEPENDENTLY_VERIFIED",
      });
      continue;
    }

    const classification = inferClassification(finding);
    const { data: inserted, error } = await db
      .from("evidence_facts")
      .insert({
        case_id: caseId,
        finding_key: `${finding.section}:${finding.item}`,
        fact_key: finding.item,
        fact_value: { status: finding.status, excerpt: finding.evidence_excerpt },
        classification,
        confidence: finding.confidence,
        source_name: finding.source_name,
        source_url: finding.source_url,
        retrieval_date: finding.retrieval_date,
        evidence_excerpt: finding.evidence_excerpt,
        license_notes: jobId ? `Created during investigation job ${jobId}` : null,
      })
      .select("id")
      .single();

    out.push({
      ...finding,
      evidence_ids: error || !inserted ? finding.evidence_ids ?? [] : [...(finding.evidence_ids ?? []), inserted.id],
      evidence_classification: classification,
    });
  }

  return enforceEvidenceIds(out);
}
