import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { buildVerifiedReportConsistency, selectVerifiedReportEvidenceDocs, type VerifiedBusinessLicenceFields, type VerifiedInvoiceFields } from "../lib/investigation/verified-report.server";
import { demoInput } from "../lib/demo/demo.functions";
import { missingVerifiedReportDocuments, normalizeVerifiedReportDocumentCategory, submitVerifiedReportImpl, verifiedReportBypassEnabled, type SubmitVerifiedReportInput } from "../lib/verified-report.functions";
import type { ExtractedDoc } from "../lib/investigation/extract-documents.server";

const licence: VerifiedBusinessLicenceFields = {
  chineseLegalName: "华为技术有限公司",
  englishName: "Huawei Technologies Co., Ltd.",
  uscc: "914403001922038216",
  registeredAddress: "深圳市龙岗区坂田华为总部办公楼",
  legalRepresentative: "赵明路",
  businessScope: "通信设备、电子产品、厨房用品及金属制品的研发、生产、销售",
  licenceDate: "1998-03-01",
};

const invoice: VerifiedInvoiceFields = {
  issuerSellerEntity: "Huawei Technologies Co., Ltd.",
  beneficiaryName: "Huawei Technologies Co., Ltd.",
  bankAccountName: "Huawei Technologies Co., Ltd.",
  bankCountry: "China",
  invoiceAddress: "深圳市龙岗区坂田华为总部办公楼",
  currency: "USD",
  orderAmount: "25000",
  productDescription: "Kitchenware",
  buyerName: "Buyer Ltd",
};

function run(overrides: Partial<Parameters<typeof buildVerifiedReportConsistency>[0]> = {}) {
  return buildVerifiedReportConsistency({
    supplierName: "Huawei Technologies Co., Ltd.",
    website: "huawei.com",
    country: "China",
    productCategory: "kitchenware",
    destinationMarket: "United States",
    orderValue: "25000",
    businessLicence: licence,
    proformaInvoice: invoice,
    now: "2026-07-14T00:00:00.000Z",
    ...overrides,
  });
}

describe("Verified Supplier Report consistency engine", () => {
  it("makes a proceed-with-safeguards eligible decision for consistent licence and invoice with valid USCC", () => {
    const result = run();
    expect(result.finalOutcome).toBe("PROCEED_WITH_SAFEGUARDS");
    expect(result.decision.payment_decision).toBe("PROCEED");
    expect(result.decision.entity_payment_consistency).toBe("MATCH");
    expect(result.findings.find((finding) => finding.item === "Unified Social Credit Code")?.evidence_excerpt).toMatch(/structurally valid/);
    expect(result.findings.every((finding) => finding.evidence_classification !== "VERIFIED")).toBe(true);
  });

  it("pauses with exact request list when licence is missing", () => {
    const result = run({ businessLicence: null });
    expect(result.finalOutcome).toBe("PAUSE_PENDING_CLARIFICATION");
    expect(result.missingRequiredDocuments).toEqual(["Business licence"]);
    expect(result.decision.ask_supplier_before_payment).toContain("Request the supplier's business licence before payment.");
  });

  it("pauses with exact request list when invoice is missing", () => {
    const result = run({ proformaInvoice: null });
    expect(result.finalOutcome).toBe("PAUSE_PENDING_CLARIFICATION");
    expect(result.missingRequiredDocuments).toEqual(["Proforma invoice"]);
    expect(result.decision.ask_supplier_before_payment).toContain("Request the supplier's proforma invoice before payment.");
  });

  it("makes invalid business-licence USCC a fail blocker and No-Go", () => {
    const result = run({ businessLicence: { ...licence, uscc: "91440700MA4W123456" } });
    expect(result.finalOutcome).toBe("NO_GO");
    expect(result.decision.payment_decision).toBe("NO_GO");
    expect(result.decision.deal_specific_blockers).toContain("Business licence shows structurally invalid USCC — possible doctored or incorrect document.");
  });

  it("makes invoice beneficiary mismatch a No-Go", () => {
    const result = run({ proformaInvoice: { ...invoice, beneficiaryName: "Different Mainland Supplier Co., Ltd.", bankAccountName: "Different Mainland Supplier Co., Ltd." } });
    expect(result.finalOutcome).toBe("NO_GO");
    expect(result.decision.deal_specific_blockers).toContain("Invoice beneficiary differs from the licensed supplier legal name.");
  });

  it("makes HK third-party beneficiary mismatch a No-Go", () => {
    const result = run({ proformaInvoice: { ...invoice, beneficiaryName: "Bright Trade Hong Kong Limited", bankAccountName: "Bright Trade Hong Kong Limited", bankCountry: "Hong Kong" } });
    expect(result.finalOutcome).toBe("NO_GO");
    expect(result.decision.deal_specific_blockers.join(" ")).toMatch(/Hong Kong|offshore|third-party/);
  });

  it("makes a personal bank account a No-Go", () => {
    const result = run({ proformaInvoice: { ...invoice, beneficiaryName: "Zhang Wei", bankAccountName: "Zhang Wei" } });
    expect(result.finalOutcome).toBe("NO_GO");
    expect(result.decision.deal_specific_blockers).toContain("Invoice requests payment to a personal bank account.");
  });

  it("flags certificate holder mismatch as caution or fail", () => {
    const caution = run({ certificates: [{ holderName: "Other Supplier Co., Ltd.", certificateName: "LFGB", requiredForOrder: false }] });
    expect(caution.findings.find((finding) => finding.item === "Certificate authenticity")?.status).toBe("CAUTION");
    const fail = run({ certificates: [{ holderName: "Other Supplier Co., Ltd.", certificateName: "Required FDA", requiredForOrder: true }] });
    expect(fail.finalOutcome).toBe("NO_GO");
    expect(fail.findings.find((finding) => finding.item === "Certificate authenticity")?.status).toBe("FAIL");
  });

  it("flags product outside business scope as caution or fail", () => {
    const caution = run({ businessLicence: { ...licence, businessScope: "general import and export of textile goods" } });
    expect(caution.findings.some((finding) => /not clearly covered/i.test(finding.evidence_excerpt))).toBe(true);
    const fail = run({ businessLicence: { ...licence, businessScope: "real estate brokerage and education consulting" } });
    expect(fail.finalOutcome).toBe("NO_GO");
    expect(fail.decision.deal_specific_blockers).toContain("Product category is impossible or unrelated to the business scope shown on the licence.");
  });

  it("keeps instant demo scan document-optional", () => {
    expect(() => demoInput.parse({
      supplier_name: "Demo Supplier",
      supplier_website: "example.com",
      supplier_country: "China",
      product_category: "kitchenware",
      destination_market: "United States",
    })).not.toThrow();
  });
});

function verifiedReportInput(documents: SubmitVerifiedReportInput["documents"]): SubmitVerifiedReportInput {
  return {
    supplier_name: "Huawei Technologies Co., Ltd.",
    website: "https://www.huawei.com",
    country: "China",
    product_category: "kitchenware",
    destination_market: "United States",
    order_value: "25000",
    customer_name: "Buyer",
    customer_company: "Buyer Ltd",
    customer_email: "buyer@example.test",
    supplier_refused_licence: false,
    documents,
  };
}

function doc(category: SubmitVerifiedReportInput["documents"][number]["category"], filename: string): SubmitVerifiedReportInput["documents"][number] {
  return {
    category,
    filename,
    contentType: "application/pdf",
    fileBase64: Buffer.from("test").toString("base64"),
  };
}

function fakeSupabase() {
  const rows: Record<string, any[]> = {
    customers: [],
    suppliers: [],
    orders: [],
    supplier_cases: [],
    case_activity_log: [],
    case_documents: [],
  };
  const counters: Record<string, number> = {};
  const makeId = (table: string) => `${table}_${(counters[table] = (counters[table] ?? 0) + 1)}`;
  function chain(table: string) {
    let pending: any = null;
    const api: any = {
      upsert(value: any) {
        pending = { ...value, id: makeId(table) };
        rows[table].push(pending);
        return api;
      },
      insert(value: any) {
        const list = Array.isArray(value) ? value : [value];
        const inserted = list.map((item) => ({ ...item, id: makeId(table), order_reference: item.order_reference ?? `ORD-${counters[table]}`, case_reference: item.case_reference ?? `CASE-${counters[table]}` }));
        rows[table].push(...inserted);
        pending = Array.isArray(value) ? inserted[0] : inserted[0];
        return api;
      },
      update(value: any) {
        pending = value;
        api._update = value;
        return api;
      },
      select() { return api; },
      eq(column: string, value: any) {
        if (api._update) {
          const row = rows[table].find((item) => item[column] === value);
          if (row) Object.assign(row, api._update);
        }
        return api;
      },
      single: async () => ({ data: pending, error: null }),
      maybeSingle: async () => ({ data: pending, error: null }),
      order() { return api; },
      limit() { return api; },
    };
    return api;
  }
  return {
    rows,
    client: {
      from: chain,
      storage: {
        from: () => ({
          upload: vi.fn(async () => ({ error: null })),
        }),
      },
    },
  };
}

describe("Verified Supplier Report temporary Stripe bypass", () => {
  it("detects the bypass flag only when explicitly enabled", () => {
    expect(verifiedReportBypassEnabled({ VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS: "true" })).toBe(true);
    expect(verifiedReportBypassEnabled({ VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS: "false" })).toBe(false);
    expect(verifiedReportBypassEnabled({})).toBe(false);
  });

  it("starts an investigation immediately when bypass is enabled and required docs exist", async () => {
    const db = fakeSupabase();
    const createJob = vi.fn(async () => ({ jobId: "job_1", created: true, status: "queued" }));
    const runJob = vi.fn(async () => ({ claimed: true, status: "succeeded" }));

    const result = await submitVerifiedReportImpl(verifiedReportInput([
      doc("business_licence", "business-licence.pdf"),
      doc("proforma_invoice", "proforma-invoice.pdf"),
      doc("certificate_or_test_report", "lfgb-test-report.pdf"),
    ]), {
      supabaseAdmin: db.client,
      env: { VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS: "true", PUBLIC_SITE_URL: "https://vf.test" },
      createInvestigationJob: createJob,
      runJobById: runJob,
    });

    expect(result.paymentBypassedForTest).toBe(true);
    expect(result.message).toBe("Test mode: payment bypassed. Investigation started.");
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ reason: "temporary verified_report Stripe bypass test mode" }));
    expect(runJob).toHaveBeenCalledWith("job_1", expect.stringMatching(/^verified-report-bypass-/), { deliver: false, allowRerun: false });
    expect(db.rows.orders[0].payment_status).toBe("bypassed_test");
    expect(db.rows.case_documents.map((row) => row.note)).toEqual(["business_licence", "proforma_invoice", "certificate_or_test_report"]);
  });

  it("waits for Stripe webhook when bypass is disabled", async () => {
    const db = fakeSupabase();
    const createJob = vi.fn();
    const runJob = vi.fn();

    const result = await submitVerifiedReportImpl(verifiedReportInput([
      doc("business_licence", "business-licence.pdf"),
      doc("proforma_invoice", "proforma-invoice.pdf"),
    ]), {
      supabaseAdmin: db.client,
      env: { VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS: "false" },
      createInvestigationJob: createJob,
      runJobById: runJob,
    });

    expect(result.paymentBypassedForTest).toBe(false);
    expect(createJob).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
    expect(db.rows.orders[0].payment_status).toBe("pending");
    expect(db.rows.supplier_cases[0].status).toBe("payment_pending");
  });

  it("blocks verified_report when required documents are missing", async () => {
    expect(missingVerifiedReportDocuments(verifiedReportInput([doc("proforma_invoice", "invoice.pdf")]))).toEqual(["Business licence"]);
    expect(missingVerifiedReportDocuments(verifiedReportInput([doc("business_licence", "licence.pdf")]))).toEqual(["Proforma invoice"]);

    const db = fakeSupabase();
    const createJob = vi.fn();
    await submitVerifiedReportImpl(verifiedReportInput([doc("business_licence", "licence.pdf")]), {
      supabaseAdmin: db.client,
      env: { VERIFYFIRST_BYPASS_STRIPE_FOR_VERIFIED_REPORTS: "true" },
      createInvestigationJob: createJob,
    });
    expect(createJob).not.toHaveBeenCalled();
    expect(db.rows.supplier_cases[0].status).toBe("review_required");
  });

  it("preserves document type selection and does not treat proforma invoice as business licence", () => {
    expect(normalizeVerifiedReportDocumentCategory("certificate")).toBe("certificate_or_test_report");
    const invoiceDoc: ExtractedDoc = {
      filename: "business-licence-looking-proforma.pdf",
      category: "proforma_invoice",
      doc_type: "business licence invoice",
      extracted_entities: { company_name_en: null, company_name_zh: null, usci_number: null, registered_address: null, contact: null, dates: [], amounts: [], certificate_authority: null, certificate_number: null, validity_dates: null },
      summary: "",
    };
    const licenceDoc: ExtractedDoc = {
      filename: "licence.pdf",
      category: "business_licence",
      doc_type: "proforma invoice",
      extracted_entities: { company_name_en: null, company_name_zh: null, usci_number: null, registered_address: null, contact: null, dates: [], amounts: [], certificate_authority: null, certificate_number: null, validity_dates: null },
      summary: "",
    };
    const selected = selectVerifiedReportEvidenceDocs([invoiceDoc, licenceDoc]);
    expect(selected.businessLicence).toBe(licenceDoc);
    expect(selected.proformaInvoice).toBe(invoiceDoc);
  });
});
