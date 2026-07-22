// Buyer-facing view model for Verified Supplier Report rendering (PDF + web).
//
// Why this exists: string-sanitization (report-sanitizer.ts) patches known-bad
// text patterns *after* they have already been formatted into sentences. That
// approach only ever catches the exact phrasings it was written against — any
// new code path that formats the same unreliable underlying field slightly
// differently (different wording, different punctuation, a legacy persisted
// snapshot from before a regex existed) bypasses every existing patch and the
// raw OCR/registry garbage reaches the customer.
//
// This module inverts the approach: it is a positive allowlist, not a
// negative denylist. It reads the *structured* investigation snapshot fields,
// runs each one through an explicit quality check, and produces a safe,
// display-ready view model. A field either passes its quality check and is
// shown, or it fails and ONLY the fixed fallback sentence is shown — the raw
// value is never interpolated into any output string in the failure case, so
// there is no phrasing for it to leak through.
//
// verified_report PDF/web rendering must read legal-entity text, the
// documents-checked line, the payment-beneficiary warning, and the UFLPA
// local-name line from this view model — never directly from
// InvestigationReport.resolved_entity / verified_report_decision.

import type { ChecklistReportResult, Finding, InvestigationReport, SourceEntry, VerifiedReportDecision } from "./types";
import {
  isUnreliableChineseExtraction,
  MISSING_BENEFICIARY_WORDING,
  UFLPA_LOCAL_NAME_UNCERTAIN,
  UNCERTAIN_BUSINESS_SCOPE,
  UNCERTAIN_CHINESE_LEGAL_NAME,
  UNCERTAIN_REGISTERED_ADDRESS,
} from "./report-sanitizer";
import { hasMeaningfulChineseCompanyName, hasReliableChineseField } from "./verified-report.server";

export interface BuyerFacingLegalEntityField {
  reliable: boolean;
  /** The raw value — populated ONLY when reliable === true. Never read this when reliable is false. */
  value: string | null;
  /** What buyer-facing UI must render: the value when reliable, otherwise the fixed fallback sentence. */
  displayText: string;
}

export interface BuyerFacingReportViewModel {
  isVerifiedReport: boolean;
  documentsChecked: string[];
  documentsCheckedLine: string;
  why: string[];
  whyLine: string;
  missingBeneficiaryWarning: string | null;
  dealSpecificBlockersLine: string;
  askSupplierBeforePaymentLine: string;
  legalEntity: {
    chineseLegalName: BuyerFacingLegalEntityField;
    registeredAddress: BuyerFacingLegalEntityField;
    businessScope: BuyerFacingLegalEntityField;
  };
  uflpaLocalNameLine: string;
}

const NO_SUMMARY_REASONS_LINE =
  "No summary reasons were generated from the extracted documents — see the item-level checklist findings below for full evidence detail.";

function safeField(
  raw: string | null | undefined,
  reliable: boolean,
  fallback: string,
): BuyerFacingLegalEntityField {
  if (!raw || !reliable) return { reliable: false, value: null, displayText: fallback };
  return { reliable: true, value: raw, displayText: raw };
}

function isReliableChineseLegalName(value: string | null | undefined): boolean {
  if (!value) return false;
  if (isUnreliableChineseExtraction(value)) return false;
  return hasMeaningfulChineseCompanyName(value);
}

function isReliableRegisteredAddress(value: string | null | undefined): boolean {
  if (!value) return false;
  if (isUnreliableChineseExtraction(value)) return false;
  return hasReliableChineseField(value, 6);
}

function isReliableBusinessScope(value: string | null | undefined): boolean {
  if (!value) return false;
  if (isUnreliableChineseExtraction(value)) return false;
  return hasReliableChineseField(value, 2);
}

/** Same quality bar used for UFLPA local-name screening — a name that isn't
 * reliable enough to display isn't reliable enough to screen against a
 * sanctions list either. */
function isReliableLocalScreeningName(value: string | null | undefined): boolean {
  if (!value) return false;
  if (isUnreliableChineseExtraction(value)) return false;
  return hasMeaningfulChineseCompanyName(value) || hasReliableChineseField(value, 6);
}

const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  business_licence: "Business licence",
  proforma_invoice: "Proforma invoice",
};

function canonicalCertificateCategory(category: string | null | undefined): boolean {
  return category === "certificate_or_test_report" || category === "certificate";
}

/** Detects which document types were actually uploaded, from the customer
 * evidence list's declared category (set at upload time — see
 * pipeline.server.ts) — a presence check, completely decoupled from whether
 * the consistency engine later succeeded at extracting fields from that
 * document. A document the customer uploaded must never disappear from
 * "Documents checked" just because OCR/field-extraction had a bad day. */
function detectUploadedDocuments(evidence: SourceEntry[] | undefined): { categories: Set<string>; certificateCount: number } {
  const categories = new Set<string>();
  let certificateCount = 0;
  for (const item of evidence ?? []) {
    if (!item.category) continue;
    if (item.category === "business_licence" || item.category === "proforma_invoice") {
      categories.add(item.category);
    } else if (canonicalCertificateCategory(item.category)) {
      certificateCount += 1;
    }
  }
  return { categories, certificateCount };
}

/** Best-effort fallback for legacy snapshots recorded before customer_evidence
 * carried a specific document category (see pipeline.server.ts) — matches
 * source names the consistency engine assigns whenever it actually located a
 * matching document, regardless of field-extraction success. This runs in
 * ADDITION to (never instead of) the category-based detection above, and the
 * two signals are unioned so a gap in either one alone can't cause an
 * omission. */
function detectDocumentsFromFindings(findings: Finding[] | undefined): { categories: Set<string>; certificateCount: number } {
  const categories = new Set<string>();
  let certificateCount = 0;
  for (const f of findings ?? []) {
    const source = f.source_name || "";
    if (/supplier-provided business licen[cs]e/i.test(source)) categories.add("business_licence");
    if (/supplier-provided proforma invoice/i.test(source)) categories.add("proforma_invoice");
    if (/supplier-provided certificate\/test report/i.test(source)) certificateCount += 1;
  }
  return { categories, certificateCount };
}

function canonicalizeDecisionDocLabel(label: string): "business_licence" | "proforma_invoice" | "certificate" | null {
  if (/business licen[cs]e/i.test(label)) return "business_licence";
  if (/proforma invoice/i.test(label)) return "proforma_invoice";
  if (/certificate\/test report/i.test(label)) return "certificate";
  return null;
}

function buildDocumentsChecked(report: InvestigationReport): string[] {
  const fromEvidence = detectUploadedDocuments(report.customer_evidence);
  const fromFindings = detectDocumentsFromFindings(report.findings);

  const categories = new Set<string>([...fromEvidence.categories, ...fromFindings.categories]);
  let certificateCount = Math.max(fromEvidence.certificateCount, fromFindings.certificateCount);

  // Union with whatever the consistency engine's own decision already reported — a legacy or
  // partially-matched snapshot may have a correct decision.documents_checked even when the
  // evidence-category signals above miss it (or vice versa). Never let either signal alone be
  // authoritative when the other found more.
  let decisionHadCertificates = false;
  for (const label of report.verified_report_decision?.documents_checked ?? []) {
    const canonical = canonicalizeDecisionDocLabel(label);
    if (canonical === "business_licence") categories.add("business_licence");
    else if (canonical === "proforma_invoice") categories.add("proforma_invoice");
    else if (canonical === "certificate") decisionHadCertificates = true;
  }
  if (decisionHadCertificates && certificateCount === 0) certificateCount = 1;

  const out: string[] = [];
  if (categories.has("business_licence")) out.push(DOCUMENT_CATEGORY_LABELS.business_licence);
  if (categories.has("proforma_invoice")) out.push(DOCUMENT_CATEGORY_LABELS.proforma_invoice);
  if (certificateCount > 0) out.push(`${certificateCount} certificate/test report(s)`);
  return out;
}

function buildMissingBeneficiaryWarning(report: InvestigationReport, documentsChecked: string[]): string | null {
  const proformaInvoiceChecked = documentsChecked.includes(DOCUMENT_CATEGORY_LABELS.proforma_invoice);
  if (!proformaInvoiceChecked) return null;

  const decision = report.verified_report_decision;
  if (decision?.why?.includes(MISSING_BENEFICIARY_WORDING)) return MISSING_BENEFICIARY_WORDING;

  const hasExplicitBeneficiaryFinding = (report.findings ?? []).some(
    (f) => f.item === "Payment beneficiary not extracted",
  );
  if (hasExplicitBeneficiaryFinding) return MISSING_BENEFICIARY_WORDING;

  // No structured signal that a beneficiary was ever extracted or reconciled, and no explicit
  // match/mismatch finding either — treat as not-yet-confirmed rather than silent.
  if (decision && decision.entity_payment_consistency === "NOT_VERIFIED") {
    const hasMismatchFinding = (report.findings ?? []).some((f) => f.item === "Payment beneficiary mismatch");
    if (!hasMismatchFinding) return MISSING_BENEFICIARY_WORDING;
  }

  return null;
}

function buildWhy(report: InvestigationReport, missingBeneficiaryWarning: string | null): string[] {
  const decisionWhy = (report.verified_report_decision?.why ?? []).filter(Boolean);
  const why = [...decisionWhy];
  if (missingBeneficiaryWarning && !why.includes(missingBeneficiaryWarning)) why.push(missingBeneficiaryWarning);
  return why;
}

export function buildBuyerFacingReportViewModel(report: InvestigationReport): BuyerFacingReportViewModel {
  const isVerifiedReport = Boolean(report.verified_report_decision);
  const documentsChecked = buildDocumentsChecked(report);
  const missingBeneficiaryWarning = buildMissingBeneficiaryWarning(report, documentsChecked);
  const why = buildWhy(report, missingBeneficiaryWarning);
  const decision: VerifiedReportDecision | undefined = report.verified_report_decision;

  const resolved = report.resolved_entity;
  const chineseLegalNameRaw = resolved.legal_name_local || report.supplier_input.chinese_name;
  const chineseLegalName = safeField(
    chineseLegalNameRaw,
    isReliableChineseLegalName(chineseLegalNameRaw),
    UNCERTAIN_CHINESE_LEGAL_NAME,
  );
  const registeredAddress = safeField(
    resolved.registered_address,
    isReliableRegisteredAddress(resolved.registered_address),
    UNCERTAIN_REGISTERED_ADDRESS,
  );
  const businessScope = safeField(
    resolved.business_scope,
    isReliableBusinessScope(resolved.business_scope),
    UNCERTAIN_BUSINESS_SCOPE,
  );

  const localScreeningNameRaw = resolved.legal_name_local || report.supplier_input.chinese_name;
  const uflpaLocalNameLine = isReliableLocalScreeningName(localScreeningNameRaw)
    ? `local: "${localScreeningNameRaw}"`
    : UFLPA_LOCAL_NAME_UNCERTAIN;

  return {
    isVerifiedReport,
    documentsChecked,
    documentsCheckedLine: `Documents checked: ${documentsChecked.length ? documentsChecked.join("; ") : "No required documents checked"}`,
    why,
    whyLine: `Why: ${why.length ? why.join(" ") : NO_SUMMARY_REASONS_LINE}`,
    missingBeneficiaryWarning,
    dealSpecificBlockersLine: `Deal-specific blockers: ${
      decision?.deal_specific_blockers?.length ? decision.deal_specific_blockers.join(" ") : "None identified from the extracted payment fields."
    }`,
    askSupplierBeforePaymentLine: `Ask supplier before payment: ${
      decision?.ask_supplier_before_payment?.length ? decision.ask_supplier_before_payment.join(" ") : "Resolve all Not Verified checklist items before payment."
    }`,
    legalEntity: { chineseLegalName, registeredAddress, businessScope },
    uflpaLocalNameLine,
  };
}

/**
 * Rewrites the specific checklist items whose explanation text was built
 * directly from a raw legal-entity/local-screening field (see checklist.ts's
 * registryFieldResult and sources/uflpa.server.ts) so they show the safe
 * view-model text instead. This is the actual enforcement point: everything
 * else in `checklist` is left untouched (still subject to the existing
 * string sanitizer as a second layer of defense), but these specific items
 * are FULLY REPLACED for the unreliable case — the raw value is never
 * interpolated into the returned explanation at all, so there is no
 * substring for it to leak through as.
 */
export function applyBuyerFacingViewModelToChecklist(
  checklist: ChecklistReportResult[],
  viewModel: BuyerFacingReportViewModel,
): ChecklistReportResult[] {
  if (!viewModel.isVerifiedReport) return checklist;
  const localNameUncertain = viewModel.uflpaLocalNameLine === UFLPA_LOCAL_NAME_UNCERTAIN;

  return checklist.map((item) => {
    if (item.id === "chinese_legal_name" && !viewModel.legalEntity.chineseLegalName.reliable) {
      return { ...item, explanation: viewModel.legalEntity.chineseLegalName.displayText };
    }
    if (item.id === "registered_address" && !viewModel.legalEntity.registeredAddress.reliable) {
      return { ...item, explanation: viewModel.legalEntity.registeredAddress.displayText };
    }
    if (item.id === "business_scope" && !viewModel.legalEntity.businessScope.reliable) {
      return { ...item, explanation: viewModel.legalEntity.businessScope.displayText };
    }
    if (item.id === "uflpa_forced_labour" && localNameUncertain) {
      const rewritten = item.explanation.replace(/local:\s*["“”'][^"“”']*["“”']/gi, UFLPA_LOCAL_NAME_UNCERTAIN);
      if (rewritten !== item.explanation) return { ...item, explanation: rewritten };
    }
    return item;
  });
}
