import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderReportPdf } from "../lib/investigation/pdf.server";
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
      why: ["Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder."],
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

    expect(calls[0].url).toBe("https://manus.test/v2/tasks");
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
});
