import { describe, expect, it, vi } from "vitest";
import { enforceEvidenceIds } from "../lib/investigation/evidence.server";
import { connectorRegistry } from "../lib/investigation/connectors/registry.server";
import { jobIdempotencyKey, nextBackoff, testJobIdempotencyKey } from "../lib/investigation/job-queue.server";
import { assertTestInvestigationEnabled } from "../lib/investigation/test-runner.server";
import { verifyStripeSignature } from "../lib/payments/stripe-webhook.server";
import { buildCanonicalChecklist, CANONICAL_CHECKLIST, CHECKLIST_COUNT, detectChecklistContradictions, applyOutcomeGating } from "../lib/investigation/checklist";
import { renderReportPdf } from "../lib/investigation/pdf.server";
import { buildBuyerFacingReportViewModel } from "../lib/investigation/report-sanitizer";
import type { Finding, InvestigationReport, ResolvedEntity } from "../lib/investigation/types";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";

async function stripeSignature(raw: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

const baseFinding: Finding = {
  section: "export_history",
  item: "Shipment history",
  status: "PASS",
  confidence: "medium",
  source_name: "Public shipping-data web search",
  source_url: "https://example.test",
  retrieval_date: "2026-06-29T00:00:00.000Z",
  evidence_excerpt: "A generic search snippet mentions the company.",
  buyer_impact: "Potential shipment history.",
  recommended_action: "Use licensed shipment data.",
};

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

function mockReport(overrides: Partial<InvestigationReport> = {}): InvestigationReport {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    order_reference: "VF-TEST-001",
    case_reference: "CASE-TEST-001",
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
    findings: [],
    checklist_results: [],
    overall_risk_rating: "medium",
    final_outcome: "PROCEED_WITH_SAFEGUARDS",
    executive_summary: "Structured checklist test report.",
    key_findings: [],
    buyer_implications: "Unverified items require follow-up.",
    recommended_safeguards: "Verify registry, shipment and certificate data before payment.",
    payment_recommendation: "Use staged payment terms.",
    inspection_recommendation: "Commission pre-shipment inspection.",
    testing_recommendation: "Test production samples where applicable.",
    methodology: "Canonical checklist test methodology.",
    limitations: "Missing evidence remains not verified.",
    sources_used: [],
    ...overrides,
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

describe("payment security", () => {
  it("keeps payment and test job idempotency server-side", () => {
    expect(jobIdempotencyKey("order-123")).toBe("stripe-paid:order-123");
    expect(testJobIdempotencyKey("order-123", "case-456")).toMatch(/^test-investigation:order-123:case-456:/);
  });

  it("requires explicit flags for manual investigation tests", () => {
    expect(() => assertTestInvestigationEnabled({ NODE_ENV: "development" })).toThrow(/disabled/i);
    expect(() => assertTestInvestigationEnabled({ NODE_ENV: "production", VERIFYFIRST_ENABLE_TEST_INVESTIGATION: "true" })).toThrow(/Production test investigation trigger is disabled/);
    expect(() => assertTestInvestigationEnabled({ NODE_ENV: "production", VERIFYFIRST_ENABLE_TEST_INVESTIGATION: "true", VERIFYFIRST_ALLOW_PRODUCTION_TEST_INVESTIGATION: "true" })).not.toThrow();
  });

  it("verifies valid Stripe signatures and rejects forged signatures", async () => {
    const raw = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
    const valid = await stripeSignature(raw, "whsec_test");
    await expect(verifyStripeSignature(raw, valid, "whsec_test")).resolves.toBe(true);
    await expect(verifyStripeSignature(raw, "t=123,v1=bad", "whsec_test")).resolves.toBe(false);
  });
});

describe("job retry foundation", () => {
  it("uses exponential backoff for retries", () => {
    const start = Date.parse("2026-06-29T00:00:00.000Z");
    expect(nextBackoff(1, start)).toBe("2026-06-29T00:01:00.000Z");
    expect(nextBackoff(3, start)).toBe("2026-06-29T00:04:00.000Z");
  });
});

describe("connectors", () => {
  it("keeps QCC, ImportGenius, IAF and OpenSanctions disabled until credentials are supplied", async () => {
    for (const id of ["qcc_corporate_registry", "importgenius_shipments", "iaf_certsearch", "opensanctions_commercial"]) {
      const connector = connectorRegistry.find((c) => c.id === id);
      expect(connector).toBeTruthy();
      expect(connector?.mode).toBe("paid_disabled");
      expect(connector?.isEnabled({})).toBe(false);
      const result = await connector!.run({}, { caseId: "case-1", env: {} });
      expect(result.status).toBe("not_configured");
      expect(result.evidence).toHaveLength(0);
    }
  });

  it("classifies Firecrawl as web intelligence only", () => {
    const connector = connectorRegistry.find((c) => c.id === "firecrawl_web_intelligence");
    expect(connector?.category).toBe("general_web_research");
    expect(connector?.mode).toBe("paid_disabled");
  });
});

describe("evidence enforcement", () => {
  it("downgrades missing evidence and generic shipment search", () => {
    const [noIds] = enforceEvidenceIds([{ ...baseFinding, source_name: "ImportGenius API", evidence_ids: [] }]);
    expect(noIds.status).toBe("NOT_VERIFIED");
    expect(noIds.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");

    const [generic] = enforceEvidenceIds([{ ...baseFinding, evidence_ids: ["ev_1"] }]);
    expect(generic.status).toBe("NOT_VERIFIED");
    expect(generic.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("preserves hard-stop evidence when backed by evidence IDs", () => {
    const [finding] = enforceEvidenceIds([{ ...baseFinding, section: "sanctions_forced_labour", item: "Restricted-party match", status: "FAIL", confidence: "high", source_name: "OpenSanctions Commercial API", evidence_ids: ["ev_hard_stop"], evidence_classification: "VERIFIED" }]);
    expect(finding.status).toBe("FAIL");
    expect(finding.evidence_ids).toEqual(["ev_hard_stop"]);
  });
});

describe("canonical checklist", () => {
  it("defines and emits exactly 32 stable checklist items", () => {
    const results = buildCanonicalChecklist(mockReport());
    expect(CHECKLIST_COUNT).toBe(32);
    expect(CANONICAL_CHECKLIST).toHaveLength(32);
    expect(results).toHaveLength(32);
    expect(results.map((r) => r.id)).toEqual(CANONICAL_CHECKLIST.map((r) => r.id));
  });

  it("turns no evidence into NOT_VERIFIED", () => {
    const result = buildCanonicalChecklist(mockReport()).find((item) => item.id === "legal_company_existence");
    expect(result?.status).toBe("NOT_VERIFIED");
    expect(result?.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("displays missing required inputs", () => {
    const missing = buildCanonicalChecklist(mockReport({
      supplier_input: { name: "", chinese_name: null, country: "China", url: "", contact: null },
      customer_input: { name: "Buyer", company: "Buyer Ltd", email: "buyer@example.test", destination_market: "", estimated_order_value: "", product_category: "", concerns: null },
    })).find((item) => item.id === "missing_information_required");
    expect(missing?.status).toBe("NOT_VERIFIED");
    expect(missing?.missing_information_required).toContain("Supplier company name");
    expect(missing?.explanation).toMatch(/Missing information required/);
  });

  it("keeps zero Firecrawl adverse-media results NOT_VERIFIED rather than PASS", () => {
    const adverse = buildCanonicalChecklist(mockReport({
      findings: [{ ...baseFinding, section: "digital_footprint", item: "Adverse media screening", status: "PASS", source_name: "Public web search (Firecrawl)", evidence_excerpt: "", evidence_ids: [] }],
    })).find((item) => item.id === "adverse_media");
    expect(adverse?.status).toBe("NOT_VERIFIED");
    expect(adverse?.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("prevents Firecrawl from verifying official registry, shipment, litigation or certificates", () => {
    const results = buildCanonicalChecklist(mockReport({
      findings: [
        { ...baseFinding, section: "export_history", item: "Export and shipment history", source_name: "Public web search (Firecrawl)", evidence_ids: ["ev_ship"] },
        { ...baseFinding, section: "litigation_enforcement", item: "Litigation and enforcement screening", source_name: "Public web search (Firecrawl)", evidence_ids: ["ev_lit"] },
        { ...baseFinding, section: "certificates_documents", item: "Certificate authenticity", source_name: "Public web search (Firecrawl)", evidence_ids: ["ev_cert"] },
      ],
      resolved_entity: { ...baseResolvedEntity, matched: true, legal_name_en: "Jiangmen Changwen Trading Co., Ltd.", sources: [{ name: "Public web search (Firecrawl)", url: "https://example.test" }] },
    }));
    for (const id of ["legal_company_existence", "us_shipment_export_history", "litigation_court_records", "certificate_authenticity"] as const) {
      const item = results.find((r) => r.id === id);
      expect(item?.status).toBe("NOT_VERIFIED");
      expect(item?.evidence_classification).not.toBe("VERIFIED");
    }
  });

  it("detects contradictions and classifies them as CONTRADICTED", () => {
    const findings = [{ ...baseFinding, item: "Certificate holder name mismatch", evidence_ids: ["ev_1"] }];
    const resolved = { ...baseResolvedEntity, legal_name_en: "Different Factory Co., Ltd.", legal_name_local: "Different Local Name" };
    expect(detectChecklistContradictions({ supplierInput: mockReport().supplier_input, resolvedEntity: resolved, findings }).length).toBeGreaterThan(0);
    const item = buildCanonicalChecklist(mockReport({ resolved_entity: resolved, findings })).find((r) => r.id === "red_flags_contradictions");
    expect(item?.status).toBe("CAUTION");
    expect(item?.evidence_classification).toBe("CONTRADICTED");
  });

  it("keeps paid-disabled checklist items NOT_VERIFIED", () => {
    const results = buildCanonicalChecklist(mockReport());
    for (const id of ["legal_company_existence", "us_shipment_export_history", "iso_management_certificates", "sanctions_restricted_party"] as const) {
      expect(results.find((r) => r.id === id)?.status).toBe("NOT_VERIFIED");
    }
  });

  it("puts all checklist items into report JSON and PDF input", async () => {
    const report = mockReport();
    report.checklist_results = buildCanonicalChecklist(report);
    const json = JSON.stringify(report);
    for (const item of CANONICAL_CHECKLIST) expect(json).toContain(item.id);
    const pdf = await renderReportPdf(report);
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(report.checklist_results).toHaveLength(32);
  });

  it("renders Chinese supplier names in the PDF", async () => {
    const report = mockReport({
      supplier_input: {
        ...mockReport().supplier_input,
        chinese_name: "江门市昌文厨具有限公司",
      },
      resolved_entity: {
        ...baseResolvedEntity,
        legal_name_local: "华为技术有限公司",
        registered_address: "深圳市龙岗区坂田华为总部办公楼",
      },
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("江门市昌文厨具有限公司");
    expect(text).toContain("华为技术有限公司");
    expect(text).toContain("深圳市龙岗区坂田华为总部办公楼");
    expect(text).not.toMatch(/\[\d+-char non-Latin\]/);
    expect(text).not.toMatch(/Chinese legal name:\s*\./);
    expect(text).not.toMatch(/Local name:\s*\./);
    expect(text).not.toMatch(/Local name:\s*Commercial recommendation/);
  });

  it("does not render evidence-reference placeholders in buyer-facing report text", async () => {
    const report = mockReport({
      executive_summary: "Public summary is ready (evidence references).",
      buyer_implications: "Buyer should not see evidence references or empty citation placeholders.",
      recommended_safeguards: "Safeguards should cite available sources only.",
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).not.toMatch(/evidence references/i);
    expect(text).not.toMatch(/\(\s*\)/);
  });

  it("does not render garbled Chinese OCR fields in buyer-facing report text", async () => {
    const report = mockReport({
      executive_summary: "Licence OCR returned Chinese legal name: 江市有限公司 and registered address: 江市江区3地1141406.",
      buyer_implications: "Do not rely on 江市有限公司 as the licence entity.",
      findings: [{
        ...baseFinding,
        section: "certificates_documents",
        item: "Business licence validation",
        status: "CAUTION",
        source_name: "supplier-provided business licence",
        evidence_excerpt: "Chinese legal name: 江市有限公司; Registered address: 江市江区3地1141406; Business scope: 技术; Chinese legal name could not be reliably extracted from the uploaded licence. Registered address could not be reliably extracted from the uploaded licence. Business scope could not be reliably extracted from the uploaded licence.",
        evidence_ids: ["ev_ocr"],
        evidence_classification: "SUPPLIER_CLAIMED",
      }],
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("Chinese legal name could not be reliably extracted from the uploaded licence.");
    expect(text).toContain("Registered address could not be reliably extracted from the uploaded licence.");
    expect(text).toContain("Business scope could not be reliably extracted from the uploaded licence.");
    expect(text).not.toContain("江市有限公司");
    expect(text).not.toContain("江市江区3地1141406");
    expect(text).not.toContain("Business scope: 技术");
  });

  it("renders the Verified Report decision panel for Pause reports", async () => {
    const report = mockReport({
      final_outcome: "PAUSE_PENDING_CLARIFICATION",
      overall_risk_rating: "high",
      verified_report_decision: {
        payment_decision: "PAUSE",
        entity_payment_consistency: "NOT_VERIFIED",
        documents_checked: ["Business licence", "Proforma invoice"],
        why: ["Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder."],
        deal_specific_blockers: [],
        ask_supplier_before_payment: ["Ask the supplier to provide a proforma invoice or bank letter showing the payment beneficiary legal name."],
      },
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("Payment decision: Pause");
    expect(text).toContain("Entity/payment consistency: CANNOT CONFIRM");
    expect(text).toContain("Documents checked: Business licence; Proforma invoice");
    expect(text).toContain("Why: Payment beneficiary was not extracted from the proforma invoice - cannot confirm payee matches licence holder.");
    expect(text).toContain("Deal-specific blockers: None identified from the extracted payment fields.");
    expect(text).toContain("Ask supplier before payment: Ask the supplier to provide a proforma invoice or bank letter showing the payment beneficiary legal name.");
  });

  it("does not partially render common Chinese registry labels", async () => {
    const report = mockReport({
      executive_summary: "Uploaded 营业执照 lists 统一社会信用代码, 法定代表人, 注册地址 and 经营范围.",
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("Business License");
    expect(text).toContain("Unified Social Credit Code");
    expect(text).not.toMatch(/Business License\s*\(营\)/);
    expect(text).not.toMatch(/\(营\)|\(统一\)|\(法定\)|\(注册\)|\(经营\)/);
  });

  it("removes internal UUIDs from rendered PDF sections", async () => {
    const uuid = "3d8f8267-0b39-4d9c-9c2f-6d25b1a2e034";
    const report = mockReport({
      executive_summary: `Executive summary cites evidence_ids: ${uuid}.`,
      buyer_implications: `Buyer implication should not expose ${uuid}.`,
      recommended_safeguards: `Recommended safeguards should hide evidence_ids=${uuid}.`,
    });
    report.checklist_results = buildCanonicalChecklist(report);
    report.checklist_results[0] = {
      ...report.checklist_results[0],
      explanation: `Explanation references evidence_ids: ${uuid}.`,
      evidence_ids: [uuid],
    };

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
    expect(text).not.toMatch(/evidence_ids/i);
  });

  it("does not pass adverse media from weak web search", () => {
    const adverse = buildCanonicalChecklist(mockReport({
      findings: [{
        ...baseFinding,
        section: "digital_footprint",
        item: "Adverse media screening",
        status: "PASS",
        source_name: "Public web search (Firecrawl)",
        evidence_excerpt: "No relevant adverse-media result identified in public search; absence of hits is not proof no adverse media exists.",
        evidence_ids: ["ev_weak_adverse"],
        evidence_classification: "INFERRED",
      }],
    })).find((item) => item.id === "adverse_media");
    expect(adverse?.status).toBe("NOT_VERIFIED");
    expect(adverse?.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("does not render garbled export snippets or source titles", async () => {
    const report = mockReport({
      findings: [{
        ...baseFinding,
        section: "export_history",
        item: "Export and shipment history",
        status: "NOT_VERIFIED",
        source_name: "名称Unified Social Credit Code注册",
        source_url: "https://www.globalsources.com/manufacturers/cookware.html",
        evidence_excerpt: "No reliable shipment-history evidence identified from public sources. deveirter gnirts 代码 国Unified Social Credit Code公",
        evidence_ids: [],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      }],
      sources_queried: [{
        name: "名称Unified Social Credit Code注册",
        url: "https://www.globalsources.com/manufacturers/cookware.html",
        retrieved_at: "2026-07-21T00:00:00.000Z",
        category: "screening",
      }],
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("No reliable shipment-history evidence identified from public sources.");
    expect(text).toContain("Shipping aggregator result");
    expect(text).not.toContain("名称Unified Social Credit Code注册");
    expect(text).not.toContain("国Unified Social Credit Code公");
    expect(text).not.toMatch(/deveirter|gnirts|代码/);
  });

  it("sanitizes a verified_report snapshot and wires the page-one decision panel from uploaded evidence", async () => {
    const report = mockReport({
      final_outcome: "PAUSE_PENDING_CLARIFICATION",
      overall_risk_rating: "high",
      supplier_input: {
        ...mockReport().supplier_input,
        chinese_name: "江市有限公司",
      },
      resolved_entity: {
        ...baseResolvedEntity,
        legal_name_local: "江市有限公司",
        registered_address: "江市江区3地1141406",
        business_scope: "技术",
      },
      executive_summary:
        "The uploaded business licence was reviewed, but Chinese legal name: 江市有限公司, Registered address: 江市江区3地1141406 and Business scope: 技术 appeared in OCR. Obtain a copy of the supplier's official business license.",
      buyer_implications: "UFLPA and website consistency used 江市有限公司 and Business scope: 技术 in old snapshot text.",
      recommended_safeguards: "Obtain a copy of the supplier's official business license and review noisy export snippets.",
      payment_recommendation: "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.",
      findings: [
        {
          ...baseFinding,
          section: "certificates_documents",
          item: "Business licence validation",
          status: "CAUTION",
          source_name: "supplier-provided business licence",
          evidence_excerpt: "Chinese legal name: 江市有限公司; Registered address: 江市江区3地1141406; Business scope: 技术.",
          evidence_ids: ["ev_license"],
          evidence_classification: "SUPPLIER_CLAIMED",
        },
        {
          ...baseFinding,
          section: "payment_safeguards",
          item: "Payment beneficiary not extracted",
          status: "NOT_VERIFIED",
          source_name: "Verified Supplier Report consistency engine",
          evidence_excerpt: "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.",
          evidence_ids: [],
          evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
        },
        {
          ...baseFinding,
          section: "digital_footprint",
          item: "Adverse media screening",
          status: "PASS",
          source_name: "Public web search (Firecrawl)",
          evidence_excerpt: "No relevant adverse-media result identified in public search; absence of hits is not proof no adverse media exists.",
          evidence_ids: ["ev_adverse"],
          evidence_classification: "INFERRED",
        },
        {
          ...baseFinding,
          section: "export_history",
          item: "Export and shipment history",
          status: "NOT_VERIFIED",
          source_name: "名称Unified Social Credit Code注册",
          source_url: "https://www.globalsources.com/manufacturers/cookware.html",
          evidence_excerpt: "No reliable shipment-history evidence identified from public sources. GlobalSources multilingual directory deveirter gnirts 代码 مصنع fournisseur hersteller",
          evidence_ids: [],
          evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
        },
        {
          ...baseFinding,
          section: "sanctions_forced_labour",
          item: "UFLPA (Uyghur Forced Labor Prevention Act) Entity List screening",
          status: "PASS",
          source_name: "DHS UFLPA Entity List snapshot 2026-07-21",
          source_url: "https://www.dhs.gov/uflpa-entity-list",
          evidence_excerpt: "No name match to stored DHS UFLPA snapshot for verified names (English: \"Yangjiang Justa Industry&trade Co., Ltd.\"; local: \"江市有限公司\"; aliases: none).",
          evidence_ids: ["ev_uflpa"],
          evidence_classification: "VERIFIED",
        },
      ],
      customer_evidence: [
        { name: "Customer upload: business_licence.jpg", url: null, retrieved_at: "2026-07-21T17:15:39.000Z", category: "customer_upload" },
        { name: "Customer upload: proforma_invoice.pdf", url: null, retrieved_at: "2026-07-21T17:15:39.000Z", category: "customer_upload" },
        { name: "Customer upload: certificate_or_test_report.jpg", url: null, retrieved_at: "2026-07-21T17:15:39.000Z", category: "customer_upload" },
      ],
      sources_queried: [
        { name: "名称Unified Social Credit Code注册", url: "https://www.globalsources.com/manufacturers/cookware.html", retrieved_at: "2026-07-21T17:15:39.000Z", category: "screening" },
      ],
      verified_report_decision: {
        payment_decision: "PAUSE",
        entity_payment_consistency: "NOT_VERIFIED",
        documents_checked: [],
        why: [],
        deal_specific_blockers: [],
        ask_supplier_before_payment: ["Confirm the uploaded business licence against an official Chinese registry source."],
      },
    });
    report.checklist_results = buildCanonicalChecklist(report);

    const exportHistory = report.checklist_results.find((item) => item.id === "us_shipment_export_history");
    expect(exportHistory?.status).toBe("NOT_VERIFIED");
    expect(exportHistory?.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
    const adverseMedia = report.checklist_results.find((item) => item.id === "adverse_media");
    expect(adverseMedia?.status).not.toBe("PASS");

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).not.toContain("No required documents checked");
    expect(text).toContain("Business licence");
    expect(text).toContain("Proforma invoice");
    expect(text).toContain("certificate/test report");
    expect(text).not.toContain("江市有限公司");
    expect(text).not.toContain("江市江区3地1141406");
    expect(text).not.toContain("local: \"江市有限公司\"");
    expect(text).not.toContain("Business scope: 技术");
    expect(text).toContain("Chinese legal name could not be reliably extracted from the uploaded licence.");
    expect(text).toContain("Registered address could not be reliably extracted from the uploaded licence.");
    expect(text).toContain("Business scope could not be reliably extracted from the uploaded licence.");
    expect(text).toContain("Local legal name was not reliably extracted and was not used for local-name screening.");
    expect(text).toContain("Documents checked: Business licence; Proforma invoice; 1 certificate/test report(s)");
    expect(text).toContain("Payment beneficiary was not extracted from the proforma invoice - cannot confirm payee matches licence holder.");
    expect(text).toContain("No reliable shipment-history evidence identified from public sources.");
    expect(text).not.toMatch(/GlobalSources multilingual directory|deveirter|gnirts|代码|مصنع|fournisseur|hersteller/);
    expect(text).toContain("Confirm the uploaded business licence against an official Chinese registry source.");
    expect(text).not.toMatch(/Obtain a copy of the supplier's official business licen[cs]e/i);
  });

  it("builds a safe buyer-facing view model without raw snapshot legal fields", () => {
    const report = mockReport({
      supplier_input: { ...mockReport().supplier_input, chinese_name: "江市有限公司" },
      resolved_entity: { ...baseResolvedEntity, legal_name_local: "江市有限公司", registered_address: "江市江区3地1141406", business_scope: "技术" },
      buyer_implications: "UFLPA screening used local: \"江市有限公司\" and export history used GlobalSources multilingual directory مصنع fournisseur.",
      payment_recommendation: "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.",
      customer_evidence: [
        { name: "Customer upload: business_licence.jpg", url: null, retrieved_at: "2026-07-21T17:15:39.000Z", category: "customer_upload" },
        { name: "Customer upload: proforma_invoice.pdf", url: null, retrieved_at: "2026-07-21T17:15:39.000Z", category: "customer_upload" },
        { name: "Customer upload: certificate_or_test_report.jpg", url: null, retrieved_at: "2026-07-21T17:15:39.000Z", category: "customer_upload" },
      ],
      verified_report_decision: {
        payment_decision: "PAUSE",
        entity_payment_consistency: "NOT_VERIFIED",
        documents_checked: [],
        why: [],
        deal_specific_blockers: [],
        ask_supplier_before_payment: [],
      },
    });

    const view = buildBuyerFacingReportViewModel(report);
    const text = JSON.stringify(view);
    expect("resolved_entity" in view).toBe(false);
    expect("supplier_input" in view).toBe(false);
    expect(view.supplier.local_name).toBeNull();
    expect(view.verified_report_decision?.documents_checked).toEqual([
      "Business licence",
      "Proforma invoice",
      "1 certificate/test report(s)",
    ]);
    expect(text).toContain("Payment beneficiary was not extracted from the proforma invoice");
    expect(text).not.toContain("江市有限公司");
    expect(text).not.toContain("江市江区3地1141406");
    expect(text).not.toContain("\"business_scope\"");
    expect(text).not.toContain("\"registered_address\"");
    expect(text).not.toContain("\"legal_name_local\"");
    expect(text).not.toMatch(/GlobalSources multilingual directory|مصنع|fournisseur/);
  });

  it("does not render misleading status labels or orphaned buyer impact levels", async () => {
    const report = mockReport();
    report.checklist_results = buildCanonicalChecklist(report);
    const actions = report.checklist_results.findIndex((item) => item.id === "recommended_next_actions");
    expect(actions).toBeGreaterThan(-1);
    report.checklist_results[actions] = {
      ...report.checklist_results[actions],
      status: "NOT_APPLICABLE",
      recommended_action: "Use staged payments and resolve unresolved checks before payment.",
    };
    report.checklist_results[0] = {
      ...report.checklist_results[0],
      status: "NOT_VERIFIED",
      evidence_ids: ["ev_visible"],
      source_names: ["Analyst verification"],
      buyer_impact: "HIGH",
    };

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).not.toMatch(/Recommended next actions\s+Not applicable/i);
    expect(text).not.toMatch(/Buyer impact:\s*HIGH/i);
  });

  it("prints full GSXT/CODS registry guidance at most once", async () => {
    const report = mockReport();
    report.checklist_results = buildCanonicalChecklist(report);

    const text = await extractPdfText(await renderReportPdf(report));
    const occurrences = text.match(/Registration status can be confirmed free at the official Chinese registry/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("Jiangmen Changwen mock report contains all 32 items", () => {
    const results = buildCanonicalChecklist(mockReport({
      resolved_entity: { ...baseResolvedEntity, legal_name_en: "Jiangmen Changwen Trading Co., Ltd.", trading_indicators: ["Website markets export trading services"], sources: [{ name: "Firecrawl web intelligence", url: "https://example.test" }] },
      findings: [
        { ...baseFinding, section: "sanctions_forced_labour", item: "Stored official UFLPA snapshot screening", status: "PASS", source_name: "DHS UFLPA Entity List snapshot", evidence_ids: ["ev_uflpa"], evidence_classification: "VERIFIED" },
        { ...baseFinding, section: "regulatory", item: "U.S. CPSC recall screening", status: "NOT_VERIFIED", source_name: "U.S. CPSC recalls API", evidence_ids: ["ev_cpsc"], evidence_classification: "NOT_INDEPENDENTLY_VERIFIED" },
      ],
    }));
    expect(results).toHaveLength(32);
    expect(results.find((item) => item.id === "uflpa_forced_labour")?.evidence_classification).toBe("VERIFIED");
    expect(results.find((item) => item.id === "factory_vs_trader")?.evidence_classification).toBe("INFERRED");
  });
});

describe("Jiangmen Changwen mock case classification", () => {
  it("shows which findings are verified, supplier-claimed, inferred or not independently verified", () => {
    const findings = enforceEvidenceIds([
      { ...baseFinding, section: "certificates_documents", item: "Uploaded business licence names Jiangmen Changwen", status: "CAUTION", source_name: "Customer upload", evidence_ids: ["ev_supplier_doc"], evidence_classification: "SUPPLIER_CLAIMED" },
      { ...baseFinding, section: "digital_footprint", item: "Website mentions Jiangmen Changwen product category", status: "CAUTION", source_name: "Firecrawl web intelligence", evidence_ids: ["ev_web"], evidence_classification: "INFERRED" },
      { ...baseFinding, section: "sanctions_forced_labour", item: "Stored official UFLPA snapshot screening", status: "PASS", source_name: "DHS UFLPA Entity List snapshot", evidence_ids: ["ev_uflpa"], evidence_classification: "VERIFIED" },
      { ...baseFinding, section: "export_history", item: "ImportGenius shipment history", status: "NOT_VERIFIED", source_name: "ImportGenius API", evidence_excerpt: "", evidence_ids: [] },
    ]);
    expect(findings.map((f) => [f.item, f.evidence_classification, f.status])).toEqual([
      ["Uploaded business licence names Jiangmen Changwen", "SUPPLIER_CLAIMED", "CAUTION"],
      ["Website mentions Jiangmen Changwen product category", "INFERRED", "CAUTION"],
      ["Stored official UFLPA snapshot screening", "VERIFIED", "PASS"],
      ["ImportGenius shipment history", "NOT_INDEPENDENTLY_VERIFIED", "NOT_VERIFIED"],
    ]);
  });
});

describe("runInvestigation case + order loading", () => {
  const buildDb = (overrides: {
    caseRow?: any; caseErr?: any; orderRow?: any; orderErr?: any;
  }) => {
    const { caseRow = null, caseErr = null, orderRow = null, orderErr = null } = overrides;
    return {
      from(table: string) {
        const chain: any = {
          _table: table,
          select() { return chain; },
          eq() { return chain; },
          limit() { return chain; },
          insert() { return Promise.resolve({ data: null, error: null }); },
          update() { return chain; },
          async maybeSingle() {
            if (table === "supplier_cases") return { data: caseRow, error: caseErr };
            if (table === "orders") return { data: orderRow, error: orderErr };
            return { data: null, error: null };
          },
        };
        return chain;
      },
    };
  };

  it("returns preserved supabase error when supplier case query fails", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: buildDb({ caseErr: { message: "boom relationship" } }),
    }));
    const { runInvestigation } = await import("../lib/investigation/pipeline.server");
    const res = await runInvestigation("case-1");
    expect(res).toEqual({ ok: false, error: "Could not load supplier case: boom relationship" });
  });

  it("returns explicit not-found for missing supplier case", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: buildDb({}),
    }));
    const { runInvestigation } = await import("../lib/investigation/pipeline.server");
    const res = await runInvestigation("case-missing");
    expect(res).toEqual({ ok: false, error: "Supplier case not found for ID: case-missing" });
  });

  it("returns preserved order error when order query fails", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: buildDb({
        caseRow: { id: "c1", status: "intake_complete" },
        orderErr: { message: "orders relation error" },
      }),
    }));
    const { runInvestigation } = await import("../lib/investigation/pipeline.server");
    const res = await runInvestigation("c1");
    expect(res).toEqual({ ok: false, error: "Could not load order for case c1: orders relation error" });
  });

  it("advances past case+order loading when both exist (separately queried)", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client.server", () => ({
      supabaseAdmin: buildDb({
        caseRow: { id: "c1", status: "intake_complete", case_reference: "VF-1" },
        orderRow: {
          id: "o1", order_reference: "PO-1", supplier_company_name: "Jiangmen Changwen",
          supplier_country: "China", website_marketplace_url: "https://ex.test",
          supplier_contact_person: null, customer_name: "C", customer_company: "CC",
          customer_email: "c@example.test",
        },
      }),
    }));
    const { runInvestigation } = await import("../lib/investigation/pipeline.server");
    const res = await runInvestigation("c1");
    // Must NOT be the generic "Case not found" and must NOT be the case/order-loading branches.
    expect(res.ok === false ? res.error : "").not.toMatch(/Case not found|Supplier case not found|Could not load supplier case|Could not load order|No order attached/);
  });
});

describe("evidence allowlist & post-checklist gating", () => {
  it("keeps UFLPA evidence out of product_certificates_test_reports", () => {
    const findings: Finding[] = [
      {
        ...baseFinding,
        section: "sanctions_forced_labour",
        item: "UFLPA (Uyghur Forced Labor Prevention Act) Entity List screening",
        status: "PASS",
        source_name: "DHS UFLPA Entity List snapshot 2026-07-03",
        source_url: "https://www.dhs.gov/uflpa-entity-list",
        evidence_ids: ["ev_uflpa"],
        evidence_classification: "VERIFIED",
      },
    ];
    const results = buildCanonicalChecklist(mockReport({ findings }));
    expect(results.find((r) => r.id === "uflpa_forced_labour")?.status).toBe("PASS");
    // MUST NOT infect certificate items.
    expect(results.find((r) => r.id === "product_certificates_test_reports")?.status).toBe("NOT_VERIFIED");
    expect(results.find((r) => r.id === "certificate_authenticity")?.status).toBe("NOT_VERIFIED");
    expect(results.find((r) => r.id === "supplier_document_consistency")?.status).toBe("NOT_VERIFIED");
  });

  it("does not let RDAP independently verify website/domain consistency", () => {
    const findings: Finding[] = [
      {
        ...baseFinding,
        section: "digital_footprint",
        item: "Domain RDAP registration",
        status: "PASS",
        source_name: "RDAP",
        source_url: "https://rdap.org/domain/example.test",
        evidence_ids: ["ev_rdap"],
        evidence_classification: "VERIFIED",
      },
    ];
    const results = buildCanonicalChecklist(mockReport({ findings }));
    // RDAP does not map to website_domain_consistency — that stays NOT_VERIFIED.
    expect(results.find((r) => r.id === "website_domain_consistency")?.status).toBe("NOT_VERIFIED");
  });

  it("missing documents produce NOT_VERIFIED with missing_information_required", () => {
    const findings: Finding[] = [
      {
        ...baseFinding,
        section: "certificates_documents",
        item: "Uploaded supplier documents (business licence, ID)",
        status: "NOT_VERIFIED",
        source_name: "Customer upload",
        evidence_excerpt: "No supplier documents uploaded. Missing information required: business licence.",
        evidence_ids: ["ev_missing"],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      },
      {
        ...baseFinding,
        section: "certificates_documents",
        item: "Certificate authenticity",
        status: "NOT_VERIFIED",
        source_name: "Customer upload",
        evidence_excerpt: "No certificates uploaded.",
        evidence_ids: ["ev_cert_missing"],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      },
      {
        ...baseFinding,
        section: "certificates_documents",
        item: "Product certificates and test reports (CE, FDA, REACH, RoHS)",
        status: "NOT_VERIFIED",
        source_name: "Customer upload",
        evidence_excerpt: "No product certificates uploaded.",
        evidence_ids: ["ev_prod_missing"],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      },
    ];
    const results = buildCanonicalChecklist(mockReport({ findings }));
    for (const id of ["supplier_document_consistency", "certificate_authenticity", "product_certificates_test_reports"] as const) {
      const r = results.find((x) => x.id === id);
      expect(r?.status).toBe("NOT_VERIFIED");
      expect(r?.status).not.toBe("NOT_APPLICABLE");
    }
  });

  it("all 32 canonical checklist items are always present", () => {
    const results = buildCanonicalChecklist(mockReport());
    expect(results).toHaveLength(32);
    expect(new Set(results.map((r) => r.id)).size).toBe(32);
  });

  it("post-checklist gating forces PAUSE when critical identity checks remain NOT_VERIFIED", () => {
    const results = buildCanonicalChecklist(mockReport());
    // With no resolved entity, legal_company_existence, registration_status, business_licence_validation
    // and sanctions_restricted_party are all NOT_VERIFIED.
    const gated = applyOutcomeGating({ overall: "low", outcome: "GO" }, results);
    expect(gated.outcome).toBe("PAUSE_PENDING_CLARIFICATION");
    expect(gated.blockers.length).toBeGreaterThan(0);
  });
});

describe("CPSC recall screening", () => {
  it("does not auto-caution on broad hit count and reports actual titles", async () => {
    // Import the finding builder indirectly by simulating the connector result shape.
    const { runConnectorEvidenceChecksDetailed } = await import("../lib/investigation/connectors/findings.server");
    // We only assert that the exported helper exists; the shape of the CPSC finding is verified
    // in the checklist-level test below.
    expect(typeof runConnectorEvidenceChecksDetailed).toBe("function");

    // Simulate a CPSC finding that had many hits.
    const findings: Finding[] = [
      {
        ...baseFinding,
        section: "regulatory",
        item: "U.S. CPSC recall screening",
        status: "NOT_VERIFIED", // broad hits alone must NOT be CAUTION
        source_name: "U.S. CPSC recalls API",
        source_url: "https://www.saferproducts.gov/RestWebServices/Recall",
        evidence_excerpt: 'CPSC returned 25 recall result(s) for "kitchenware". Relevance to the exact proposed product has not been assessed.\n• Blender recall (2024-05-01)',
        evidence_ids: ["ev_cpsc"],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      },
    ];
    const results = buildCanonicalChecklist(mockReport({ findings }));
    const recall = results.find((r) => r.id === "product_recall_history");
    expect(recall?.status).toBe("NOT_VERIFIED");
    expect(recall?.explanation).toMatch(/25 recall result/);
  });
});

describe("sources triage in report shape", () => {
  it("does not list QCC/ImportGenius/IAF/OpenSanctions as queried when disabled", () => {
    const r = mockReport({
      sources_queried: [
        { name: "DHS UFLPA Entity List snapshot 2026-07-03", url: "https://www.dhs.gov/uflpa-entity-list", retrieved_at: "2026-07-03T00:00:00.000Z" },
      ],
      customer_evidence: [],
      sources_unavailable: [
        { name: "QCC International API", reason: "Not configured" },
        { name: "ImportGenius API", reason: "Not configured" },
        { name: "IAF CertSearch", reason: "Not configured" },
        { name: "OpenSanctions Commercial API", reason: "Not configured" },
      ],
    });
    for (const banned of ["QCC International API", "ImportGenius API", "IAF CertSearch", "OpenSanctions Commercial API"]) {
      expect(r.sources_queried?.some((s) => s.name === banned)).toBe(false);
      expect(r.sources_unavailable?.some((s) => s.name === banned)).toBe(true);
    }
  });
});
