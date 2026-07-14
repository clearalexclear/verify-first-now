import { describe, expect, it } from "vitest";
import { buildVerifiedReportConsistency, type VerifiedBusinessLicenceFields, type VerifiedInvoiceFields } from "../lib/investigation/verified-report.server";
import { demoInput } from "../lib/demo/demo.functions";

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
