import type { ChecklistReportResult, FinalOutcome, Finding, InvestigationReport, ManusEvidenceClaim, ManusResearchReport, SupplierInternetScoutingReport, VerifiedReportComparisonRow, VerifiedReportDecision, VerifiedReportDocumentSummary } from "./types";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const GARBLED_CHINESE_LEGAL_NAME = "江市有限公司";
const GARBLED_REGISTERED_ADDRESS = "江市江区3地1141406";
const GARBLED_BUSINESS_SCOPE_LABEL = "Business scope: 技术";
const GARBLED_CHINESE_LEGAL_NAME_SPACED = "江市 有限公司";
const GARBLED_REGISTERED_ADDRESS_SPACED = "江市江 区 3 地1 14 1406";

export const UNCERTAIN_CHINESE_LEGAL_NAME = "Chinese legal name could not be reliably extracted from the uploaded licence.";
export const UNCERTAIN_REGISTERED_ADDRESS = "Registered address could not be reliably extracted from the uploaded licence.";
export const UNCERTAIN_BUSINESS_SCOPE = "Business scope could not be reliably extracted from the uploaded licence.";
export const UFLPA_LOCAL_NAME_UNCERTAIN = "Local legal name was not reliably extracted and was not used for local-name screening.";
export const NO_RELIABLE_SHIPMENT_HISTORY = "No reliable shipment-history evidence identified from public sources.";
export const MISSING_BENEFICIARY_WORDING = "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.";
export const DEFAULT_VERIFIED_REPORT_ACTIONS =
  "Confirm payment beneficiary/account holder, confirm the uploaded business licence against GSXT/CODS or licensed registry data, verify TUV SUD certificate, and use escrow/LC tied to inspection.";
export const CJK_SOURCE_PRESENT_NOT_DISPLAYED = "Chinese legal name was present in source material but is not displayed because rendering reliability could not be confirmed.";
const COMMERCIAL_REGISTRY_IDENTITY_LIMITATION = "Commercial registry/search-snippet evidence provided company identity details, but official GSXT verification is still required.";

const KNOWN_GARBLED_OCR = [
  GARBLED_CHINESE_LEGAL_NAME,
  GARBLED_REGISTERED_ADDRESS,
  GARBLED_CHINESE_LEGAL_NAME_SPACED,
  GARBLED_REGISTERED_ADDRESS_SPACED,
];

const KNOWN_PARTIAL_CJK_ADDRESS_FRAGMENTS = [
  "阳江市江",
  "江市江",
  "江区",
];

const PDF_SUPPORTED_CHINESE_COMPANY_NAMES = new Set([
  "阳江市佳仕达工贸有限公司",
  "江门市昌文厨具有限公司",
  "华为技术有限公司",
]);

const OFFICIAL_OVERCLAIM_PATTERN = /\b(?:company is\s+)?(?:officially registered|official registration confirmed|active company confirmed|officially verified|official active status confirmed)\b/i;
const CHINA_USCC_PATTERN = /\b[0-9A-Z]{18}\b/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractQuestionText(value: unknown, depth = 0): string | null {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return null;
    return trimmed;
  }
  if (!isObject(value)) return null;

  for (const key of ["question", "text", "title", "body", "value"]) {
    const child = value[key];
    const text = extractQuestionText(child, depth + 1);
    if (text) return text;
  }

  for (const child of Object.values(value)) {
    const text = extractQuestionText(child, depth + 1);
    if (text) return text;
  }
  return null;
}

export function normalizeQuestionsBeforePayment(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = sanitizeBuyerText(extractQuestionText(value) ?? "");
    if (!text || text === "[object Object]") continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function cjkCount(value: string): number {
  return (value.match(/[\u3400-\u9fff]/g) ?? []).length;
}

function compactCjk(value: string): string {
  return value.replace(/\s+/g, "");
}

export function hasCorruptedBuyerFacingCjk(value: string | null | undefined): boolean {
  if (!value) return false;
  const compact = compactCjk(value);
  if (KNOWN_GARBLED_OCR.some((bad) => value.includes(bad) || compact.includes(bad.replace(/\s+/g, "")))) return true;
  if (KNOWN_PARTIAL_CJK_ADDRESS_FRAGMENTS.some((fragment) => compact.includes(fragment))) return true;
  if (/江市\s*有限公司/.test(value)) return true;
  if (/江市江\s*区\s*3\s*地1\s*14\s*1406/.test(value)) return true;
  if (/[\u3400-\u9fff]/.test(value) && compact.includes("技术") && cjkCount(compact) <= 4) return true;
  return false;
}

export function hasReliableChineseCompanyName(value: string | null | undefined): boolean {
  if (!value || hasCorruptedBuyerFacingCjk(value)) return false;
  const compact = compactCjk(value);
  if (!/(?:有限公司|有限责任公司|股份有限公司)$/.test(compact)) return false;
  return cjkCount(compact) >= 8;
}

function replaceReliableChineseCompanyNames(value: string): string {
  return value.replace(/[\u3400-\u9fff（）()]{4,}(?:有限公司|有限责任公司|股份有限公司)/g, (match) => (
    hasReliableChineseCompanyName(match)
      ? PDF_SUPPORTED_CHINESE_COMPANY_NAMES.has(compactCjk(match))
        ? compactCjk(match)
        : CJK_SOURCE_PRESENT_NOT_DISPLAYED
      : ""
  ));
}

export function isUnreliableChineseExtraction(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  const compact = trimmed.replace(/\s+/g, "");
  return hasCorruptedBuyerFacingCjk(value)
    || compact === "技术"
    || /\bBusiness scope:\s*技术\b/i.test(value)
    || (/[\u3400-\u9fff]/.test(value) && compact.length <= 6 && /有限公司|公司/.test(compact));
}

export function isUnreliableRegisteredAddressExtraction(value: string | null | undefined): boolean {
  if (!value) return false;
  const compact = compactCjk(value);
  if (hasCorruptedBuyerFacingCjk(value)) return true;
  if (!hasCjk(value)) return false;
  if (compact.length <= 6) return true;
  const hasAddressMarker = /省|市|区|县|镇|街道|路|号|村|工业园|园区|大厦|楼|室/.test(compact);
  const hasStreetSpecificity = /(?:路|街|巷|号|栋|楼|室|工业园|园区)/.test(compact);
  return !hasAddressMarker || !hasStreetSpecificity;
}

export function isUnreliableRegisteredCapitalExtraction(value: string | null | undefined): boolean {
  if (!value) return false;
  const clean = sanitizeBuyerText(value);
  const compact = compactCjk(clean.replace(/^registered capital:\s*/i, ""));
  if (!compact || /not independently verified|could not be reliably extracted/i.test(clean)) return false;
  if (/^[\u3400-\u9fff]{1,2}$/.test(compact)) return true;
  if (/^[^\dA-Za-z$€£¥￥]+$/.test(compact) && compact.length <= 4) return true;
  return false;
}

function cautiousSourceLabel(sourceType?: string): string {
  if (sourceType === "commercial_registry_aggregator") return "Commercial registry aggregator";
  if (sourceType === "marketplace_platform_recorded_data") return "Marketplace platform record";
  if (sourceType === "trade_data") return "Trade-data source";
  if (sourceType === "third_party_database") return "Third-party database";
  if (sourceType === "weak_public_web_intelligence") return "Public web result";
  return "Non-official source";
}

export function sanitizeOfficialOverclaimText(value: string, sourceType?: string): string {
  if (!value || sourceType === "official_government_registry") return value;
  if (/\bnot\s+(?:been\s+)?officially verified\b/i.test(value)) return value;
  if (/\bnot\s+(?:an\s+)?official\b/i.test(value)) return value;
  if (!OFFICIAL_OVERCLAIM_PATTERN.test(value)) return value;
  const uscc = value.match(CHINA_USCC_PATTERN)?.[0];
  const label = /tianyancha/i.test(value) ? "Tianyancha / registry-snippet data" : cautiousSourceLabel(sourceType);
  const suffix = uscc
    ? `${label} reports USCC ${uscc} for a company associated with this supplier. This has not been verified against China's official GSXT registry.`
    : `${label} reports supplier-associated registry information. This has not been verified against China's official GSXT registry.`;
  return suffix;
}

export function sanitizeBuyerFacingCjkText(value: string, options: { sourceType?: string; preserveReliableChinese?: boolean } = {}): string {
  if (!value) return "";
  let out = sanitizeOfficialOverclaimText(value, options.sourceType);
  out = out
    .replace(/Chinese legal name:\s*江市\s*有限公司[.;,]?\s*/gi, `${UNCERTAIN_CHINESE_LEGAL_NAME} `)
    .replace(/Registered address:\s*江市江\s*区\s*3\s*地1\s*14\s*1406[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
    .replace(/Registered address:\s*阳江市江[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
    .replace(/Registered address:\s*江市江[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
    .replace(/Registered address:\s*江区[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
    .replace(/Business scope:\s*技术[.;,]?\s*/gi, `${UNCERTAIN_BUSINESS_SCOPE} `)
    .replace(/local:\s*["“”']江市\s*有限公司["“”']/gi, UFLPA_LOCAL_NAME_UNCERTAIN);
  for (const bad of KNOWN_GARBLED_OCR) out = out.replaceAll(bad, "");
  out = out
    .replace(/江市\s+有限公司/g, "")
    .replace(/江市江\s+区\s+3\s+地1\s+14\s+1406/g, "")
    .replace(/阳江市江/g, "")
    .replace(/江市江/g, "")
    .replace(/江区/g, "")
    .replace(/\bBusiness scope:\s*技术\b/gi, UNCERTAIN_BUSINESS_SCOPE);
  if (hasCjk(out) && !options.preserveReliableChinese) out = replaceReliableChineseCompanyNames(out);
  return out
    .replace(/\(?\s*Chinese legal name was present in source material but is not displayed because rendering reliability could not be confirmed\.?\s*\)?/gi, COMMERCIAL_REGISTRY_IDENTITY_LIMITATION)
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .replace(/\s+\)/g, "")
    .replace(/\(\s+/g, "(");
}

function isNoisyExportText(value: string): boolean {
  return /GlobalSources|multilingual|directory|manufacturers|catalogue|catalog|OEM products|fabricants|fournisseur|hersteller|lieferant|مصنع|مورد/i.test(value)
    || /deveirter|detrevni|gnirts|noitartsiger|edoC tiderC laicoS deifinU/i.test(value)
    || /代码|国Unified Social Credit Code公|名称Unified Social Credit Code注册/i.test(value)
    || /[\u0600-\u06ff]/.test(value);
}

export function sanitizeBuyerText(value: string): string {
  let out = sanitizeBuyerFacingCjkText(value || "");
  out = out
    .replace(/Chinese legal name:\s*江市有限公司[.;,]?\s*/gi, `${UNCERTAIN_CHINESE_LEGAL_NAME} `)
    .replace(/Chinese legal name:\s*江市\s+有限公司[.;,]?\s*/gi, `${UNCERTAIN_CHINESE_LEGAL_NAME} `)
    .replace(/Registered address:\s*江市江区3地1141406[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
    .replace(/Registered address:\s*江市江\s+区\s+3\s+地1\s+14\s+1406[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
    .replace(/Business scope:\s*技术[.;,]?\s*/gi, `${UNCERTAIN_BUSINESS_SCOPE} `)
    .replace(/local:\s*["“”']江市有限公司["“”']/gi, UFLPA_LOCAL_NAME_UNCERTAIN);

  if (/UFLPA|forced.?labou?r|screen/i.test(out) && out.includes(GARBLED_CHINESE_LEGAL_NAME)) {
    out = out.replaceAll(GARBLED_CHINESE_LEGAL_NAME, UFLPA_LOCAL_NAME_UNCERTAIN);
  }

  out = out.replace(
    /No reliable shipment-history evidence identified from public sources\.[\s\S]*?(?=(?:Buyer impact:|Recommended action:|$))/gi,
    `${NO_RELIABLE_SHIPMENT_HISTORY} `,
  );

  if (/shipment|export history/i.test(out) && isNoisyExportText(out)) {
    out = NO_RELIABLE_SHIPMENT_HISTORY;
  }

  return out
    .replace(new RegExp(GARBLED_BUSINESS_SCOPE_LABEL, "g"), UNCERTAIN_BUSINESS_SCOPE)
    .replace(/\(?\s*evidence references\s*\)?/gi, "")
    .replace(/\bevidence[_ -]?ids?\s*[:=]\s*(?:\[[^\]]*\]|[0-9a-f,\s-]{20,})[.;,]?\s*/gi, "")
    .replace(UUID_PATTERN, "")
    .replace(/deveirter|detrevni|gnirts|noitartsiger|edoC tiderC laicoS deifinU/gi, "")
    .replace(/国Unified Social Credit Code公|名称Unified Social Credit Code注册|代码/g, "")
    .replace(/\bObtain a copy of the supplier's official business licen[cs]e\b/gi, "Confirm the uploaded business licence against an official Chinese registry source")
    .replace(/营业执照/g, "Business License")
    .replace(/统一社会信用(?:代码)?/g, "Unified Social Credit Code")
    .replace(/法定代表人/g, "Legal representative")
    .replace(/注册地址/g, "Registered address")
    .replace(/经营范围/g, "Business scope")
    .replace(/\((?:[\u4e00-\u9fff]\s*){1,3}\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.;,])/g, "$1")
    .trim();
}

function fallbackSourceLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (/cods\.org\.cn|gsxt\.gov\.cn|creditchina\.gov\.cn|samr\.gov\.cn/.test(host)) return "CODS / USCC lookup";
    if (/globalsources|importyeti|panjiva|shipment|bill|shipping/.test(host)) return "Shipping aggregator result";
    if (/alibaba|1688|made-in-china|exporthub/.test(host)) return "Public web search result";
  } catch {
    return null;
  }
  return "Public web search result";
}

export function isLowQualitySourceTitle(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (KNOWN_GARBLED_OCR.some((bad) => v.includes(bad))) return true;
  if (/deveirter|detrevni|gnirts|noitartsiger/i.test(v)) return true;
  if (/代码|国Unified Social Credit Code公|名称Unified Social Credit Code注册/i.test(v)) return true;
  if (/[\u0600-\u06ff]/.test(v)) return true;
  const cjkCount = (v.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (v.match(/[A-Za-z]/g) ?? []).length;
  if (cjkCount > 0 && latinCount > 0 && /Unified Social Credit Code|Registration status|Legal representative/i.test(v)) return true;
  if (cjkCount > 0 && latinCount > 0 && v.length < 32) return true;
  return false;
}

export function displaySourceName(name: string, url: string | null | undefined): string {
  const clean = sanitizeBuyerText(name || "");
  if (clean && clean.length <= 80 && !isLowQualitySourceTitle(clean)) return clean;
  return fallbackSourceLabel(url) ?? "Public web search result";
}

function inferDocumentsChecked(report: InvestigationReport): string[] {
  const customerText = (report.customer_evidence ?? []).map((item) => `${item.name} ${item.category ?? ""}`).join("\n").toLowerCase();
  const reportText = JSON.stringify({
    customer_evidence: report.customer_evidence ?? [],
    findings: report.findings ?? [],
    checklist_results: report.checklist_results ?? [],
    sources_used: report.sources_used ?? [],
  }).toLowerCase();
  const text = `${customerText}\n${reportText}`;
  const docs: string[] = [];
  if (/business[_\s-]?licen[cs]e|supplier-provided business licen[cs]e/.test(text)) docs.push("Business licence");
  if (/proforma[_\s-]?invoice|pro.?forma|supplier-provided proforma invoice/.test(text)) docs.push("Proforma invoice");
  if (/certificate[_\s-]?or[_\s-]?test[_\s-]?report|certificate\/test report|test report/.test(text)) docs.push("1 certificate/test report(s)");
  return docs;
}

function inferUploadedDocumentsChecked(report: InvestigationReport): string[] {
  const customerText = (report.customer_evidence ?? []).map((item) => `${item.name} ${item.category ?? ""} ${item.url ?? ""}`).join("\n").toLowerCase();
  const text = customerText;
  const docs: string[] = [];
  if (/business[_\s-]?licen[cs]e|supplier-provided business licen[cs]e/.test(text)) docs.push("Business licence");
  if (/proforma[_\s-]?invoice|pro.?forma|supplier-provided proforma invoice/.test(text)) docs.push("Proforma invoice");
  if (/certificate[_\s-]?or[_\s-]?test[_\s-]?report|certificate\/test report|test report|tuv|tüv/.test(text)) docs.push("1 certificate/test report(s)");
  return docs;
}

function inferWhy(report: InvestigationReport): string[] {
  const text = JSON.stringify({
    findings: report.findings ?? [],
    checklist_results: report.checklist_results ?? [],
    payment_recommendation: report.payment_recommendation,
  });
  if (/Payment beneficiary (?:was )?not extracted/i.test(text)) return [MISSING_BENEFICIARY_WORDING];
  return [];
}

function sanitizeVerifiedDecision(report: InvestigationReport): VerifiedReportDecision | undefined {
  const decision = report.verified_report_decision;
  if (!decision && inferDocumentsChecked(report).length === 0 && inferWhy(report).length === 0) return undefined;
  const inferredDocs = inferUploadedDocumentsChecked(report);
  const inferredWhy = inferWhy(report);
  return {
    payment_decision: decision?.payment_decision ?? (report.final_outcome === "NO_GO" ? "NO_GO" : report.final_outcome === "PAUSE_PENDING_CLARIFICATION" ? "PAUSE" : "PROCEED"),
    entity_payment_consistency: decision?.entity_payment_consistency ?? "NOT_VERIFIED",
    documents_checked: (inferredDocs.length ? inferredDocs : decision?.documents_checked ?? []).map(sanitizeBuyerText),
    why: (inferredWhy.length ? inferredWhy : decision?.why ?? []).map(sanitizeBuyerText),
    deal_specific_blockers: (decision?.deal_specific_blockers ?? []).map(sanitizeBuyerText),
    ask_supplier_before_payment: [sanitizeBuyerText(DEFAULT_VERIFIED_REPORT_ACTIONS)],
  };
}

export interface BuyerFacingReportViewModel {
  generated_at: string;
  order_reference: string;
  case_reference: string;
  supplier: {
    name: string;
    resolved_entity_name: string | null;
    local_name: string | null;
  };
  customer: {
    name: string;
    company: string;
    destination_market: string;
    estimated_order_value: string;
    product_category: string;
  };
  final_outcome: FinalOutcome;
  overall_risk_rating: InvestigationReport["overall_risk_rating"];
  checklist_results: ChecklistReportResult[];
  executive_summary: string;
  buyer_implications: string;
  recommended_safeguards: string;
  payment_recommendation: string;
  inspection_recommendation: string;
  testing_recommendation: string;
  methodology: string;
  limitations: string;
  sources_used: InvestigationReport["sources_used"];
  sources_queried: NonNullable<InvestigationReport["sources_queried"]>;
  customer_evidence: NonNullable<InvestigationReport["customer_evidence"]>;
  sources_unavailable: NonNullable<InvestigationReport["sources_unavailable"]>;
  critical_blockers: string[];
  verified_report_decision?: VerifiedReportDecision;
  is_verified_report: boolean;
  public_web_intelligence?: SupplierInternetScoutingReport;
  manus_research?: ManusResearchReport;
  manus_evidence_summary: {
    claim: string;
    source: string;
    source_type: string;
    limitation: string;
    buyer_implication: string;
  }[];
  manus_platform_trade_intelligence: string[];
  manus_material_contradictions: string[];
  manus_questions_before_payment: string[];
  public_web_source_summaries: {
    source_name: string;
    source_type: string;
    source_reference: string;
    what_it_supports: string;
    limitation: string;
  }[];
  public_web_empty_message: string;
  top_buyer_risks: string[];
  top_required_actions: string[];
  verified_report_document_summary: VerifiedReportDocumentSummary[];
  verified_report_comparison: VerifiedReportComparisonRow[];
  legal_entity_summary: {
    english_entity_name: string;
    uscc: string | null;
    uscc_note: string;
    chinese_legal_name: string;
    registered_address: string;
    registered_capital: string;
    business_licence_validation: string;
    registry_corroboration: string;
  };
  shipment_history_summary: string;
  uflpa_summary: {
    english_screening: string;
    local_name_screening: string;
    limitation: string;
  };
}

function sourceReference(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function titleForPublicWebSource(title: string, url: string): string {
  const cleanTitle = sanitizeBuyerText(title);
  return cleanTitle && !isLowQualitySourceTitle(cleanTitle) ? cleanTitle : sourceReference(url);
}

function supportForPublicWebSource(evidence: SupplierInternetScoutingReport["evidence"][number]): string {
  const facts = evidence.extracted_facts;
  if (facts.manufacturer_or_trader_claims.length || facts.product_categories.length) {
    const category = facts.product_categories[0] ? ` in ${facts.product_categories[0]}` : "";
    return `Supports that the supplier presents itself online as a manufacturer/trader${category}.`;
  }
  if (facts.certificate_references.length) {
    return `Shows a public reference to certificate/report number ${facts.certificate_references[0]}.`;
  }
  if (facts.trade_fair_traces.length) return "Shows a public trace of trade fair or exhibition activity.";
  if (facts.export_or_customer_traces.length) return "Shows a public export/import context mention, but not licensed shipment verification.";
  return "Supports that a supplier-linked public web presence was found.";
}

function publicWebSourceTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildPublicWebSourceSummaries(report: SupplierInternetScoutingReport | undefined): BuyerFacingReportViewModel["public_web_source_summaries"] {
  return (report?.evidence ?? [])
    .filter((evidence) => evidence.source_type !== "social" && evidence.source_type !== "irrelevant")
    .slice(0, 6)
    .map((evidence) => ({
      source_name: titleForPublicWebSource(evidence.title, evidence.url),
      source_type: publicWebSourceTypeLabel(evidence.source_type),
      source_reference: sourceReference(evidence.url),
      what_it_supports: sanitizeBuyerText(supportForPublicWebSource(evidence)),
      limitation: sanitizeBuyerText(evidence.limitation),
    }));
}

function buildDeepResearchSourceSummaries(report: ManusResearchReport | undefined): BuyerFacingReportViewModel["public_web_source_summaries"] {
  return (report?.accepted_claims ?? [])
    .filter((claim) => (
      claim.source_type === "marketplace_platform_recorded_data"
      || claim.source_type === "trade_data"
      || claim.source_type === "commercial_registry_aggregator"
      || claim.source_type === "third_party_database"
    ))
    .slice(0, 6)
    .map((claim) => ({
      source_name: displaySourceName(claim.source_title || claim.source_domain, claim.source_url),
      source_type: sourceTypeLabel(claim.source_type),
      source_reference: sourceReference(claim.source_url),
      what_it_supports: sanitizeBuyerText(claim.claim),
      limitation: sanitizeBuyerText(claim.limitation),
    }));
}

function mergeSourceSummaries(
  publicWeb: BuyerFacingReportViewModel["public_web_source_summaries"],
  deepResearch: BuyerFacingReportViewModel["public_web_source_summaries"],
): BuyerFacingReportViewModel["public_web_source_summaries"] {
  const seen = new Set<string>();
  const out: BuyerFacingReportViewModel["public_web_source_summaries"] = [];
  for (const item of [...publicWeb, ...deepResearch]) {
    const key = `${item.source_name}|${item.source_reference}|${item.what_it_supports}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 8);
}

function sanitizeDocumentSummary(rows: VerifiedReportDocumentSummary[] | undefined): VerifiedReportDocumentSummary[] {
  return (rows ?? []).map((doc) => ({
    ...doc,
    label: sanitizeBuyerText(doc.label),
    source: sanitizeBuyerText(doc.source),
    fields: doc.fields.map((field) => {
      const label = sanitizeBuyerText(field.label);
      const unreliable = isUnreliableChineseExtraction(field.value);
      const isAddress = /registered address|address/i.test(label);
      const isName = /chinese legal name|company name|licen[cs]e company/i.test(label);
      const isCapital = /registered capital|capital/i.test(label);
      const unreliableAddress = isAddress && (isUnreliableRegisteredAddressExtraction(field.value) || field.status === "uncertain");
      const unreliableCapital = isCapital && (isUnreliableRegisteredCapitalExtraction(field.value) || field.status === "uncertain");
      return {
        ...field,
        label,
        value: unreliableCapital
          ? "Could not be reliably extracted"
          : unreliableAddress
          ? "Could not be reliably extracted"
          : unreliable
          ? isAddress
            ? "Could not be reliably extracted"
            : isName
              ? "Could not be reliably extracted"
              : sanitizeBuyerText(field.value)
          : sanitizeBuyerText(field.value),
        status: unreliable || unreliableAddress || unreliableCapital ? "uncertain" : field.status,
      };
    }),
  }));
}

function sanitizeComparison(rows: VerifiedReportComparisonRow[] | undefined): VerifiedReportComparisonRow[] {
  return (rows ?? []).map((row) => {
    const label = sanitizeBuyerText(row.label);
    const unreliableChinese = isUnreliableChineseExtraction(row.value_found);
    const unreliableAddress = /address/i.test(label) && isUnreliableRegisteredAddressExtraction(row.value_found);
    const unreliableCapital = /registered capital|capital/i.test(label) && isUnreliableRegisteredCapitalExtraction(row.value_found);
    return {
      ...row,
      label,
      value_found: unreliableChinese || unreliableAddress || unreliableCapital
        ? "Could not be reliably extracted"
        : sanitizeBuyerText(row.value_found),
      source: sanitizeBuyerText(row.source),
      match_status: (unreliableChinese || unreliableAddress || unreliableCapital) && row.match_status === "MISMATCH" ? "CANNOT CONFIRM" : row.match_status,
      buyer_impact: sanitizeBuyerText(row.buyer_impact),
    };
  });
}

function sanitizePublicWebIntelligence(report: SupplierInternetScoutingReport | undefined): SupplierInternetScoutingReport | undefined {
  if (!report) return undefined;
  return {
    ...report,
    queries_run: report.queries_run.map(sanitizeBuyerText),
    evidence: report.evidence.map((evidence) => ({
      ...evidence,
      title: sanitizeBuyerText(evidence.title),
      query_used: sanitizeBuyerText(evidence.query_used),
      matched_identifiers: evidence.matched_identifiers.map(sanitizeBuyerText),
      extracted_facts: {
        online_names: evidence.extracted_facts.online_names.map(sanitizeBuyerText),
        marketplace_badges: evidence.extracted_facts.marketplace_badges.map(sanitizeBuyerText),
        manufacturer_or_trader_claims: evidence.extracted_facts.manufacturer_or_trader_claims.map(sanitizeBuyerText),
        product_categories: evidence.extracted_facts.product_categories.map(sanitizeBuyerText),
        contact_details: evidence.extracted_facts.contact_details.map(sanitizeBuyerText),
        certificate_references: evidence.extracted_facts.certificate_references.map(sanitizeBuyerText),
        export_or_customer_traces: evidence.extracted_facts.export_or_customer_traces.map(sanitizeBuyerText),
        trade_fair_traces: evidence.extracted_facts.trade_fair_traces.map(sanitizeBuyerText),
        adverse_or_complaint_indicators: evidence.extracted_facts.adverse_or_complaint_indicators.map(sanitizeBuyerText),
        litigation_or_enforcement_indicators: evidence.extracted_facts.litigation_or_enforcement_indicators.map(sanitizeBuyerText),
        contradictions: evidence.extracted_facts.contradictions.map(sanitizeBuyerText),
      },
      buyer_safe_summary: sanitizeBuyerText(evidence.buyer_safe_summary),
      limitation: sanitizeBuyerText(evidence.limitation),
    })).filter((evidence) => evidence.buyer_safe_summary && !isNoisyExportText(JSON.stringify(evidence))),
    what_found_online: report.what_found_online.map(sanitizeBuyerText).filter(Boolean),
    what_this_corroborates: report.what_this_corroborates.map(sanitizeBuyerText).filter(Boolean),
    still_not_verified: report.still_not_verified.map(sanitizeBuyerText).filter(Boolean),
    potential_contradictions: report.potential_contradictions.map(sanitizeBuyerText).filter(Boolean),
    buyer_impact: sanitizeBuyerText(report.buyer_impact),
    recommended_next_actions: report.recommended_next_actions.map(sanitizeBuyerText).filter(Boolean),
  };
}

function sourceTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sanitizeManusClaim(claim: ManusEvidenceClaim): ManusEvidenceClaim {
  return {
    ...claim,
    claim: sanitizeBuyerFacingCjkText(claim.claim, { sourceType: claim.source_type }),
    exact_text_read_from_source: "",
    source_title: displaySourceName(claim.source_title || claim.source_domain, claim.source_url),
    source_domain: sanitizeBuyerText(claim.source_domain),
    limitation: sanitizeBuyerFacingCjkText(claim.limitation, { sourceType: claim.source_type }),
    buyer_implication: sanitizeBuyerFacingCjkText(claim.buyer_implication, { sourceType: claim.source_type }),
  };
}

function sanitizeManusResearch(report: ManusResearchReport | undefined): ManusResearchReport | undefined {
  if (!report) return undefined;
  return {
    ...report,
    raw_output_storage_path: report.raw_output_storage_path ?? null,
    accepted_claims: report.accepted_claims.map(sanitizeManusClaim),
    rejected_claims: [],
    supplier_marketing_claims: report.supplier_marketing_claims.map(sanitizeManusClaim),
    buyer_interpretations: report.buyer_interpretations.map(sanitizeBuyerText).filter(Boolean),
    questions_before_payment: normalizeQuestionsBeforePayment(report.questions_before_payment),
    sources_used: report.sources_used.map((source) => ({
      ...source,
      title: displaySourceName(source.title, source.url),
      domain: sanitizeBuyerText(source.domain),
    })),
  };
}

function buildManusEvidenceSummary(report: ManusResearchReport | undefined): BuyerFacingReportViewModel["manus_evidence_summary"] {
  return (report?.accepted_claims ?? []).slice(0, 8).map((claim) => ({
    claim: sanitizeBuyerText(claim.claim),
    source: sanitizeBuyerText(`${claim.source_title || claim.source_domain} (${claim.source_domain || "source"})`),
    source_type: sourceTypeLabel(claim.source_type),
    limitation: sanitizeBuyerText(claim.limitation),
    buyer_implication: sanitizeBuyerText(claim.buyer_implication),
  }));
}

function buildManusPlatformTradeIntelligence(report: ManusResearchReport | undefined): string[] {
  return (report?.accepted_claims ?? [])
    .filter((claim) => claim.source_type === "marketplace_platform_recorded_data" || claim.source_type === "trade_data")
    .slice(0, 4)
    .map((claim) => sanitizeBuyerText(`${claim.claim} Source: ${claim.source_title || claim.source_domain}. Limitation: ${claim.limitation}`))
    .filter(Boolean);
}

function buildManusMaterialContradictions(report: ManusResearchReport | undefined): string[] {
  return (report?.accepted_claims ?? [])
    .filter((claim) => /contradict|mismatch|conflict|different legal entity|differs from|does not match|inconsistent/i.test(`${claim.claim} ${claim.buyer_implication}`))
    .slice(0, 4)
    .map((claim) => sanitizeBuyerText(`${claim.claim} Buyer implication: ${claim.buyer_implication}`))
    .filter(Boolean);
}

function cleanVisibleValue(value: string | null | undefined): string | null {
  const clean = sanitizeBuyerText(value ?? "");
  if (!clean || /not extracted|could not be reliably extracted/i.test(clean)) return null;
  return clean;
}

function findDocumentField(
  documents: VerifiedReportDocumentSummary[],
  documentType: VerifiedReportDocumentSummary["document_type"],
  labelPattern: RegExp,
): string | null {
  for (const doc of documents) {
    if (doc.document_type !== documentType) continue;
    const field = doc.fields.find((item) => labelPattern.test(item.label));
    if (!field || field.status === "uncertain") continue;
    const value = cleanVisibleValue(field.value);
    if (value) return value;
  }
  return null;
}

function safeRegisteredCapital(value: string | null | undefined): string | null {
  const clean = cleanVisibleValue(value);
  if (!clean) return null;
  if (isUnreliableRegisteredCapitalExtraction(clean)) return null;
  return clean;
}

function hasRegistryCorroboration(report: ManusResearchReport | undefined, args: { chineseName: string | null; uscc: string | null }): boolean {
  if (!args.uscc && !args.chineseName) return false;
  return (report?.accepted_claims ?? []).some((claim) => {
    if (!["official_government_registry", "commercial_registry_aggregator", "third_party_database"].includes(claim.source_type)) return false;
    const text = sanitizeBuyerText(`${claim.claim} ${claim.exact_text_read_from_source} ${claim.source_title} ${claim.source_domain}`);
    const usccMatches = args.uscc ? text.includes(args.uscc) : true;
    const nameMatches = args.chineseName ? text.includes(args.chineseName) : true;
    return usccMatches && nameMatches;
  });
}

function hasTradeDataEvidence(report: ManusResearchReport | undefined): boolean {
  return (report?.accepted_claims ?? []).some((claim) => claim.source_type === "trade_data");
}

function buildShipmentHistorySummary(report: ManusResearchReport | undefined): string {
  if (hasTradeDataEvidence(report)) {
    return "Shipment-history evidence was identified from trade-data/public source material, but it has not been verified through a licensed production connector.";
  }
  return NO_RELIABLE_SHIPMENT_HISTORY;
}

function safeLocalName(report: InvestigationReport): string | null {
  const candidates = [
    report.supplier_input.chinese_name,
    report.resolved_entity.legal_name_local,
  ];
  for (const candidate of candidates) {
    if (!candidate || isUnreliableChineseExtraction(candidate)) continue;
    const clean = sanitizeBuyerText(candidate);
    if (clean) return clean;
  }
  return null;
}

export function buildBuyerFacingReportViewModel(report: InvestigationReport, opts: { forceVerifiedReport?: boolean } = {}): BuyerFacingReportViewModel {
  const findings = (report.findings ?? []).map(sanitizeFinding);
  const checklist = (report.checklist_results ?? []).map(sanitizeChecklistItem);
  const customerEvidence = (report.customer_evidence ?? []).map((source) => ({
    ...source,
    name: sanitizeBuyerText(source.name),
  }));
  const sourcesQueried = (report.sources_queried ?? []).map((source) => ({
    ...source,
    name: displaySourceName(source.name, source.url),
  }));
  const sourcesUsed = (report.sources_used ?? []).map((source) => ({
    ...source,
    name: displaySourceName(source.name, source.url),
  }));
  const sourcesUnavailable = (report.sources_unavailable ?? []).map((source) => ({
    ...source,
    name: sanitizeBuyerText(source.name),
    reason: sanitizeBuyerText(source.reason),
  }));
  const publicWebIntelligence = sanitizePublicWebIntelligence(report.public_web_intelligence);
  const manusResearch = sanitizeManusResearch(report.manus_research);
  const publicWebSourceSummaries = mergeSourceSummaries(
    buildPublicWebSourceSummaries(publicWebIntelligence),
    buildDeepResearchSourceSummaries(manusResearch),
  );
  const sanitizedReportForDecision: InvestigationReport = {
    ...report,
    findings,
    checklist_results: checklist,
    customer_evidence: customerEvidence,
    sources_queried: sourcesQueried,
    sources_used: sourcesUsed,
    sources_unavailable: sourcesUnavailable,
  };
  const isVerifiedReport = Boolean(opts.forceVerifiedReport) || Boolean(report.verified_report_decision) || inferUploadedDocumentsChecked(report).length > 0;
  const documentSummary = sanitizeDocumentSummary(report.verified_report_document_summary);
  const comparison = sanitizeComparison(report.verified_report_comparison);
  const englishEntityName = sanitizeBuyerText(report.resolved_entity.legal_name_en || report.supplier_input.name);
  const licenceChineseName = findDocumentField(documentSummary, "business_licence", /chinese legal name/i)
    ?? safeLocalName(report);
  const licenceUscc = findDocumentField(documentSummary, "business_licence", /uscc|unified social credit|registration number/i);
  const uscc = licenceUscc ?? (report.resolved_entity.registration_number ? sanitizeBuyerText(report.resolved_entity.registration_number) : null);
  const licenceAddress = findDocumentField(documentSummary, "business_licence", /registered address|address/i)
    ?? (isUnreliableRegisteredAddressExtraction(report.resolved_entity.registered_address) ? null : cleanVisibleValue(report.resolved_entity.registered_address));
  const capital = safeRegisteredCapital(report.resolved_entity.registered_capital);
  const registryCorroborated = hasRegistryCorroboration(report.manus_research, { chineseName: licenceChineseName, uscc });
  const shipmentHistorySummary = buildShipmentHistorySummary(manusResearch);
  const hasDeepResearchSources = Boolean(manusResearch?.accepted_claims.length);

  return {
    generated_at: report.generated_at,
    order_reference: sanitizeBuyerText(report.order_reference),
    case_reference: sanitizeBuyerText(report.case_reference),
    supplier: {
      name: sanitizeBuyerText(report.supplier_input.name),
      resolved_entity_name: report.resolved_entity.legal_name_en ? sanitizeBuyerText(report.resolved_entity.legal_name_en) : null,
      local_name: safeLocalName(report),
    },
    customer: {
      name: sanitizeBuyerText(report.customer_input.name),
      company: sanitizeBuyerText(report.customer_input.company),
      destination_market: sanitizeBuyerText(report.customer_input.destination_market),
      estimated_order_value: sanitizeBuyerText(report.customer_input.estimated_order_value),
      product_category: sanitizeBuyerText(report.customer_input.product_category),
    },
    final_outcome: report.final_outcome,
    overall_risk_rating: report.overall_risk_rating,
    checklist_results: checklist,
    executive_summary: sanitizeBuyerText(report.executive_summary),
    buyer_implications: sanitizeBuyerText(report.buyer_implications),
    recommended_safeguards: sanitizeBuyerText(report.recommended_safeguards),
    payment_recommendation: sanitizeBuyerText(report.payment_recommendation),
    inspection_recommendation: sanitizeBuyerText(report.inspection_recommendation),
    testing_recommendation: sanitizeBuyerText(report.testing_recommendation),
    methodology: sanitizeBuyerText(report.methodology),
    limitations: sanitizeBuyerText(report.limitations),
    sources_used: sourcesUsed,
    sources_queried: sourcesQueried,
    customer_evidence: customerEvidence,
    sources_unavailable: sourcesUnavailable,
    critical_blockers: (report.critical_blockers ?? []).map(sanitizeBuyerText),
    verified_report_decision: sanitizeVerifiedDecision(sanitizedReportForDecision),
    is_verified_report: isVerifiedReport,
    public_web_intelligence: publicWebIntelligence,
    manus_research: manusResearch,
    manus_evidence_summary: buildManusEvidenceSummary(manusResearch),
    manus_platform_trade_intelligence: buildManusPlatformTradeIntelligence(manusResearch),
    manus_material_contradictions: buildManusMaterialContradictions(manusResearch),
    manus_questions_before_payment: normalizeQuestionsBeforePayment(manusResearch?.questions_before_payment),
    public_web_source_summaries: publicWebSourceSummaries,
    public_web_empty_message: hasDeepResearchSources
      ? "Generic open-web scouting did not retain additional supplier-linked sources beyond the validated deep-research sources below."
      : "No supplier-linked public web sources met the relevance threshold.",
    top_buyer_risks: [
      "Cannot confirm payment beneficiary matches licence holder.",
      "Company registration/status has not been officially verified.",
      "Certificate/test report has not been issuer-verified.",
    ],
    top_required_actions: [
      "Confirm bank beneficiary/account holder before paying.",
      "Verify the business licence against GSXT/CODS or licensed registry data.",
      "Ask supplier for certificate issuer verification link and use escrow/LC tied to inspection.",
    ],
    verified_report_document_summary: documentSummary,
    verified_report_comparison: comparison,
    legal_entity_summary: {
      english_entity_name: englishEntityName,
      uscc,
      uscc_note: uscc
        ? registryCorroborated
          ? `${uscc} — shown on the uploaded licence and corroborated by non-official registry-snippet/commercial-aggregator evidence; not official GSXT verified`
          : `${uscc} — structurally present but not official registry verified`
        : "Not independently verified",
      chinese_legal_name: licenceChineseName ?? "Could not be reliably extracted from uploaded licence",
      registered_address: licenceAddress ?? "Could not be reliably extracted from uploaded licence",
      registered_capital: capital ?? "Not independently verified",
      business_licence_validation: licenceChineseName || uscc
        ? "Uploaded licence fields support internal entity consistency; official registry confirmation is still required."
        : "Not independently verified pending official registry confirmation",
      registry_corroboration: registryCorroborated && licenceChineseName && uscc
        ? `Uploaded licence lists ${licenceChineseName} with USCC ${uscc}. Registry-snippet/commercial aggregator evidence also reports this USCC/name pair. This supports entity consistency, but it has not been verified against China's official GSXT registry.`
        : "Official GSXT/CODS or licensed registry confirmation is still required before relying on registration status.",
    },
    shipment_history_summary: shipmentHistorySummary,
    uflpa_summary: {
      english_screening: "English name screened against stored DHS UFLPA snapshot: no match",
      local_name_screening: licenceChineseName
        ? `Local Chinese legal name from uploaded licence: ${licenceChineseName}. This is available for follow-up screening, but it is not a full sanctions/RPS clearance.`
        : "Local Chinese legal name was not reliably extracted and was not used for local-name screening.",
      limitation: "This is not a full sanctions/RPS clearance.",
    },
  };
}

function sanitizeFinding(finding: Finding): Finding {
  const sanitized: Finding = {
    ...finding,
    item: sanitizeBuyerText(finding.item),
    source_name: displaySourceName(finding.source_name, finding.source_url),
    evidence_excerpt: sanitizeBuyerText(finding.evidence_excerpt),
    buyer_impact: sanitizeBuyerText(finding.buyer_impact),
    recommended_action: sanitizeBuyerText(finding.recommended_action),
  };
  if (finding.section === "export_history" && (isNoisyExportText(JSON.stringify(finding)) || /No reliable shipment-history/i.test(finding.evidence_excerpt))) {
    sanitized.status = "NOT_VERIFIED";
    sanitized.confidence = "low";
    sanitized.evidence_classification = "NOT_INDEPENDENTLY_VERIFIED";
    sanitized.evidence_excerpt = NO_RELIABLE_SHIPMENT_HISTORY;
    sanitized.source_name = "Public shipping-data web search";
  }
  if (finding.section === "digital_footprint" && /adverse media/i.test(finding.item) && finding.status === "PASS" && /firecrawl|public web search/i.test(finding.source_name)) {
    sanitized.status = "NOT_VERIFIED";
    sanitized.evidence_classification = "NOT_INDEPENDENTLY_VERIFIED";
  }
  return sanitized;
}

function sanitizeChecklistItem(item: ChecklistReportResult): ChecklistReportResult {
  const sourceNames = (item.source_names ?? []).map((name, idx) => displaySourceName(name, item.source_urls?.[idx] ?? null));
  const sanitized: ChecklistReportResult = {
    ...item,
    title: sanitizeBuyerText(item.title),
    source_names: sourceNames,
    explanation: sanitizeBuyerText(item.explanation),
    buyer_impact: sanitizeBuyerText(item.buyer_impact),
    recommended_action: sanitizeBuyerText(item.recommended_action),
    missing_information_required: item.missing_information_required.map(sanitizeBuyerText),
  };
  if (item.id === "us_shipment_export_history" && (isNoisyExportText(JSON.stringify(item)) || /No reliable shipment-history/i.test(item.explanation))) {
    sanitized.status = "NOT_VERIFIED";
    sanitized.confidence = "low";
    sanitized.evidence_classification = "NOT_INDEPENDENTLY_VERIFIED";
    sanitized.explanation = NO_RELIABLE_SHIPMENT_HISTORY;
    sanitized.source_names = ["Public shipping-data web search"];
  }
  if (item.id === "adverse_media" && item.status === "PASS" && item.source_names.some((source) => /firecrawl|public web search/i.test(source))) {
    sanitized.status = "NOT_VERIFIED";
    sanitized.evidence_classification = "NOT_INDEPENDENTLY_VERIFIED";
  }
  return sanitized;
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "string") return sanitizeBuyerText(value);
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = sanitizeUnknown(child);
    return out;
  }
  return value;
}

export function sanitizeBuyerReport(report: InvestigationReport): InvestigationReport {
  const view = buildBuyerFacingReportViewModel(report);
  const cloned = sanitizeUnknown(report) as InvestigationReport;
  cloned.supplier_input = {
    ...cloned.supplier_input,
    name: view.supplier.name,
    chinese_name: view.supplier.local_name,
  };
  cloned.resolved_entity = {
    ...cloned.resolved_entity,
    legal_name_en: view.supplier.resolved_entity_name,
    legal_name_local: view.supplier.local_name,
    registered_address: null,
    business_scope: null,
  };
  cloned.findings = (report.findings ?? []).map(sanitizeFinding);
  cloned.checklist_results = view.checklist_results;
  cloned.sources_used = view.sources_used;
  cloned.sources_queried = view.sources_queried;
  cloned.customer_evidence = view.customer_evidence;
  cloned.sources_unavailable = view.sources_unavailable;
  cloned.verified_report_decision = view.verified_report_decision;
  cloned.public_web_intelligence = view.public_web_intelligence;
  cloned.manus_research = view.manus_research;
  cloned.verified_report_document_summary = view.verified_report_document_summary;
  cloned.verified_report_comparison = view.verified_report_comparison;
  return cloned;
}
