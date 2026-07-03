import { describe, expect, it, vi } from "vitest";
import { enforceEvidenceIds } from "../lib/investigation/evidence.server";
import { connectorRegistry } from "../lib/investigation/connectors/registry.server";
import { jobIdempotencyKey, nextBackoff, testJobIdempotencyKey } from "../lib/investigation/job-queue.server";
import { assertTestInvestigationEnabled } from "../lib/investigation/test-runner.server";
import { verifyStripeSignature } from "../lib/payments/stripe-webhook.server";
import { buildCanonicalChecklist, CANONICAL_CHECKLIST, CHECKLIST_COUNT, detectChecklistContradictions, applyOutcomeGating } from "../lib/investigation/checklist";
import { renderReportPdf } from "../lib/investigation/pdf.server";
import type { Finding, InvestigationReport, ResolvedEntity } from "../lib/investigation/types";

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

describe("payment security", () => {
  it("keeps payment and test job idempotency server-side", () => {
    expect(jobIdempotencyKey("order-123")).toBe("stripe-paid:order-123");
    expect(testJobIdempotencyKey("order-123", "case-456")).toBe("test-investigation:order-123:case-456");
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
