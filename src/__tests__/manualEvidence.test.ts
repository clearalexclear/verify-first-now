import { describe, expect, it } from "vitest";
import { buildCanonicalChecklist, CANONICAL_CHECKLIST, applyOutcomeGating } from "../lib/investigation/checklist";
import { manualEvidenceRowToFinding, MANUAL_SOURCE } from "../lib/investigation/sources/manual-evidence.server";
import { renderReportPdf } from "../lib/investigation/pdf.server";
import type { EvidenceClassification, Finding, InvestigationReport, ResolvedEntity } from "../lib/investigation/types";

const baseResolvedEntity: ResolvedEntity = {
  matched: false,
  legal_name_en: null,
  legal_name_local: null,
  registration_number: null,
  registration_country: "China",
  registration_status: null,
  registration_date: null,
  registered_capital: null,
  registered_address: null,
  legal_representative: null,
  business_scope: null,
  shareholders: [],
  related_companies: [],
  manufacturer_indicators: [],
  trading_indicators: [],
  confidence: "low",
  sources: [],
  notes: "No official registry connector configured.",
};

function mockReport(findings: Finding[] = []): InvestigationReport {
  return {
    generated_at: "2026-07-05T00:00:00.000Z",
    order_reference: "VF-MANUAL-001",
    case_reference: "CASE-MANUAL-001",
    supplier_input: {
      name: "Jiangmen Changwen Trading Co., Ltd.",
      chinese_name: "Jiangmen Changwen Trading",
      country: "China",
      url: "https://example-supplier.test",
      contact: "Ms Chen",
    },
    customer_input: {
      name: "Alex Buyer",
      company: "Buyer Ltd",
      email: "buyer@example.test",
      destination_market: "United States",
      estimated_order_value: "50000",
      product_category: "stainless steel kitchenware",
      concerns: "Factory status and certificate validity",
    },
    resolved_entity: baseResolvedEntity,
    findings,
    checklist_results: [],
    overall_risk_rating: "medium",
    final_outcome: "PROCEED_WITH_SAFEGUARDS",
    executive_summary: "Structured manual evidence report.",
    key_findings: [],
    buyer_implications: "Unverified items require follow-up.",
    recommended_safeguards: "Verify registry, shipment and certificate data before payment.",
    payment_recommendation: "Use staged payment terms.",
    inspection_recommendation: "Commission pre-shipment inspection.",
    testing_recommendation: "Test production samples where applicable.",
    methodology: "Canonical checklist test methodology.",
    limitations: "Missing evidence remains not verified.",
    sources_used: [],
    sources_queried: [],
    customer_evidence: [],
    sources_unavailable: [],
    critical_blockers: [],
  };
}

function manualFinding(checklistId: string, classification: EvidenceClassification, text = "Verified from analyst-cited material.") {
  const finding = manualEvidenceRowToFinding({
    id: `ev_${checklistId}_${classification}`,
    checklist_id: checklistId,
    fact_key: checklistId,
    fact_value: { finding_text: text, citation: "Panda360 sample" },
    classification,
    confidence: null,
    retrieval_date: "2026-07-05T00:00:00.000Z",
    evidence_excerpt: text,
    source_citation: "Panda360 sample",
    attachment_paths: [],
  });
  if (!finding) throw new Error("missing manual finding");
  return finding;
}

describe("manual analyst evidence", () => {
  it("maps a manual evidence fact into the same finding/checklist/report JSON path", () => {
    const finding = manualFinding("legal_company_existence", "VERIFIED");
    expect(finding.source_name).toBe(MANUAL_SOURCE);
    expect(finding.evidence_ids).toEqual(["ev_legal_company_existence_VERIFIED"]);

    const report = mockReport([finding]);
    report.checklist_results = buildCanonicalChecklist(report);
    const item = report.checklist_results.find((result) => result.id === "legal_company_existence");

    expect(item?.status).toBe("PASS");
    expect(item?.evidence_classification).toBe("VERIFIED");
    expect(item?.source_names).toEqual(["Analyst verification"]);
    expect(JSON.stringify(report)).toContain("manual_analyst_entry");
  });

  it("lets a manual Verified entry flip a previously Not Verified check", () => {
    const before = buildCanonicalChecklist(mockReport()).find((item) => item.id === "registration_status");
    const after = buildCanonicalChecklist(mockReport([manualFinding("registration_status", "VERIFIED")]))
      .find((item) => item.id === "registration_status");

    expect(before?.status).toBe("NOT_VERIFIED");
    expect(after?.status).toBe("PASS");
    expect(after?.source_names).toContain("Analyst verification");
  });

  it("does not let a Supplier Claimed manual entry flip a check to passed", () => {
    const item = buildCanonicalChecklist(mockReport([manualFinding("unified_social_credit_code", "SUPPLIER_CLAIMED")]))
      .find((result) => result.id === "unified_social_credit_code");

    expect(item?.status).toBe("NOT_VERIFIED");
    expect(item?.evidence_classification).toBe("SUPPLIER_CLAIMED");
  });

  it("restores the prior check state and decision when manual evidence is retracted", () => {
    const active = buildCanonicalChecklist(mockReport([manualFinding("business_licence_validation", "VERIFIED")]))
      .find((item) => item.id === "business_licence_validation");
    const retracted = buildCanonicalChecklist(mockReport())
      .find((item) => item.id === "business_licence_validation");

    expect(active?.status).toBe("PASS");
    expect(retracted?.status).toBe("NOT_VERIFIED");

    const gated = applyOutcomeGating({ overall: "low", outcome: "GO" }, buildCanonicalChecklist(mockReport()));
    expect(gated.outcome).toBe("PAUSE_PENDING_CLARIFICATION");
  });

  it("keeps all 32 checks present and regenerates PDF input after entry and retraction", async () => {
    const withManual = mockReport([manualFinding("legal_representative", "VERIFIED", "Legal representative verified by analyst review.")]);
    withManual.checklist_results = buildCanonicalChecklist(withManual);
    expect(withManual.checklist_results).toHaveLength(CANONICAL_CHECKLIST.length);
    expect(withManual.checklist_results.find((item) => item.id === "legal_representative")?.status).toBe("PASS");
    expect((await renderReportPdf(withManual)).byteLength).toBeGreaterThan(1000);

    const afterRetraction = mockReport();
    afterRetraction.checklist_results = buildCanonicalChecklist(afterRetraction);
    expect(afterRetraction.checklist_results).toHaveLength(CANONICAL_CHECKLIST.length);
    expect(afterRetraction.checklist_results.find((item) => item.id === "legal_representative")?.status).toBe("NOT_VERIFIED");
    expect((await renderReportPdf(afterRetraction)).byteLength).toBeGreaterThan(1000);
  });
});
