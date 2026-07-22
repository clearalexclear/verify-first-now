import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildCanonicalChecklist } from "../lib/investigation/checklist";
import { renderReportPdf } from "../lib/investigation/pdf.server";
import { buildBuyerFacingReportViewModel } from "../lib/investigation/buyer-facing-report";
import type { Finding, InvestigationReport, ResolvedEntity } from "../lib/investigation/types";

const baseResolvedEntity: ResolvedEntity = {
  matched: true,
  legal_name_en: null,
  // Garbled OCR/registry extraction — the exact known-bad strings that must never reach the buyer.
  legal_name_local: "江市有限公司",
  registration_number: null,
  registration_country: "China",
  registration_status: null,
  registration_date: null,
  registered_capital: null,
  registered_address: "江市江区3地1141406",
  legal_representative: null,
  business_scope: null,
  shareholders: [],
  related_companies: [],
  manufacturer_indicators: [],
  trading_indicators: [],
  confidence: "low",
  sources: [],
  notes: "Registry extraction was partial/unreliable.",
};

const beneficiaryMissingFinding: Finding = {
  section: "payment_safeguards",
  item: "Payment beneficiary not extracted",
  status: "NOT_VERIFIED",
  confidence: "low",
  source_name: "Verified Supplier Report consistency engine",
  source_url: null,
  retrieval_date: "2026-07-01T00:00:00.000Z",
  evidence_excerpt: "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.",
  evidence_ids: [],
  evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
  buyer_impact: "The payee cannot be compared against the licence holder, so wire-transfer risk cannot be cleared.",
  recommended_action: "Request a clearer proforma invoice or bank account confirmation naming the beneficiary legal entity before payment.",
};

// Mirrors the exact shape sources/uflpa.server.ts produces on a PASS verdict when the local name
// was not filtered before reaching this sentence — the raw legal_name_local is spliced directly
// into `local: "..."` inside a longer sentence, so it cannot be caught by matching the whole field.
const uflpaFinding: Finding = {
  section: "sanctions_forced_labour",
  item: "UFLPA (Uyghur Forced Labor Prevention Act) Entity List screening",
  status: "PASS",
  confidence: "medium_high",
  source_name: "DHS UFLPA Entity List snapshot 2026-07-01",
  source_url: "https://www.dhs.gov/uflpa-entity-list",
  retrieval_date: "2026-07-01T00:00:00.000Z",
  evidence_excerpt:
    'No name match to stored DHS UFLPA snapshot for verified names (English: "n/a"; local: "江市有限公司"; aliases: none). Snapshot 2026-07-01, 500 entries, checksum abc123.',
  evidence_ids: [],
  evidence_classification: "VERIFIED",
  buyer_impact: "No listed-entity name match identified in the stored official snapshot after screening the verified legal names.",
  recommended_action: "For high-risk sectors or Xinjiang-linked supply chains, request supply-chain mapping regardless of name-screening result.",
};

function buildFailureShapeReport(): InvestigationReport {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    order_reference: "VF-TEST-VIEWMODEL",
    case_reference: "CASE-TEST-VIEWMODEL",
    supplier_input: {
      name: "Jiangmen Test Supplier Co., Ltd.",
      chinese_name: "江市有限公司",
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
      concerns: null,
    },
    resolved_entity: baseResolvedEntity,
    findings: [beneficiaryMissingFinding, uflpaFinding],
    checklist_results: [],
    overall_risk_rating: "high",
    final_outcome: "PAUSE_PENDING_CLARIFICATION",
    executive_summary: "Verified Supplier Report consistency check for a mainland China supplier.",
    key_findings: [],
    buyer_implications: "Resolve the flagged items before payment.",
    recommended_safeguards: "Verify registry, invoice and certificate data before payment.",
    payment_recommendation: "Pause pending clarification.",
    inspection_recommendation: "Commission pre-shipment inspection.",
    testing_recommendation: "Test production samples where applicable.",
    methodology: "Canonical checklist methodology.",
    limitations: "Some fields could not be reliably extracted.",
    sources_used: [],
    // Uploaded evidence, tagged with the customer-declared document category — the same shape
    // pipeline.server.ts now preserves on customer_evidence (see the category fix in this PR).
    customer_evidence: [
      { name: "Customer upload: licence.pdf", url: null, retrieved_at: "2026-07-01T00:00:00.000Z", category: "business_licence" },
      { name: "Customer upload: pi_2026.pdf", url: null, retrieved_at: "2026-07-01T00:00:00.000Z", category: "proforma_invoice" },
      { name: "Customer upload: test_report.pdf", url: null, retrieved_at: "2026-07-01T00:00:00.000Z", category: "certificate_or_test_report" },
    ],
    // Deliberately INCOMPLETE — reproduces the real bug shape where the consistency engine's own
    // documents_checked list omitted "Proforma invoice" (e.g. a filename-matching miss upstream),
    // and `why` never mentions the beneficiary problem. The view model must not trust this blindly.
    verified_report_decision: {
      payment_decision: "PAUSE",
      entity_payment_consistency: "NOT_VERIFIED",
      documents_checked: ["Business licence"],
      why: [],
      deal_specific_blockers: [],
      ask_supplier_before_payment: [],
    },
  };
}

async function extractPdfText(pdf: Uint8Array): Promise<string> {
  const standardFontDataUrl = fileURLToPath(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url));
  const loadingTask = getDocument({ data: pdf.slice(), disableWorker: true, standardFontDataUrl, verbosity: VerbosityLevel.ERRORS } as any);
  const doc = await loadingTask.promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item: any) => item.str).join(" "));
  }
  await loadingTask.destroy();
  return chunks.join("\n").replace(/\s+/g, " ").trim();
}

describe("buyer-facing report view model", () => {
  it("derives documents-checked, beneficiary warning and legal-entity reliability from structured fields", () => {
    const report = buildFailureShapeReport();
    const viewModel = buildBuyerFacingReportViewModel(report);

    expect(viewModel.isVerifiedReport).toBe(true);
    expect(viewModel.documentsChecked).toEqual([
      "Business licence",
      "Proforma invoice",
      "1 certificate/test report(s)",
    ]);
    expect(viewModel.missingBeneficiaryWarning).toBe(
      "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.",
    );
    expect(viewModel.why).toContain(viewModel.missingBeneficiaryWarning);

    expect(viewModel.legalEntity.chineseLegalName.reliable).toBe(false);
    expect(viewModel.legalEntity.chineseLegalName.value).toBeNull();
    expect(viewModel.legalEntity.chineseLegalName.displayText).toBe(
      "Chinese legal name could not be reliably extracted from the uploaded licence.",
    );
    expect(viewModel.legalEntity.registeredAddress.reliable).toBe(false);
    expect(viewModel.legalEntity.registeredAddress.displayText).toBe(
      "Registered address could not be reliably extracted from the uploaded licence.",
    );
    expect(viewModel.uflpaLocalNameLine).toBe(
      "Local legal name was not reliably extracted and was not used for local-name screening.",
    );
  });

  it("renders the exact failure shape safely in the PDF (regression)", async () => {
    const report = buildFailureShapeReport();
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));

    // Positive requirements
    expect(text).toContain("Business licence");
    expect(text).toContain("Proforma invoice");
    expect(text).toContain("1 certificate/test report");
    expect(text).toContain(
      "Payment beneficiary was not extracted from the proforma invoice - cannot confirm payee matches licence holder.",
    );
    expect(text).toContain("Local legal name was not reliably extracted and was not used for local-name screening.");
    expect(text).toContain("Chinese legal name could not be reliably extracted from the uploaded licence.");
    expect(text).toContain("Registered address could not be reliably extracted from the uploaded licence.");

    // Negative requirements — the known-bad raw strings must never appear anywhere in the PDF.
    expect(text).not.toContain("No required documents checked");
    expect(text).not.toContain("江市有限公司");
    expect(text).not.toContain("江市江区3地1141406");
    expect(text).not.toContain('local: "江市有限公司"');
    expect(text).not.toContain("Why: See item-level checklist findings.");
  });
});
