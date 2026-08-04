import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderReportPdf } from "../lib/investigation/pdf.server";
import { buildBuyerFacingReportViewModel, CJK_SOURCE_PRESENT_NOT_DISPLAYED } from "../lib/investigation/report-sanitizer";
import {
  buildManusSupplierResearchPrompt,
  parseManusResearchOutput,
  runManusSupplierResearch,
} from "../lib/investigation/sources/manus-research.server";
import type { InvestigationReport } from "../lib/investigation/types";

const supplierInput = {
  supplierName: "Yangjiang Justa Industry & Trade Co., Ltd.",
  supplierCountry: "China",
  website: "https://justa.example",
  marketplaceUrl: "https://alibaba.example/yangjiang-justa",
  productCategory: "kitchenware",
  destinationMarket: "United States",
  estimatedOrderValue: "25000",
  paymentConcerns: "Confirm bank beneficiary before paying.",
};

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

function reportWithManus(manus: InvestigationReport["manus_research"]): InvestigationReport {
  return {
    generated_at: "2026-07-30T00:00:00.000Z",
    order_reference: "VF-TEST-MANUS",
    case_reference: "VFC-TEST-MANUS",
    supplier_input: {
      name: supplierInput.supplierName,
      chinese_name: null,
      country: "China",
      url: supplierInput.website,
      contact: null,
    },
    customer_input: {
      name: "Alex Buyer",
      company: "Buyer Co",
      email: "buyer@example.test",
      destination_market: "United States",
      estimated_order_value: "25000",
      product_category: "kitchenware",
      concerns: "Payment beneficiary",
    },
    resolved_entity: {
      matched: true,
      legal_name_en: "YANGJIANG JUSTA INDUSTRY & TRADE CO.,LTD",
      legal_name_local: null,
      registration_number: "91441702553600081W",
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
      confidence: "medium",
      sources: [],
      notes: "Test report",
    },
    findings: [],
    checklist_results: [],
    overall_risk_rating: "high",
    final_outcome: "PAUSE_PENDING_CLARIFICATION",
    executive_summary: "Verified report test.",
    key_findings: [],
    buyer_implications: "Resolve gaps before payment.",
    recommended_safeguards: "Confirm official records and payment beneficiary.",
    payment_recommendation: "Pause.",
    inspection_recommendation: "Inspect before shipment.",
    testing_recommendation: "Verify certificates with issuer.",
    methodology: "Strict buyer-facing report.",
    limitations: "Missing evidence remains not verified.",
    sources_used: [],
    customer_evidence: [
      { name: "Customer upload: business_licence.png", url: null, retrieved_at: "2026-07-30T00:00:00.000Z", category: "business_licence" },
      { name: "Customer upload: proforma_invoice.pdf", url: null, retrieved_at: "2026-07-30T00:00:00.000Z", category: "proforma_invoice" },
    ],
    verified_report_decision: {
      payment_decision: "PAUSE",
      entity_payment_consistency: "NOT_VERIFIED",
      documents_checked: ["Business licence", "Proforma invoice"],
      why: ["Payment beneficiary/account holder was not visible/provided in the uploaded proforma invoice — cannot confirm payee matches licence holder."],
      deal_specific_blockers: [],
      ask_supplier_before_payment: ["Confirm payment beneficiary/account holder before paying."],
    },
    manus_research: manus,
  };
}

describe("Manus deep research integration", () => {
  it("creates a task with the strict evidence-bound supplier research prompt", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") return { ok: true, json: async () => ({ id: "manus-task-1", status: "completed" }) } as Response;
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          output: { claims: [] },
        }),
      } as Response;
    });

    await runManusSupplierResearch(supplierInput, {
      env: { MANUS_ENABLED: "true", MANUS_API_KEY: "secret-key", MANUS_API_BASE_URL: "https://manus.test", MANUS_TIMEOUT_SECONDS: "1" },
      fetch: fetchMock as any,
      sleep: async () => {},
      now: "2026-07-30T00:00:00.000Z",
    });

    expect(calls[0].url).toBe("https://manus.test/v1/tasks");
    expect((calls[0].init?.headers as Record<string, string>)["x-manus-api-key"]).toBe("secret-key");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.prompt).toContain("exact_text_read_from_source");
    expect(body.prompt).toContain("supplier marketing claims");
    expect(body.prompt).toContain(supplierInput.supplierName);
    expect(body.prompt).toContain("Confirm bank beneficiary");
  });

  it("keeps MANUS_API_KEY out of client routes and components", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(path)) files.push(path);
      }
    };
    walk(join(root, "routes"));
    walk(join(root, "components"));
    expect(files.some((file) => readFileSync(file, "utf8").includes("MANUS_API_KEY"))).toBe(false);
  });

  it("accepts only evidence-bound claims and separates supplier marketing claims", () => {
    const parsed = parseManusResearchOutput({
      claims: [
        {
          claim: "Yangjiang Justa profile lists kitchenware products.",
          exact_text_read_from_source: "Yangjiang Justa Industry & Trade Co., Ltd. kitchenware supplier profile",
          source_url: "https://platform.example/yangjiang-justa",
          source_title: "Yangjiang Justa company profile",
          source_domain: "platform.example",
          source_type: "marketplace_platform_recorded_data",
          retrieved_at: "2026-07-30T00:00:00.000Z",
          limitation: "Marketplace profile is platform-recorded/self-presented, not official registry verification.",
          buyer_implication: "Supports online presence only.",
        },
        {
          claim: "Uncited factual claim.",
          source_url: "https://example.test/missing-text",
          source_type: "third_party_database",
        },
        {
          claim: "Missing URL claim.",
          exact_text_read_from_source: "Yangjiang Justa appears here",
          source_type: "third_party_database",
        },
        {
          claim: "Supplier website says it is a leading manufacturer.",
          exact_text_read_from_source: "We are a leading manufacturer",
          source_url: "https://justa.example/about",
          source_type: "supplier_marketing_claim",
        },
      ],
      buyer_interpretations: ["Ask the supplier to confirm bank beneficiary."],
      questions_before_payment: ["Who is the payment beneficiary/account holder?"],
    }, supplierInput, "2026-07-30T00:00:00.000Z");

    expect(parsed.accepted_claims).toHaveLength(1);
    expect(parsed.accepted_claims[0].source_type).toBe("marketplace_platform_recorded_data");
    expect(parsed.rejected_reason_counts.rejected_missing_exact_text).toBe(1);
    expect(parsed.rejected_reason_counts.rejected_missing_source).toBe(1);
    expect(parsed.rejected_reason_counts.rejected_supplier_claim_only).toBe(1);
    expect(parsed.supplier_marketing_claims).toHaveLength(1);
    expect(parsed.questions_before_payment).toContain("Who is the payment beneficiary/account holder?");
  });

  it("falls back safely when Manus is disabled or fails", async () => {
    const disabled = await runManusSupplierResearch(supplierInput, { env: { MANUS_ENABLED: "false" }, now: "2026-07-30T00:00:00.000Z" });
    expect(disabled.report.status).toBe("not_configured");
    expect(disabled.findings).toHaveLength(0);

    const failed = await runManusSupplierResearch(supplierInput, {
      env: { MANUS_ENABLED: "true", MANUS_API_KEY: "secret-key" },
      fetch: vi.fn(async () => { throw new Error("network down"); }) as any,
      now: "2026-07-30T00:00:00.000Z",
    });
    expect(failed.report.status).toBe("failed");
    expect(failed.findings).toHaveLength(0);
  });

  it("renders accepted Manus claims in the PDF without raw output or unsupported official-verification claims", async () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Yangjiang Justa marketplace profile lists cookware products.",
        exact_text_read_from_source: "Yangjiang Justa Industry & Trade Co., Ltd. cookware products",
        source_url: "https://platform.example/yangjiang-justa",
        source_title: "Yangjiang Justa profile",
        source_domain: "platform.example",
        source_type: "marketplace_platform_recorded_data",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "Marketplace profile is not official registry verification.",
        buyer_implication: "Supports online business presence only.",
      }],
      questions_before_payment: ["Ask for the certificate issuer verification link."],
      raw_markdown: "RAW MANUS OUTPUT SHOULD NEVER RENDER",
    }, supplierInput, "2026-07-30T00:00:00.000Z");
    parsed.raw_output_storage_path = "cases/internal/manus.json";

    const text = await extractPdfText(await renderReportPdf(reportWithManus(parsed)));
    expect(text).toContain("Deep research dossier");
    expect(text).toContain("Yangjiang Justa marketplace profile lists cookware products.");
    expect(text).toContain("Marketplace profile is not official registry verification.");
    expect(text).toContain("Ask for the certificate issuer verification link.");
    expect(text).not.toContain("RAW MANUS OUTPUT");
    expect(text).not.toContain("official government registry");
    expect(text).not.toContain("official verification succeeded");
  });

  it("rejects corrupted CJK Manus claims before they reach buyer rendering", () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Company is officially registered as 江市 有限公司 with USCC 91441702553600081W.",
        exact_text_read_from_source: "Tianyancha snippet: 江市 有限公司 91441702553600081W",
        source_url: "https://www.tianyancha.com/search?key=Yangjiang%20Justa",
        source_title: "Tianyancha registry snippet",
        source_domain: "tianyancha.com",
        source_type: "commercial_registry_aggregator",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "Tianyancha snippet only.",
        buyer_implication: "Official active status confirmed.",
      }],
    }, supplierInput, "2026-07-30T00:00:00.000Z");

    expect(parsed.accepted_claims).toHaveLength(0);
    expect(parsed.rejected_reason_counts.rejected_corrupted_cjk).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain("江市 有限公司");
  });

  it("rewrites commercial registry official-overclaim language for accepted Manus claims", () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Company is officially registered as 阳江市佳仕达工贸有限公司 with USCC 91441702553600081W.",
        exact_text_read_from_source: "Tianyancha lists Yangjiang Justa Industry & Trade Co., Ltd. and USCC 91441702553600081W.",
        source_url: "https://www.tianyancha.com/company/123",
        source_title: "Tianyancha registry snippet",
        source_domain: "tianyancha.com",
        source_type: "commercial_registry_aggregator",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "Commercial registry aggregator result, not GSXT.",
        buyer_implication: "Officially verified active company.",
      }],
    }, supplierInput, "2026-07-30T00:00:00.000Z");

    expect(parsed.accepted_claims).toHaveLength(1);
    expect(parsed.accepted_claims[0].claim).toContain("Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W");
    expect(parsed.accepted_claims[0].limitation).toBe("This is commercial registry/search-snippet evidence, not official GSXT verification.");
    expect(parsed.accepted_claims[0].claim).not.toMatch(/officially registered|officially verified|active company confirmed/i);
    expect(parsed.accepted_claims[0].buyer_implication).not.toMatch(/officially verified|official active status confirmed/i);
  });

  it("uses the same CJK safety filter for Manus claims, document tables and comparison rows", async () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W.",
        exact_text_read_from_source: "Tianyancha lists Yangjiang Justa Industry & Trade Co., Ltd. and USCC 91441702553600081W.",
        source_url: "https://www.tianyancha.com/company/123",
        source_title: "Tianyancha registry snippet",
        source_domain: "tianyancha.com",
        source_type: "commercial_registry_aggregator",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "This has not been verified against China's official GSXT registry.",
        buyer_implication: "Use as supporting registry-snippet context only.",
      }],
      questions_before_payment: ["Confirm the uploaded business licence against GSXT/CODS."],
    }, supplierInput, "2026-07-30T00:00:00.000Z");
    const report = reportWithManus(parsed);
    report.verified_report_document_summary = [
      {
        document_type: "business_licence",
        label: "Business licence",
        source: "Business licence",
        fields: [
          { label: "Chinese legal name", value: "江市 有限公司", status: "extracted" },
          { label: "Registered address", value: "阳江市江", status: "extracted" },
          { label: "Registered address", value: "江市江 区 3 地1 14 1406", status: "extracted" },
        ],
      },
    ];
    report.verified_report_comparison = [
      { label: "Business licence company name", value_found: "江市 有限公司", source: "Business licence", match_status: "MISMATCH", buyer_impact: "Compare against official registry." },
      { label: "Registered address", value_found: "阳江市江", source: "Business licence", match_status: "MISMATCH", buyer_impact: "Address extraction is incomplete." },
      { label: "Certificate holder/applicant", value_found: "阳江市佳仕达工贸有限公司", source: "Certificate/test report", match_status: "MATCH", buyer_impact: "Holder name is source-bound." },
    ];

    const view = buildBuyerFacingReportViewModel(report);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/江市\s*有限公司|江市江\s*区\s*3\s*地1\s*14\s*1406|阳江市江/);
    expect(serialized).toContain("Could not be reliably extracted");
    expect(serialized).toContain("Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W");
    expect(serialized).not.toMatch(/officially registered|officially verified active company|active company confirmed/i);
    expect(view.verified_report_document_summary.flatMap((doc) => doc.fields).find((field) => field.label === "Registered address")?.value).toBe("Could not be reliably extracted");
    expect(view.verified_report_comparison.find((row) => row.label === "Registered address")?.value_found).toBe("Could not be reliably extracted");
    expect(view.verified_report_comparison.find((row) => row.label === "Registered address")?.match_status).toBe("CANNOT CONFIRM");
    expect(view.verified_report_comparison.find((row) => row.label === "Certificate holder/applicant")?.value_found).toBe("阳江市佳仕达工贸有限公司");

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).not.toMatch(/江市\s*有限公司|江市江\s*区\s*3\s*地1\s*14\s*1406|阳江市江/);
    expect(text).toContain("Could not be reliably extracted");
    expect(text).toContain("Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W");
    expect(text).not.toMatch(/officially registered|officially verified active company|active company confirmed/i);
  });

  it("renders known valid Chinese safely or explicitly suppresses it without degrading into corrupted text", async () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Commercial registry aggregator reports 阳江市佳仕达工贸有限公司 for Yangjiang Justa.",
        exact_text_read_from_source: "阳江市佳仕达工贸有限公司 Yangjiang Justa Industry & Trade Co., Ltd.",
        source_url: "https://www.tianyancha.com/company/123",
        source_title: "Tianyancha registry snippet",
        source_domain: "tianyancha.com",
        source_type: "commercial_registry_aggregator",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "Commercial registry aggregator result, not official GSXT.",
        buyer_implication: "Use only as source-cited registry-snippet context.",
      }],
    }, supplierInput, "2026-07-30T00:00:00.000Z");

    const text = await extractPdfText(await renderReportPdf(reportWithManus(parsed)));
    expect(text).toMatch(new RegExp(`阳江市佳仕达工贸有限公司|${CJK_SOURCE_PRESENT_NOT_DISPLAYED}`));
    expect(text).not.toContain("江市 有限公司");
    expect(text).not.toContain("江市有限公司");
  });

  it("keeps verified-report sections consistent when licence and deep research evidence are useful but non-official", async () => {
    const parsed = parseManusResearchOutput({
      claims: [
        {
          claim: "Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W for 阳江市佳仕达工贸有限公司.",
          exact_text_read_from_source: "阳江市佳仕达工贸有限公司 统一社会信用代码 91441702553600081W",
          source_url: "https://www.tianyancha.com/company/yangjiang-justa",
          source_title: "Tianyancha registry snippet",
          source_domain: "tianyancha.com",
          source_type: "commercial_registry_aggregator",
          retrieved_at: "2026-07-30T00:00:00.000Z",
          limitation: "Commercial registry aggregator result, not official GSXT verification.",
          buyer_implication: "Supports entity consistency only; confirm against GSXT/CODS before payment.",
        },
        {
          claim: "Alibaba profile lists Yangjiang Justa as a 16-year Gold Supplier with kitchenware products.",
          exact_text_read_from_source: "Yangjiang Justa Industry & Trade Co., Ltd. 16-year Gold Supplier cookware kitchenware",
          source_url: "https://yangjiang-justa.en.alibaba.com",
          source_title: "Yangjiang Justa Alibaba profile",
          source_domain: "alibaba.com",
          source_type: "marketplace_platform_recorded_data",
          retrieved_at: "2026-07-30T00:00:00.000Z",
          limitation: "Marketplace profile is platform-recorded/self-presented, not official registry verification.",
          buyer_implication: "Supports online marketplace presence but does not clear payment risk.",
        },
        {
          claim: "ImportGenius records indicate shipment traces connected to Yangjiang Justa and DOIY.",
          exact_text_read_from_source: "Yangjiang Justa Industry & Trade Co., Ltd. shipment DOIY",
          source_url: "https://www.importgenius.com/suppliers/yangjiang-justa",
          source_title: "ImportGenius supplier shipment trace",
          source_domain: "importgenius.com",
          source_type: "trade_data",
          retrieved_at: "2026-07-30T00:00:00.000Z",
          limitation: "Trade-data/public source material, not VerifyFirst's licensed production shipment connector.",
          buyer_implication: "Provides shipment context but should not be treated as complete shipment verification.",
        },
      ],
      questions_before_payment: ["Confirm payment beneficiary/account holder before paying."],
    }, supplierInput, "2026-07-30T00:00:00.000Z");

    const report = reportWithManus(parsed);
    report.public_web_intelligence = {
      generated_at: "2026-07-30T00:00:00.000Z",
      queries_run: ["Yangjiang Justa cookware"],
      evidence: [],
      what_found_online: [],
      what_this_corroborates: [],
      still_not_verified: ["Company registration/status has not been officially verified."],
      potential_contradictions: [],
      buyer_impact: "Generic open-web scouting produced no extra retained sources.",
      recommended_next_actions: ["Confirm official registry, certificate and payment-document gaps before payment."],
      diagnostics: {
        searches_run: 1,
        sources_found: 0,
        retained_sources: 0,
        rejected_sources: 0,
        matched_identifiers: [],
      },
    };
    report.verified_report_document_summary = [
      {
        document_type: "business_licence",
        label: "Business licence",
        source: "Uploaded business licence",
        fields: [
          { label: "Chinese legal name", value: "阳江市佳仕达工贸有限公司", status: "extracted" },
          { label: "USCC / registration number", value: "91441702553600081W", status: "extracted" },
          { label: "Registered address", value: "Could not be reliably extracted", status: "uncertain" },
        ],
      },
    ];

    const view = buildBuyerFacingReportViewModel(report);
    const serialized = JSON.stringify(view);
    expect(view.legal_entity_summary.chinese_legal_name).toBe("阳江市佳仕达工贸有限公司");
    expect(view.legal_entity_summary.registry_corroboration).toContain("Uploaded licence lists 阳江市佳仕达工贸有限公司 with USCC 91441702553600081W");
    expect(view.shipment_history_summary).toContain("Shipment-history evidence was identified from trade-data/public source material");
    expect(view.public_web_source_summaries.some((source) => /Alibaba|ImportGenius|Tianyancha/i.test(source.source_name))).toBe(true);
    expect(serialized).not.toContain("No supplier-linked public web sources met the relevance threshold");
    expect(serialized).not.toContain("No reliable shipment-history evidence identified from public sources.");
    expect(view.manus_material_contradictions.join("\n")).not.toMatch(/16-year Gold Supplier|ImportGenius records indicate shipment traces/);
    expect(serialized).not.toMatch(/officially registered|officially verified active company|active company confirmed|evidence_ids|RAW MANUS OUTPUT|exact_text_read_from_source":"[^"]/i);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("阳江市佳仕达工贸有限公司");
    expect(text).toContain("Uploaded licence lists 阳江市佳仕达工贸有限公司 with USCC 91441702553600081W");
    expect(text).toContain("Shipment-history evidence was identified from trade-data/public source material");
    expect(text).toContain("No material contradiction was identified from validated evidence");
    expect(text).not.toContain("Chinese legal name: Could not be reliably extracted");
    expect(text).not.toContain("No supplier-linked public web sources met the relevance threshold");
    expect(text).not.toContain("No reliable shipment-history evidence identified from public sources.");
    expect(text).not.toMatch(/Material contradictions .*16-year Gold Supplier/i);
    expect(text).not.toMatch(/officially registered|officially verified active company|active company confirmed|evidence_ids|RAW MANUS OUTPUT/i);
  });

  it("suppresses stray registered-capital OCR and stale CJK-display language in buyer reports", async () => {
    const parsed = parseManusResearchOutput({
      claims: [
        {
          claim: "Commercial registry/search-snippet data reports USCC 91441702553600081W for Yangjiang Justa. Chinese legal name was present in source material but is not displayed because rendering reliability could not be confirmed.)",
          exact_text_read_from_source: "阳江市佳仕达工贸有限公司 统一社会信用代码 91441702553600081W",
          source_url: "https://www.tianyancha.com/company/yangjiang-justa",
          source_title: "Tianyancha registry snippet",
          source_domain: "tianyancha.com",
          source_type: "commercial_registry_aggregator",
          retrieved_at: "2026-07-30T00:00:00.000Z",
          limitation: "Commercial registry aggregator result, not official GSXT verification.",
          buyer_implication: "Supports entity consistency only; confirm against GSXT/CODS before payment.",
        },
        {
          claim: "ImportGenius records indicate shipment traces connected to Yangjiang Justa and DOIY.",
          exact_text_read_from_source: "Yangjiang Justa Industry & Trade Co., Ltd. shipment DOIY",
          source_url: "https://www.importgenius.com/suppliers/yangjiang-justa",
          source_title: "ImportGenius supplier shipment trace",
          source_domain: "importgenius.com",
          source_type: "trade_data",
          retrieved_at: "2026-07-30T00:00:00.000Z",
          limitation: "Trade-data/public source material, not VerifyFirst's licensed production shipment connector.",
          buyer_implication: "Provides shipment context but should not be treated as complete shipment verification.",
        },
      ],
    }, supplierInput, "2026-07-30T00:00:00.000Z");
    const report = reportWithManus(parsed);
    report.resolved_entity.registered_capital = "人";
    report.verified_report_document_summary = [
      {
        document_type: "business_licence",
        label: "Business licence",
        source: "Uploaded business licence",
        fields: [
          { label: "Chinese legal name", value: "阳江市佳仕达工贸有限公司", status: "extracted" },
          { label: "USCC / registration number", value: "91441702553600081W", status: "extracted" },
          { label: "Registered capital", value: "人", status: "extracted" },
        ],
      },
    ];
    report.verified_report_comparison = [
      { label: "Registered capital", value_found: "人", source: "Business licence", match_status: "MISMATCH", buyer_impact: "OCR output is unreliable." },
    ];

    const view = buildBuyerFacingReportViewModel(report);
    const serialized = JSON.stringify(view);
    expect(view.legal_entity_summary.chinese_legal_name).toBe("阳江市佳仕达工贸有限公司");
    expect(view.legal_entity_summary.registered_capital).toBe("Not independently verified");
    expect(view.verified_report_document_summary[0].fields.find((field) => field.label === "Registered capital")?.value).toBe("Could not be reliably extracted");
    expect(view.verified_report_comparison[0].value_found).toBe("Could not be reliably extracted");
    expect(view.verified_report_comparison[0].match_status).toBe("CANNOT CONFIRM");
    expect(view.shipment_history_summary).toContain("Shipment-history evidence was identified from trade-data/public source material");
    expect(view.manus_material_contradictions.join("\n")).not.toMatch(/ImportGenius records indicate shipment traces/);
    expect(serialized).toContain("阳江市佳仕达工贸有限公司");
    expect(serialized).toContain("This is commercial registry/search-snippet evidence, not official GSXT verification.");
    expect(serialized).not.toContain("Registered capital: 人");
    expect(serialized).not.toMatch(/not displayed because rendering reliability could not be confirmed|confirmed\.\)/i);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("阳江市佳仕达工贸有限公司");
    expect(text).toContain("Registered capital: Not independently verified");
    expect(text).toContain("This is commercial registry/search-snippet evidence, not official GSXT verification.");
    expect(text).toContain("Shipment-history evidence was identified from trade-data/public source material");
    expect(text).toContain("No material contradiction was identified from validated evidence");
    expect(text).not.toContain("Registered capital: 人");
    expect(text).not.toMatch(/not displayed because rendering reliability could not be confirmed|confirmed\.\)/i);
  });

  it("renders questions before payment from Manus objects as buyer-readable text", async () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W for 阳江市佳仕达工贸有限公司.",
        exact_text_read_from_source: "阳江市佳仕达工贸有限公司 统一社会信用代码 91441702553600081W",
        source_url: "https://www.tianyancha.com/company/yangjiang-justa",
        source_title: "Tianyancha registry snippet",
        source_domain: "tianyancha.com",
        source_type: "commercial_registry_aggregator",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "Commercial registry aggregator result, not official GSXT verification.",
        buyer_implication: "Supports entity consistency only; confirm against GSXT/CODS before payment.",
      }],
      questions_before_payment: [
        "Confirm the bank beneficiary/account holder before paying.",
        { question: "Ask whether the invoice seller and bank account holder are the same legal entity." },
        { text: "Request the supplier's current GSXT/CODS registry capture." },
        { nested: { body: "Ask for the certificate issuer verification link." } },
        { value: "   " },
        {},
      ],
    }, supplierInput, "2026-07-30T00:00:00.000Z");
    expect(parsed.questions_before_payment).toEqual([
      "Confirm the bank beneficiary/account holder before paying.",
      "Ask whether the invoice seller and bank account holder are the same legal entity.",
      "Request the supplier's current GSXT/CODS registry capture.",
      "Ask for the certificate issuer verification link.",
    ]);

    const report = reportWithManus(parsed);
    report.verified_report_document_summary = [{
      document_type: "business_licence",
      label: "Business licence",
      source: "Uploaded business licence",
      fields: [
        { label: "Chinese legal name", value: "阳江市佳仕达工贸有限公司", status: "extracted" },
        { label: "USCC / registration number", value: "91441702553600081W", status: "extracted" },
      ],
    }];
    report.manus_research!.questions_before_payment = [
      ...report.manus_research!.questions_before_payment,
      { title: "Confirm the proforma invoice payment beneficiary in writing." },
      { details: { value: "" } },
    ] as any;

    const view = buildBuyerFacingReportViewModel(report);
    const serialized = JSON.stringify(view);
    expect(view.manus_questions_before_payment).toContain("Confirm the proforma invoice payment beneficiary in writing.");
    expect(view.manus_questions_before_payment).not.toContain("[object Object]");
    expect(serialized).toContain("阳江市佳仕达工贸有限公司");
    expect(serialized).toContain("Ask whether the invoice seller and bank account holder are the same legal entity.");
    expect(serialized).toContain("Ask for the certificate issuer verification link.");
    expect(serialized).not.toContain("[object Object]");

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("Questions before payment");
    expect(text).toContain("Ask whether the invoice seller and bank account holder are the same legal entity.");
    expect(text).toContain("Request the supplier's current GSXT/CODS registry capture.");
    expect(text).toContain("Confirm the proforma invoice payment beneficiary in writing.");
    expect(text).toContain("阳江市佳仕达工贸有限公司");
    expect(text).not.toContain("[object Object]");
  });

  it("keeps final buyer-facing deep research language clean and non-contradictory", async () => {
    const parsed = parseManusResearchOutput({
      claims: [{
        claim: "Company is registered as YANGJIANG JUSTA INDUSTRY & TRADE CO.,LTD Chinese legal name was present in source material but is not displayed because rendering reliability could not be confirmed.) with USCC 91441702553600081W.",
        exact_text_read_from_source: "Qichacha lists Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W.",
        source_url: "https://www.qcc.com/firm/example",
        source_title: "总阳江市一人",
        source_domain: "qcc.com",
        source_type: "commercial_registry_aggregator",
        retrieved_at: "2026-07-30T00:00:00.000Z",
        limitation: "Qichacha commercial registry snippet, not GSXT.",
        buyer_implication: "Supports entity consistency only.",
      }],
      questions_before_payment: [{ question: "Confirm the payment beneficiary/account holder before paying." }],
    }, supplierInput, "2026-07-30T00:00:00.000Z");
    const report = reportWithManus(parsed);
    report.methodology = "Automated sources were checked; connectors remain disabled until credentials are supplied.";
    report.limitations = "QCC and ImportGenius connectors remain disabled until credentials are supplied.";
    report.public_web_intelligence = {
      generated_at: "2026-07-30T00:00:00.000Z",
      queries_run: ["Yangjiang Justa Qichacha USCC"],
      evidence: [],
      what_found_online: ["Qichacha/company identity search result found."],
      what_this_corroborates: ["No public-web fact was strong enough to corroborate supplier identity or operating claims."],
      still_not_verified: ["Corporate registry not officially verified."],
      potential_contradictions: [],
      buyer_impact: "Use non-official registry snippets only as supporting context.",
      recommended_next_actions: ["Confirm official registry, certificate and payment-document gaps before payment."],
      diagnostics: {
        searches_run: 1,
        sources_found: 1,
        retained_sources: 1,
        rejected_sources: 0,
        matched_identifiers: ["Yangjiang Justa", "91441702553600081W"],
      },
    };
    report.verified_report_document_summary = [{
      document_type: "business_licence",
      label: "Business licence",
      source: "Uploaded business licence",
      fields: [
        { label: "Chinese legal name", value: "阳江市佳仕达工贸有限公司", status: "extracted" },
        { label: "USCC / registration number", value: "91441702553600081W", status: "extracted" },
      ],
    }];

    const view = buildBuyerFacingReportViewModel(report);
    const serialized = JSON.stringify(view);
    expect(view.manus_evidence_summary[0].claim).toBe("Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W.");
    expect(view.manus_evidence_summary[0].limitation).toBe("This is commercial registry/search-snippet evidence, not official GSXT verification.");
    expect(view.manus_evidence_summary[0].source).toContain("Commercial registry/search-snippet source");
    expect(view.public_web_corroboration_summary).toContain("Supplier identity is corroborated by commercial registry/search-snippet evidence, but not officially verified via GSXT.");
    expect(serialized).toContain("Certain checks require licensed data sources or direct issuer/registry confirmation.");
    expect(serialized).toContain("阳江市佳仕达工贸有限公司");
    expect(serialized).not.toMatch(/Accepted Manus claims|Manus|总阳江市一人|No public-web fact was strong enough|connectors remain disabled|\[object Object\]/);
    expect(serialized).not.toMatch(/Company is registered as .*Commercial registry\/search-snippet evidence provided.* with USCC/i);

    const text = await extractPdfText(await renderReportPdf(report));
    expect(text).toContain("Validated deep-research findings");
    expect(text).toContain("Commercial registry/search-snippet evidence reports Yangjiang Justa Industry & Trade Co., Ltd. with USCC 91441702553600081W.");
    expect(text).toContain("This is commercial registry/search-snippet evidence, not official GSXT verification.");
    expect(text).toContain("Supplier identity is corroborated by commercial registry/search-snippet evidence, but not officially verified via GSXT.");
    expect(text).toContain("Certain checks require licensed data sources or direct issuer/registry confirmation.");
    expect(text).toContain("阳江市佳仕达工贸有限公司");
    expect(text).toContain("Confirm the payment beneficiary/account holder before paying.");
    expect(text).not.toMatch(/Accepted Manus claims|Manus|总阳江市一人|No public-web fact was strong enough|connectors remain disabled|\[object Object\]/);
    expect(text).not.toMatch(/Company is registered as .*Commercial registry\/search-snippet evidence provided.* with USCC/i);
  });
});
