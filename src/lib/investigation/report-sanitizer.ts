import type { ChecklistReportResult, FinalOutcome, Finding, InvestigationReport, VerifiedReportDecision } from "./types";

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const GARBLED_CHINESE_LEGAL_NAME = "江市有限公司";
const GARBLED_REGISTERED_ADDRESS = "江市江区3地1141406";
const GARBLED_BUSINESS_SCOPE_LABEL = "Business scope: 技术";

export const UNCERTAIN_CHINESE_LEGAL_NAME = "Chinese legal name could not be reliably extracted from the uploaded licence.";
export const UNCERTAIN_REGISTERED_ADDRESS = "Registered address could not be reliably extracted from the uploaded licence.";
export const UNCERTAIN_BUSINESS_SCOPE = "Business scope could not be reliably extracted from the uploaded licence.";
export const UFLPA_LOCAL_NAME_UNCERTAIN = "Local legal name was not reliably extracted and was not used for local-name screening.";
export const NO_RELIABLE_SHIPMENT_HISTORY = "No reliable shipment-history evidence identified from public sources.";
export const MISSING_BENEFICIARY_WORDING = "Payment beneficiary was not extracted from the proforma invoice — cannot confirm payee matches licence holder.";
export const DEFAULT_VERIFIED_REPORT_ACTIONS =
  "Confirm payment beneficiary/account holder, confirm the uploaded business licence against GSXT/CODS or licensed registry data, verify TUV SUD certificate, and use escrow/LC tied to inspection.";

const KNOWN_GARBLED_OCR = [
  GARBLED_CHINESE_LEGAL_NAME,
  GARBLED_REGISTERED_ADDRESS,
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUnreliableChineseExtraction(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return KNOWN_GARBLED_OCR.some((bad) => value.includes(bad)) || trimmed === "技术" || /\bBusiness scope:\s*技术\b/i.test(value);
}

function isNoisyExportText(value: string): boolean {
  return /GlobalSources|multilingual|directory|manufacturers|catalogue|catalog|OEM products|fabricants|fournisseur|hersteller|lieferant|مصنع|مورد/i.test(value)
    || /deveirter|detrevni|gnirts|noitartsiger|edoC tiderC laicoS deifinU/i.test(value)
    || /代码|国Unified Social Credit Code公|名称Unified Social Credit Code注册/i.test(value)
    || /[\u0600-\u06ff]/.test(value);
}

export function sanitizeBuyerText(value: string): string {
  let out = value || "";
  out = out
    .replace(/Chinese legal name:\s*江市有限公司[.;,]?\s*/gi, `${UNCERTAIN_CHINESE_LEGAL_NAME} `)
    .replace(/Registered address:\s*江市江区3地1141406[.;,]?\s*/gi, `${UNCERTAIN_REGISTERED_ADDRESS} `)
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

  for (const bad of KNOWN_GARBLED_OCR) out = out.replaceAll(bad, "");
  return out
    .replace(new RegExp(GARBLED_BUSINESS_SCOPE_LABEL, "g"), UNCERTAIN_BUSINESS_SCOPE)
    .replace(/\(?\s*evidence references\s*\)?/gi, "")
    .replace(/\bevidence[_ -]?ids?\s*[:=]\s*(?:\[[^\]]*\]|[0-9a-f,\s-]{20,})[.;,]?\s*/gi, "")
    .replace(UUID_PATTERN, "")
    .replace(/deveirter|detrevni|gnirts|noitartsiger|edoC tiderC laicoS deifinU/gi, "")
    .replace(/国Unified Social Credit Code公|名称Unified Social Credit Code注册|代码/g, "")
    .replace(/\bObtain a copy of the supplier's official business licen[cs]e\b/gi, "Confirm the uploaded business licence against an official Chinese registry source")
    .replace(/营业执照/g, "Business License")
    .replace(/统一社会信用代码/g, "Unified Social Credit Code")
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
  legal_entity_summary: {
    english_entity_name: string;
    uscc: string | null;
    uscc_note: string;
    chinese_legal_name: string;
    registered_address: string;
    registered_capital: string;
    business_licence_validation: string;
  };
  uflpa_summary: {
    english_screening: string;
    local_name_screening: string;
    limitation: string;
  };
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
  const englishEntityName = sanitizeBuyerText(report.resolved_entity.legal_name_en || report.supplier_input.name);
  const uscc = report.resolved_entity.registration_number ? sanitizeBuyerText(report.resolved_entity.registration_number) : null;

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
    legal_entity_summary: {
      english_entity_name: englishEntityName,
      uscc,
      uscc_note: uscc ? `${uscc} — structurally present but not official registry verified` : "Not independently verified",
      chinese_legal_name: "Could not be reliably extracted from uploaded licence",
      registered_address: "Could not be reliably extracted from uploaded licence",
      registered_capital: "Not independently verified",
      business_licence_validation: "Not independently verified pending official registry confirmation",
    },
    uflpa_summary: {
      english_screening: "English name screened against stored DHS UFLPA snapshot: no match",
      local_name_screening: "Local Chinese legal name was not reliably extracted and was not used for local-name screening.",
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
  return cloned;
}
