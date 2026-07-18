import type { ExtractedDoc } from "./extract-documents.server";
import type { Finding, FinalOutcome, VerifiedReportDecision } from "./types";
import { validateUsccChecksum } from "./uscc";

export interface VerifiedBusinessLicenceFields {
  chineseLegalName: string | null;
  englishName: string | null;
  uscc: string | null;
  registeredAddress: string | null;
  legalRepresentative: string | null;
  businessScope: string | null;
  licenceDate: string | null;
}

export interface VerifiedInvoiceFields {
  issuerSellerEntity: string | null;
  beneficiaryName: string | null;
  bankAccountName: string | null;
  bankCountry: string | null;
  invoiceAddress: string | null;
  currency: string | null;
  orderAmount: string | null;
  productDescription: string | null;
  buyerName: string | null;
}

export interface VerifiedCertificateFields {
  holderName: string | null;
  certificateName: string | null;
  requiredForOrder?: boolean;
}

export interface VerifiedReportConsistencyInput {
  supplierName: string;
  website: string;
  country: string;
  productCategory: string;
  destinationMarket: string;
  orderValue: string;
  businessLicence: VerifiedBusinessLicenceFields | null;
  proformaInvoice: VerifiedInvoiceFields | null;
  certificates?: VerifiedCertificateFields[];
  supplierRefusedLicence?: boolean;
  now?: string;
}

export interface VerifiedReportConsistencyResult {
  findings: Finding[];
  finalOutcome: FinalOutcome;
  overallRisk: "low" | "medium" | "high" | "critical";
  decision: VerifiedReportDecision;
  missingRequiredDocuments: string[];
}

export function selectVerifiedReportEvidenceDocs(extracted: ExtractedDoc[]) {
  const businessLicence =
    extracted.find((doc) => doc.category === "business_licence")
    ?? extracted.find((doc) => /business_licen[cs]e/i.test(`${doc.doc_type} ${doc.filename}`));
  const proformaInvoice =
    extracted.find((doc) => doc.category === "proforma_invoice")
    ?? extracted.find((doc) => /pro.?forma|invoice|quotation|payment/i.test(`${doc.doc_type} ${doc.filename}`));
  const certificates = extracted.filter((doc) =>
    doc.category === "certificate_or_test_report" ||
    doc.category === "certificate" ||
    /certificate|test_report|test report/i.test(`${doc.doc_type} ${doc.filename}`),
  );
  return { businessLicence, proformaInvoice, certificates };
}

const LICENCE_SOURCE = "supplier-provided business licence";
const INVOICE_SOURCE = "supplier-provided proforma invoice";
const CERT_SOURCE = "supplier-provided certificate/test report";
const ENGINE_SOURCE = "Verified Supplier Report consistency engine";

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length ? trimmed : null;
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/co\.?,? ?ltd\.?|limited|company|corporation|corp\.?|inc\.?|llc|ltd\.?/g, "")
    .replace(/有限公司|有限责任公司|股份有限公司|公司/g, "")
    .replace(/[\s.,'’“”"()（）\-_/]+/g, "")
    .trim();
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function hasCompanyMarker(value: string | null | undefined): boolean {
  return /公司|有限公司|limited|ltd|co\.|company|corporation|corp|inc\.?|llc|gmbh|s\.?a\.?/i.test(value ?? "");
}

function isHongKongOrOffshore(value: string | null | undefined): boolean {
  return /hong\s*kong|\bhk\b|香港|bvi|british virgin|seychelles|cayman|singapore/i.test(value ?? "");
}

function looksPersonalAccount(value: string | null | undefined): boolean {
  const v = clean(value);
  if (!v || hasCompanyMarker(v)) return false;
  if (/^[\u4e00-\u9fff]{2,4}$/.test(v)) return true;
  const words = v.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Za-z'.-]+$/.test(word));
}

function sameCityOrProvince(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  if (normalizeName(left) === normalizeName(right)) return true;
  const chinesePlace = /([\u4e00-\u9fff]{2,}(?:省|市|区|县))/g;
  const places = left.match(chinesePlace) ?? [];
  return places.some((place) => right.includes(place));
}

function productFitsScope(productCategory: string, businessScope: string | null | undefined): "match" | "missing" | "mismatch" | "fail" {
  const product = clean(productCategory);
  const scope = clean(businessScope);
  if (!product || !scope) return "missing";
  const productTokens = product.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length >= 4);
  const scopeLower = scope.toLowerCase();
  if (productTokens.some((token) => scopeLower.includes(token))) return "match";
  if (
    /cookware|kitchen|stainless|utensil|household|hardware|metal|plastic|ceramic/i.test(product) &&
    /cookware|kitchen|stainless|utensil|household|hardware|metal|plastic|ceramic|daily goods/i.test(scope)
  ) return "match";
  if (/consult|advertis|publishing|real estate|software|education|restaurant/i.test(scopeLower)) return "fail";
  return "mismatch";
}

function finding(args: Partial<Finding> & Pick<Finding, "section" | "item" | "status" | "source_name" | "evidence_excerpt" | "buyer_impact" | "recommended_action">, now: string): Finding {
  return {
    confidence: args.confidence ?? "medium",
    source_url: args.source_url ?? null,
    retrieval_date: args.retrieval_date ?? now,
    evidence_ids: args.evidence_ids ?? ["verified_report_supplier_document"],
    evidence_classification: args.evidence_classification ?? "SUPPLIER_CLAIMED",
    ...args,
  };
}

export function extractVerifiedBusinessLicenceFields(doc: ExtractedDoc | null | undefined): VerifiedBusinessLicenceFields | null {
  if (!doc) return null;
  const anyDoc = doc as any;
  const fields = anyDoc.business_licence ?? anyDoc.businessLicence ?? {};
  const e = doc.extracted_entities ?? ({} as ExtractedDoc["extracted_entities"]);
  return {
    chineseLegalName: clean(fields.chineseLegalName ?? fields.chinese_legal_name ?? e.company_name_zh),
    englishName: clean(fields.englishName ?? fields.english_name ?? e.company_name_en),
    uscc: clean(fields.uscc ?? fields.unifiedSocialCreditCode ?? fields.unified_social_credit_code ?? e.usci_number),
    registeredAddress: clean(fields.registeredAddress ?? fields.registered_address ?? e.registered_address),
    legalRepresentative: clean(fields.legalRepresentative ?? fields.legal_representative),
    businessScope: clean(fields.businessScope ?? fields.business_scope),
    licenceDate: clean(fields.licenceDate ?? fields.issueDate ?? fields.issue_date ?? e.dates?.[0]),
  };
}

export function extractVerifiedInvoiceFields(doc: ExtractedDoc | null | undefined): VerifiedInvoiceFields | null {
  if (!doc) return null;
  const anyDoc = doc as any;
  const fields = anyDoc.proforma_invoice ?? anyDoc.invoice ?? anyDoc.proformaInvoice ?? {};
  const e = doc.extracted_entities ?? ({} as ExtractedDoc["extracted_entities"]);
  return {
    issuerSellerEntity: clean(fields.issuerSellerEntity ?? fields.invoiceIssuer ?? fields.seller ?? fields.issuer_seller_entity ?? e.company_name_en ?? e.company_name_zh),
    beneficiaryName: clean(fields.beneficiaryName ?? fields.beneficiary ?? fields.paymentBeneficiary),
    bankAccountName: clean(fields.bankAccountName ?? fields.bank_account_name),
    bankCountry: clean(fields.bankCountry ?? fields.bank_country),
    invoiceAddress: clean(fields.invoiceAddress ?? fields.invoice_address ?? e.registered_address),
    currency: clean(fields.currency),
    orderAmount: clean(fields.orderAmount ?? fields.amount ?? e.amounts?.[0]),
    productDescription: clean(fields.productDescription ?? fields.product_description),
    buyerName: clean(fields.buyerName ?? fields.buyer_name),
  };
}

export function buildVerifiedReportConsistency(input: VerifiedReportConsistencyInput): VerifiedReportConsistencyResult {
  const now = input.now ?? new Date().toISOString();
  const findings: Finding[] = [];
  const missing: string[] = [];
  const blockers: string[] = [];
  const asks: string[] = [];
  const why: string[] = [];
  const docsChecked: string[] = [];
  let entityPaymentConsistency: VerifiedReportDecision["entity_payment_consistency"] = "NOT_VERIFIED";

  if (!input.businessLicence) missing.push("Business licence");
  else docsChecked.push("Business licence");
  if (!input.proformaInvoice) missing.push("Proforma invoice");
  else docsChecked.push("Proforma invoice");
  if ((input.certificates ?? []).length > 0) docsChecked.push(`${input.certificates!.length} certificate/test report(s)`);

  if (input.supplierRefusedLicence) {
    blockers.push("Supplier refused to provide a business licence.");
    asks.push("Ask the supplier to provide a current mainland China business licence before any payment.");
    findings.push(finding({
      section: "payment_safeguards",
      item: "Supplier refused business licence",
      status: "FAIL",
      confidence: "high",
      source_name: ENGINE_SOURCE,
      evidence_classification: "CONTRADICTED",
      evidence_excerpt: "Supplier refusal to provide a business licence is a hard payment-risk blocker.",
      buyer_impact: "A buyer cannot check whether the invoicing party is the licensed supplier.",
      recommended_action: "Do not wire funds until a current business licence is provided and reconciled to invoice/payment details.",
    }, now));
  }

  if (missing.length > 0) {
    asks.push(...missing.map((item) => `Request the supplier's ${item.toLowerCase()} before payment.`));
    findings.push(finding({
      section: "payment_safeguards",
      item: "Missing required Verified Supplier Report documents",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: ENGINE_SOURCE,
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      evidence_ids: [],
      evidence_excerpt: `Missing required document(s): ${missing.join("; ")}.`,
      buyer_impact: "The Verified Supplier Report cannot make a payment decision without the required supplier documents.",
      recommended_action: asks.join(" "),
    }, now));
  }

  const licenceName = input.businessLicence?.chineseLegalName || input.businessLicence?.englishName || null;
  const licenceNames = [input.businessLicence?.chineseLegalName, input.businessLicence?.englishName].filter((item): item is string => Boolean(clean(item)));
  const invoiceSeller = input.proformaInvoice?.issuerSellerEntity ?? null;
  const beneficiary = input.proformaInvoice?.beneficiaryName ?? input.proformaInvoice?.bankAccountName ?? null;

  if (input.businessLicence) {
    const parts = [
      input.businessLicence.chineseLegalName && `Chinese legal name: ${input.businessLicence.chineseLegalName}`,
      input.businessLicence.englishName && `English name: ${input.businessLicence.englishName}`,
      input.businessLicence.uscc && `USCC: ${input.businessLicence.uscc}`,
      input.businessLicence.registeredAddress && `Registered address: ${input.businessLicence.registeredAddress}`,
      input.businessLicence.legalRepresentative && `Legal representative: ${input.businessLicence.legalRepresentative}`,
      input.businessLicence.businessScope && `Business scope: ${input.businessLicence.businessScope}`,
      input.businessLicence.licenceDate && `Licence date: ${input.businessLicence.licenceDate}`,
    ].filter(Boolean).join("; ");
    findings.push(finding({
      section: "certificates_documents",
      item: "Business licence validation",
      status: "CAUTION",
      source_name: LICENCE_SOURCE,
      evidence_excerpt: parts || "Business licence uploaded, but key fields could not be extracted.",
      buyer_impact: "Supplier-provided licence fields are useful for consistency checks but are not official registry verification.",
      recommended_action: "Confirm active registration free at GSXT / National Enterprise Credit Information Publicity System or CODS where applicable.",
    }, now));
  }

  if (input.proformaInvoice) {
    findings.push(finding({
      section: "certificates_documents",
      item: "Supplier document consistency",
      status: "CAUTION",
      source_name: INVOICE_SOURCE,
      evidence_excerpt: [
        invoiceSeller && `Invoice issuer/seller: ${invoiceSeller}`,
        beneficiary && `Payment beneficiary: ${beneficiary}`,
        input.proformaInvoice.bankCountry && `Bank country: ${input.proformaInvoice.bankCountry}`,
        input.proformaInvoice.orderAmount && `Order amount: ${input.proformaInvoice.orderAmount}`,
        input.proformaInvoice.productDescription && `Product: ${input.proformaInvoice.productDescription}`,
      ].filter(Boolean).join("; ") || "Proforma invoice uploaded, but payment fields could not be extracted.",
      buyer_impact: "Invoice and payment details drive the wire-transfer risk decision.",
      recommended_action: "Pay only a bank account held by the same legal entity shown on the business licence unless an exception is documented and independently verified.",
    }, now));
  }

  if (input.businessLicence?.uscc) {
    if (validateUsccChecksum(input.businessLicence.uscc)) {
      why.push("Business licence USCC is structurally valid.");
      findings.push(finding({
        section: "legal_entity",
        item: "Unified Social Credit Code",
        status: "CAUTION",
        source_name: LICENCE_SOURCE,
        evidence_excerpt: `Business licence shows structurally valid USCC ${input.businessLicence.uscc}. Structural validity is not official active-status verification.`,
        buyer_impact: "The USCC format is internally consistent, but registration status still requires official registry confirmation.",
        recommended_action: "Confirm the USCC free at GSXT / National Enterprise Credit Information Publicity System or CODS where applicable.",
      }, now));
    } else {
      blockers.push("Business licence shows structurally invalid USCC — possible doctored or incorrect document.");
      findings.push(finding({
        section: "legal_entity",
        item: "Unified Social Credit Code",
        status: "FAIL",
        confidence: "high",
        source_name: LICENCE_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: "Business licence shows structurally invalid USCC — possible doctored or incorrect document.",
        buyer_impact: "An invalid USCC is a hard identity-risk blocker for payment.",
        recommended_action: "Do not proceed until the supplier provides a corrected licence and the number is confirmed through official lookup.",
      }, now));
    }
  }

  if (licenceName) {
    if (namesMatch(licenceName, input.supplierName)) {
      why.push("Supplier name aligns with the business licence name.");
    } else {
      findings.push(finding({
        section: "digital_footprint",
        item: "Website and domain consistency",
        status: "CAUTION",
        source_name: ENGINE_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: `Submitted supplier name "${input.supplierName}" does not clearly match licence name "${licenceName}".`,
        buyer_impact: "A name mismatch can indicate a trader, alias, or wrong entity.",
        recommended_action: "Ask the supplier to explain the relationship and provide matching website/company identity evidence.",
      }, now));
    }
  }

  if (input.businessLicence && input.proformaInvoice) {
    const sellerMatches = licenceNames.some((name) => namesMatch(name, invoiceSeller));
    const beneficiaryMatches = licenceNames.some((name) => namesMatch(name, beneficiary));
    const personal = looksPersonalAccount(beneficiary);
    const offshore = isHongKongOrOffshore(invoiceSeller) || isHongKongOrOffshore(beneficiary) || isHongKongOrOffshore(input.proformaInvoice.bankCountry);

    if (personal) {
      blockers.push("Invoice requests payment to a personal bank account.");
      entityPaymentConsistency = "MISMATCH";
    } else if (!sellerMatches || !beneficiaryMatches) {
      const message = offshore
        ? "Invoice/payment beneficiary appears to be a Hong Kong, offshore, or third-party entity that differs from the licensed supplier."
        : "Invoice beneficiary differs from the licensed supplier legal name.";
      blockers.push(message);
      entityPaymentConsistency = "MISMATCH";
    } else {
      entityPaymentConsistency = "MATCH";
      why.push("Licence name matches invoice seller and payment beneficiary.");
    }

    if (entityPaymentConsistency === "MISMATCH") {
      findings.push(finding({
        section: "payment_safeguards",
        item: "Payment beneficiary mismatch",
        status: "FAIL",
        confidence: "high",
        source_name: ENGINE_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: `Licence entity: ${licenceName || "not extracted"}. Invoice seller: ${invoiceSeller || "not extracted"}. Payment beneficiary: ${beneficiary || "not extracted"}.`,
        buyer_impact: "A material entity/payment mismatch creates high risk of misdirected payment or undisclosed intermediary.",
        recommended_action: "Do not wire funds until the beneficiary matches the licensed supplier or the relationship is documented and independently verified.",
      }, now));
    } else if (entityPaymentConsistency === "MATCH") {
      findings.push(finding({
        section: "payment_safeguards",
        item: "Entity and payment-party consistency",
        status: "PASS",
        source_name: ENGINE_SOURCE,
        evidence_excerpt: "Business licence legal name, invoice seller, and payment beneficiary are consistent.",
        buyer_impact: "The supplier-provided payment story is internally consistent.",
        recommended_action: "Use staged payment terms and keep the bank beneficiary locked to the matched legal entity.",
      }, now));
    }
  }

  if (input.businessLicence && input.proformaInvoice) {
    if (sameCityOrProvince(input.businessLicence.registeredAddress, input.proformaInvoice.invoiceAddress)) {
      why.push("Licence and invoice addresses are consistent at address or city/province level.");
    } else if (input.businessLicence.registeredAddress && input.proformaInvoice.invoiceAddress) {
      findings.push(finding({
        section: "certificates_documents",
        item: "Supplier document consistency",
        status: "CAUTION",
        source_name: ENGINE_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: `Licence address "${input.businessLicence.registeredAddress}" differs from invoice address "${input.proformaInvoice.invoiceAddress}".`,
        buyer_impact: "Unexplained address differences can indicate a separate trading/payment entity.",
        recommended_action: "Ask the supplier to explain the address difference and provide matching company documents.",
      }, now));
    }
  }

  if (input.businessLicence) {
    const scopeFit = productFitsScope(input.productCategory, input.businessLicence.businessScope);
    if (scopeFit === "match") {
      why.push("Product category broadly fits the business scope shown on the licence.");
    } else if (scopeFit === "fail") {
      blockers.push("Product category is impossible or unrelated to the business scope shown on the licence.");
      findings.push(finding({
        section: "certificates_documents",
        item: "Supplier document consistency",
        status: "FAIL",
        confidence: "high",
        source_name: ENGINE_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: `Product category "${input.productCategory}" is outside licence business scope "${input.businessLicence.businessScope}".`,
        buyer_impact: "A completely unrelated scope is a hard story-consistency blocker.",
        recommended_action: "Do not proceed unless the supplier provides a licence/entity whose business scope fits the goods.",
      }, now));
    } else {
      findings.push(finding({
        section: "certificates_documents",
        item: "Supplier document consistency",
        status: "CAUTION",
        source_name: ENGINE_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: input.businessLicence.businessScope
          ? `Product category "${input.productCategory}" is not clearly covered by licence business scope "${input.businessLicence.businessScope}".`
          : "Business scope could not be extracted from the licence.",
        buyer_impact: "The supplier may not be licensed or experienced for the stated goods.",
        recommended_action: "Ask for product-specific scope evidence, catalogue, export records, or factory documentation.",
      }, now));
    }
  }

  for (const cert of input.certificates ?? []) {
    if (!cert.holderName) continue;
    if (namesMatch(licenceName, cert.holderName)) {
      why.push(`Certificate holder matches licence entity for ${cert.certificateName || "uploaded certificate"}.`);
    } else {
      const required = cert.requiredForOrder;
      if (required) blockers.push("Required certificate holder differs from the licensed supplier.");
      findings.push(finding({
        section: "certificates_documents",
        item: "Certificate authenticity",
        status: required ? "FAIL" : "CAUTION",
        confidence: required ? "high" : "medium",
        source_name: CERT_SOURCE,
        evidence_classification: "CONTRADICTED",
        evidence_excerpt: `Certificate holder "${cert.holderName}" does not match licence entity "${licenceName || "not extracted"}".`,
        buyer_impact: required ? "A required certificate may not belong to this supplier." : "The certificate may belong to another entity.",
        recommended_action: "Ask for a certificate reissued to the licensed supplier or issuer confirmation tying the certificate to this entity.",
      }, now));
    }
  }

  if ((input.certificates ?? []).length === 0) {
    findings.push(finding({
      section: "certificates_documents",
      item: "Product certificates and test reports",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: ENGINE_SOURCE,
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      evidence_ids: [],
      evidence_excerpt: "No certificates or test reports were supplied. These are optional for intake but may be required for the product or destination market.",
      buyer_impact: "Missing product evidence may limit regulatory confidence, but it is not automatically a hard blocker.",
      recommended_action: "Request product-specific certificates or test reports if the product category or destination market requires them.",
    }, now));
  }

  if (!why.length && !blockers.length) why.push("The submitted documents are insufficient to support a payment decision.");
  asks.push("Confirm registration status free at GSXT / National Enterprise Credit Information Publicity System or CODS where applicable.");
  if (!asks.some((item) => /beneficiary/i.test(item)) && entityPaymentConsistency !== "MATCH") {
    asks.push("Ask the supplier to confirm the payment beneficiary is the same legal entity as the licence holder.");
  }

  let finalOutcome: FinalOutcome = "PROCEED_WITH_SAFEGUARDS";
  let overallRisk: VerifiedReportConsistencyResult["overallRisk"] = "medium";
  if (missing.length > 0) {
    finalOutcome = "PAUSE_PENDING_CLARIFICATION";
    overallRisk = "high";
  }
  if (blockers.length > 0) {
    finalOutcome = "NO_GO";
    overallRisk = "critical";
  }

  const decision: VerifiedReportDecision = {
    payment_decision: finalOutcome === "NO_GO" ? "NO_GO" : finalOutcome === "PAUSE_PENDING_CLARIFICATION" ? "PAUSE" : "PROCEED",
    why,
    deal_specific_blockers: blockers,
    entity_payment_consistency: entityPaymentConsistency,
    documents_checked: docsChecked,
    ask_supplier_before_payment: Array.from(new Set(asks)),
  };

  return { findings, finalOutcome, overallRisk, decision, missingRequiredDocuments: missing };
}
