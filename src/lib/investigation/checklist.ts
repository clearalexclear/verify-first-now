import type {
  EvidenceClassification,
  Finding,
  FindingConfidence,
  FindingStatus,
  FinalOutcome,
  InvestigationReport,
  ReportSectionKey,
  ResolvedEntity,
} from "./types";

export type ChecklistId =
  | "legal_company_existence"
  | "chinese_legal_name"
  | "unified_social_credit_code"
  | "registration_status"
  | "incorporation_date"
  | "registered_capital"
  | "legal_representative"
  | "registered_address"
  | "business_scope"
  | "shareholders_beneficial_ownership"
  | "related_companies"
  | "factory_vs_trader"
  | "website_domain_consistency"
  | "contact_information_consistency"
  | "supplier_document_consistency"
  | "business_licence_validation"
  | "certificate_authenticity"
  | "iso_management_certificates"
  | "product_certificates_test_reports"
  | "sanctions_restricted_party"
  | "uflpa_forced_labour"
  | "litigation_court_records"
  | "enforcement_administrative_penalties"
  | "adverse_media"
  | "us_shipment_export_history"
  | "buyer_customer_history"
  | "product_recall_history"
  | "product_specific_us_regulatory_risks"
  | "red_flags_contradictions"
  | "missing_information_required"
  | "final_outcome"
  | "recommended_next_actions";

export interface ChecklistDefinition {
  id: ChecklistId;
  title: string;
  section: ReportSectionKey;
  paid_connector_dependency: string | null;
}

export interface ChecklistResult extends ChecklistDefinition {
  status: FindingStatus;
  evidence_classification: EvidenceClassification;
  confidence: FindingConfidence;
  source_names: string[];
  source_urls: string[];
  evidence_ids: string[];
  explanation: string;
  buyer_impact: string;
  recommended_action: string;
  missing_information_required: string[];
  last_retrieval_date: string | null;
}

export const CANONICAL_CHECKLIST: ChecklistDefinition[] = [
  { id: "legal_company_existence", title: "Legal company existence", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "chinese_legal_name", title: "Chinese legal name", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "unified_social_credit_code", title: "Unified Social Credit Code", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "registration_status", title: "Registration status", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "incorporation_date", title: "Incorporation date", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "registered_capital", title: "Registered capital", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "legal_representative", title: "Legal representative", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "registered_address", title: "Registered address", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "business_scope", title: "Business scope", section: "legal_entity", paid_connector_dependency: "QCC International API" },
  { id: "shareholders_beneficial_ownership", title: "Shareholders and beneficial ownership", section: "ownership", paid_connector_dependency: "QCC International API" },
  { id: "related_companies", title: "Related companies", section: "ownership", paid_connector_dependency: "QCC International API" },
  { id: "factory_vs_trader", title: "Factory versus trader assessment", section: "factory_vs_trader", paid_connector_dependency: "QCC International API / ImportGenius API" },
  { id: "website_domain_consistency", title: "Website/domain consistency", section: "digital_footprint", paid_connector_dependency: null },
  { id: "contact_information_consistency", title: "Contact information consistency", section: "digital_footprint", paid_connector_dependency: "QCC International API" },
  { id: "supplier_document_consistency", title: "Supplier document consistency", section: "certificates_documents", paid_connector_dependency: null },
  { id: "business_licence_validation", title: "Business licence validation", section: "certificates_documents", paid_connector_dependency: "QCC International API" },
  { id: "certificate_authenticity", title: "Certificate authenticity", section: "certificates_documents", paid_connector_dependency: "Issuer-specific certificate databases" },
  { id: "iso_management_certificates", title: "ISO management certificates", section: "certificates_documents", paid_connector_dependency: "IAF CertSearch" },
  { id: "product_certificates_test_reports", title: "Product certificates and test reports", section: "certificates_documents", paid_connector_dependency: "Issuer/lab-specific verification sources" },
  { id: "sanctions_restricted_party", title: "Sanctions and restricted-party screening", section: "sanctions_forced_labour", paid_connector_dependency: "OpenSanctions Commercial API" },
  { id: "uflpa_forced_labour", title: "UFLPA/forced-labour screening", section: "sanctions_forced_labour", paid_connector_dependency: null },
  { id: "litigation_court_records", title: "Litigation and court records", section: "litigation_enforcement", paid_connector_dependency: "QCC International API / Chinese court-record provider" },
  { id: "enforcement_administrative_penalties", title: "Enforcement and administrative penalties", section: "litigation_enforcement", paid_connector_dependency: "QCC International API / Chinese administrative-record provider" },
  { id: "adverse_media", title: "Adverse media", section: "digital_footprint", paid_connector_dependency: null },
  { id: "us_shipment_export_history", title: "US shipment/export history", section: "export_history", paid_connector_dependency: "ImportGenius API" },
  { id: "buyer_customer_history", title: "Buyer/customer history where available", section: "export_history", paid_connector_dependency: "ImportGenius API" },
  { id: "product_recall_history", title: "Product recall history", section: "regulatory", paid_connector_dependency: null },
  { id: "product_specific_us_regulatory_risks", title: "Product-specific US regulatory risks", section: "regulatory", paid_connector_dependency: "Product-specific regulatory sources and lab data" },
  { id: "red_flags_contradictions", title: "Red flags and contradictions", section: "payment_safeguards", paid_connector_dependency: null },
  { id: "missing_information_required", title: "Missing information the customer or supplier must provide", section: "payment_safeguards", paid_connector_dependency: null },
  { id: "final_outcome", title: "Final PASS / CAUTION / FAIL / NOT_VERIFIED outcome", section: "payment_safeguards", paid_connector_dependency: null },
  { id: "recommended_next_actions", title: "Recommended next actions", section: "payment_safeguards", paid_connector_dependency: null },
];

export const CHECKLIST_COUNT = 32;

const OFFICIAL_SOURCE_PATTERNS = [
  /qcc/i,
  /importgenius/i,
  /iaf/i,
  /opensanctions/i,
  /dhs uflpa/i,
  /cpsc/i,
  /rdap/i,
];

const FIRECRAWL_RESTRICTED_SECTIONS: ReportSectionKey[] = [
  "legal_entity",
  "export_history",
  "certificates_documents",
  "litigation_enforcement",
  "sanctions_forced_labour",
];

function blank(def: ChecklistDefinition, now: string): ChecklistResult {
  return {
    ...def,
    status: "NOT_VERIFIED",
    evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
    confidence: "low",
    source_names: [],
    source_urls: [],
    evidence_ids: [],
    explanation: "No independent source evidence is available for this checklist item.",
    buyer_impact: "This item cannot be relied on until evidence is retrieved from an appropriate source.",
    recommended_action: def.paid_connector_dependency
      ? `Connect ${def.paid_connector_dependency} or verify this item manually before relying on it.`
      : "Request the missing evidence and re-run the investigation.",
    missing_information_required: [],
    last_retrieval_date: now,
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(hasText)));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/co\.?,? ?ltd\.?|limited|company|inc\.?|corp\.?/g, "")
    .replace(/[\s.,'’“”"()-]+/g, "")
    .trim();
}

function sourceIsOfficial(sourceName: string): boolean {
  return OFFICIAL_SOURCE_PATTERNS.some((pattern) => pattern.test(sourceName));
}

function sourceIsFirecrawl(sourceName: string): boolean {
  return /firecrawl|web search|public shipping-data web search/i.test(sourceName);
}

function resultFromFinding(def: ChecklistDefinition, finding: Finding): ChecklistResult {
  const sourceNames = unique([finding.source_name]);
  const sourceUrls = unique([finding.source_url]);
  let status = finding.status;
  let classification = finding.evidence_classification ?? "NOT_INDEPENDENTLY_VERIFIED";
  let confidence = finding.confidence;
  const evidenceIds = finding.evidence_ids ?? [];

  if (
    evidenceIds.length === 0 ||
    !finding.evidence_excerpt?.trim() ||
    (sourceIsFirecrawl(finding.source_name) && FIRECRAWL_RESTRICTED_SECTIONS.includes(finding.section))
  ) {
    status = "NOT_VERIFIED";
    classification = "NOT_INDEPENDENTLY_VERIFIED";
    confidence = "low";
  } else if (sourceIsFirecrawl(finding.source_name)) {
    classification = classification === "VERIFIED" ? "INFERRED" : classification;
  } else if (!sourceIsOfficial(finding.source_name) && classification === "VERIFIED") {
    classification = "CORROBORATED";
  }

  return {
    ...def,
    status,
    evidence_classification: classification,
    confidence,
    source_names: sourceNames,
    source_urls: sourceUrls,
    evidence_ids: evidenceIds,
    explanation: finding.evidence_excerpt?.trim() || "No independent source evidence is available for this checklist item.",
    buyer_impact: finding.buyer_impact,
    recommended_action: finding.recommended_action,
    missing_information_required: [],
    last_retrieval_date: finding.retrieval_date || null,
  };
}

function bestFinding(findings: Finding[], predicate: (finding: Finding) => boolean): Finding | null {
  const matches = findings.filter(predicate);
  if (matches.length === 0) return null;
  const rank: Record<FindingStatus, number> = { FAIL: 5, CAUTION: 4, PASS: 3, NOT_VERIFIED: 2, NOT_APPLICABLE: 1 };
  return matches.sort((a, b) => rank[b.status] - rank[a.status])[0];
}

function registryFieldResult(
  def: ChecklistDefinition,
  value: string | string[] | null | undefined,
  resolved: ResolvedEntity,
  fieldLabel: string,
  now: string,
): ChecklistResult {
  const out = blank(def, now);
  const text = Array.isArray(value) ? value.join("; ") : value;
  if (!hasText(text)) {
    out.explanation = `${fieldLabel} was not independently verified.`;
    out.missing_information_required = [`Official ${fieldLabel.toLowerCase()} from Chinese corporate registry`];
    return out;
  }
  out.status = "NOT_VERIFIED";
  out.evidence_classification = resolved.sources.length > 0 ? "INFERRED" : "SUPPLIER_CLAIMED";
  out.confidence = resolved.confidence;
  out.source_names = resolved.sources.length > 0 ? unique(resolved.sources.map((s) => s.name)) : ["Supplier/customer provided data"];
  out.source_urls = unique(resolved.sources.map((s) => s.url));
  out.explanation = `${fieldLabel}: ${text}. This is not treated as an official registry verification until QCC evidence is available.`;
  out.buyer_impact = `${fieldLabel} is visible in the investigation record but cannot be relied on as an official corporate-registry fact.`;
  out.recommended_action = "Verify against QCC International API or official Chinese registry records before relying on this item.";
  return out;
}

function missingInputs(report: Pick<InvestigationReport, "supplier_input" | "customer_input">): string[] {
  const missing: string[] = [];
  if (!hasText(report.supplier_input.name)) missing.push("Supplier company name");
  if (!hasText(report.supplier_input.chinese_name)) missing.push("Chinese legal name");
  if (!hasText(report.supplier_input.url)) missing.push("Supplier website or marketplace URL");
  if (!hasText(report.supplier_input.contact)) missing.push("Supplier contact person");
  if (!hasText(report.customer_input.destination_market)) missing.push("Destination market");
  if (!hasText(report.customer_input.product_category)) missing.push("Product category");
  if (!hasText(report.customer_input.estimated_order_value)) missing.push("Estimated order value");
  return missing;
}

export function detectChecklistContradictions(args: {
  supplierInput: InvestigationReport["supplier_input"];
  resolvedEntity: ResolvedEntity;
  findings: Finding[];
}): string[] {
  const contradictions: string[] = [];
  const stated = normalize(args.supplierInput.name);
  const resolvedEn = normalize(args.resolvedEntity.legal_name_en);
  const resolvedLocal = normalize(args.resolvedEntity.legal_name_local);
  const statedLocal = normalize(args.supplierInput.chinese_name);

  if (stated && resolvedEn && stated !== resolvedEn && !resolvedEn.includes(stated) && !stated.includes(resolvedEn)) {
    contradictions.push("Customer-entered supplier name differs from resolved English legal name.");
  }
  if (statedLocal && resolvedLocal && statedLocal !== resolvedLocal) {
    contradictions.push("Customer-entered Chinese supplier name differs from resolved local legal name.");
  }
  for (const finding of args.findings) {
    if (/mismatch|conflict|contradict|different legal entity|beneficiary mismatch|holder name mismatch/i.test(
      `${finding.item} ${finding.evidence_excerpt} ${finding.buyer_impact}`,
    )) {
      contradictions.push(`${finding.item}: ${finding.evidence_excerpt || finding.buyer_impact}`.slice(0, 280));
    }
  }
  return unique(contradictions);
}

function outcomeToStatus(outcome: FinalOutcome): FindingStatus {
  if (outcome === "GO") return "PASS";
  if (outcome === "NO_GO") return "FAIL";
  return "CAUTION";
}

export function buildCanonicalChecklist(report: InvestigationReport): ChecklistResult[] {
  const now = report.generated_at || new Date().toISOString();
  const byId = new Map<ChecklistId, ChecklistResult>();
  for (const def of CANONICAL_CHECKLIST) byId.set(def.id, blank(def, now));
  const put = (id: ChecklistId, result: ChecklistResult) => byId.set(id, result);
  const def = (id: ChecklistId) => CANONICAL_CHECKLIST.find((item) => item.id === id)!;
  const findings = report.findings ?? [];
  const resolved = report.resolved_entity;

  put("legal_company_existence", registryFieldResult(def("legal_company_existence"), resolved.matched ? resolved.legal_name_en || resolved.legal_name_local : null, resolved, "Legal company existence", now));
  put("chinese_legal_name", registryFieldResult(def("chinese_legal_name"), resolved.legal_name_local || report.supplier_input.chinese_name, resolved, "Chinese legal name", now));
  put("unified_social_credit_code", registryFieldResult(def("unified_social_credit_code"), resolved.registration_number, resolved, "Unified Social Credit Code", now));
  put("registration_status", registryFieldResult(def("registration_status"), resolved.registration_status, resolved, "Registration status", now));
  put("incorporation_date", registryFieldResult(def("incorporation_date"), resolved.registration_date, resolved, "Incorporation date", now));
  put("registered_capital", registryFieldResult(def("registered_capital"), resolved.registered_capital, resolved, "Registered capital", now));
  put("legal_representative", registryFieldResult(def("legal_representative"), resolved.legal_representative, resolved, "Legal representative", now));
  put("registered_address", registryFieldResult(def("registered_address"), resolved.registered_address, resolved, "Registered address", now));
  put("business_scope", registryFieldResult(def("business_scope"), resolved.business_scope, resolved, "Business scope", now));
  put("shareholders_beneficial_ownership", registryFieldResult(def("shareholders_beneficial_ownership"), resolved.shareholders, resolved, "Shareholders and beneficial ownership", now));
  put("related_companies", registryFieldResult(def("related_companies"), resolved.related_companies, resolved, "Related companies", now));

  const factory = blank(def("factory_vs_trader"), now);
  const indicators = [...resolved.manufacturer_indicators, ...resolved.trading_indicators];
  if (indicators.length > 0) {
    factory.status = resolved.trading_indicators.length > resolved.manufacturer_indicators.length ? "CAUTION" : "NOT_VERIFIED";
    factory.evidence_classification = "INFERRED";
    factory.confidence = resolved.confidence;
    factory.source_names = resolved.sources.length ? unique(resolved.sources.map((s) => s.name)) : ["Entity resolution web intelligence"];
    factory.source_urls = unique(resolved.sources.map((s) => s.url));
    factory.explanation = `Manufacturer indicators: ${resolved.manufacturer_indicators.join("; ") || "none"}. Trading indicators: ${resolved.trading_indicators.join("; ") || "none"}.`;
    factory.buyer_impact = "Factory/trader assessment is inferred and should be confirmed with registry scope, shipment data, and inspection evidence.";
    factory.recommended_action = "Verify factory status through QCC, shipment data, and pre-shipment or on-site inspection evidence.";
  }
  put("factory_vs_trader", factory);

  // -----------------------------------------------------------------------------------------
  // Evidence -> checklist ALLOWLIST. No generic section-level fallback. Each finding may only
  // populate the checklist items enumerated here. This prevents e.g. UFLPA evidence from ever
  // reaching product_certificates_test_reports, or RDAP evidence from independently verifying
  // website_domain_consistency.
  // -----------------------------------------------------------------------------------------
  const ALLOWLIST: Array<{ id: ChecklistId; match: (f: Finding) => boolean }> = [
    { id: "website_domain_consistency", match: (f) => f.item === "Website and domain consistency" },
    {
      id: "supplier_document_consistency",
      match: (f) =>
        f.source_name === "Customer upload" ||
        /uploaded (business licence|supplier document|document)/i.test(f.item) ||
        f.item.startsWith("Uploaded document") ||
        f.item.startsWith("Uploaded supplier documents"),
    },
    {
      id: "business_licence_validation",
      match: (f) => /business licen[cs]e/i.test(`${f.item}`),
    },
    {
      id: "certificate_authenticity",
      match: (f) =>
        f.section === "certificates_documents" &&
        (f.item === "Certificate authenticity" || /^Certificate:/i.test(f.item)),
    },
    {
      id: "iso_management_certificates",
      match: (f) => /IAF CertSearch|IAF/.test(f.source_name) || /ISO management/i.test(f.item),
    },
    {
      id: "product_certificates_test_reports",
      match: (f) =>
        f.section === "certificates_documents" &&
        /(CE|FDA|REACH|RoHS|test report|Product certificates)/i.test(f.item),
    },
    {
      id: "sanctions_restricted_party",
      match: (f) => /Sanctions|Restricted-party|OpenSanctions/i.test(`${f.item} ${f.source_name}`) && !/UFLPA/i.test(f.item),
    },
    {
      id: "uflpa_forced_labour",
      match: (f) => /UFLPA|forced.?labou?r/i.test(f.item) || /UFLPA/i.test(f.source_name),
    },
    { id: "litigation_court_records", match: (f) => /Litigation and enforcement/i.test(f.item) },
    { id: "enforcement_administrative_penalties", match: (f) => /Enforcement|Administrative penalt|Dishonest debtor/i.test(f.item) },
    { id: "adverse_media", match: (f) => /Adverse media/i.test(f.item) },
    {
      id: "us_shipment_export_history",
      match: (f) => /Export and shipment history|shipment history|ImportGenius/i.test(`${f.item} ${f.source_name}`),
    },
    { id: "buyer_customer_history", match: (f) => /Buyer.*history|Known buyer/i.test(f.item) },
    { id: "product_recall_history", match: (f) => /CPSC recall|Product recall/i.test(f.item) },
  ];

  // Group findings by target checklist id per the allowlist. A finding whose source or item does
  // not match any allowlist entry is left as an evidence fact only — it never leaks into an
  // unrelated checklist item.
  const grouped = new Map<ChecklistId, Finding[]>();
  for (const finding of findings) {
    for (const entry of ALLOWLIST) {
      if (entry.match(finding)) {
        const list = grouped.get(entry.id) ?? [];
        list.push(finding);
        grouped.set(entry.id, list);
      }
    }
  }
  const rank: Record<FindingStatus, number> = { FAIL: 5, CAUTION: 4, PASS: 3, NOT_VERIFIED: 2, NOT_APPLICABLE: 1 };
  for (const [id, list] of grouped.entries()) {
    const best = list.slice().sort((a, b) => rank[b.status] - rank[a.status])[0];
    if (best) put(id, resultFromFinding(def(id), best));
  }

  const contact = blank(def("contact_information_consistency"), now);
  if (!hasText(report.supplier_input.contact)) {
    contact.missing_information_required = ["Supplier contact person and contact details"];
    contact.explanation = "Supplier contact information was not provided, so consistency cannot be checked.";
  } else {
    contact.status = "NOT_VERIFIED";
    contact.evidence_classification = "SUPPLIER_CLAIMED";
    contact.source_names = ["Order submission"];
    contact.explanation = `Supplier contact provided: ${report.supplier_input.contact}. It has not been independently matched to the registered entity.`;
    contact.recommended_action = "Compare email domain, phone number, and address against the supplier website and QCC registry profile.";
  }
  put("contact_information_consistency", contact);

  const regulatory = blank(def("product_specific_us_regulatory_risks"), now);
  if (!/united states|usa|u\.s\.|^us$/i.test(report.customer_input.destination_market || "")) {
    regulatory.status = "NOT_APPLICABLE";
    regulatory.explanation = `Destination market is ${report.customer_input.destination_market || "not the United States"}; US-specific regulatory screening is not directly applicable.`;
    regulatory.buyer_impact = "If the goods later enter the United States, product-specific US regulatory checks should be re-run.";
  } else if (!hasText(report.customer_input.product_category)) {
    regulatory.missing_information_required = ["Exact product category, model, materials, and intended US use"];
    regulatory.explanation = "Product-specific US regulatory screening requires a precise product description.";
  } else {
    regulatory.evidence_classification = "INFERRED";
    regulatory.source_names = ["Order submission"];
    regulatory.explanation = `Product category supplied: ${report.customer_input.product_category}. No product-specific US regulatory database result has independently verified this item.`;
    regulatory.recommended_action = "Map the exact SKU, materials, age grading, and claims to applicable US agency rules and lab-test requirements.";
  }
  put("product_specific_us_regulatory_risks", regulatory);

  const contradictions = detectChecklistContradictions({ supplierInput: report.supplier_input, resolvedEntity: resolved, findings });
  const contradictionResult = blank(def("red_flags_contradictions"), now);
  if (contradictions.length > 0) {
    contradictionResult.status = contradictions.some((item) => /bank beneficiary|sanction|restricted/i.test(item)) ? "FAIL" : "CAUTION";
    contradictionResult.evidence_classification = "CONTRADICTED";
    contradictionResult.confidence = "medium";
    contradictionResult.source_names = unique(findings.flatMap((f) => f.evidence_excerpt ? [f.source_name] : []));
    contradictionResult.source_urls = unique(findings.flatMap((f) => f.source_url ? [f.source_url] : []));
    contradictionResult.evidence_ids = unique(findings.flatMap((f) => f.evidence_ids ?? []));
    contradictionResult.explanation = contradictions.join(" ");
    contradictionResult.buyer_impact = "Contradictions increase supplier identity and payment risk until resolved.";
    contradictionResult.recommended_action = "Pause reliance on contradicted facts and request primary documents or registry-backed confirmation.";
  } else {
    contradictionResult.status = "NOT_VERIFIED";
    contradictionResult.explanation = "No contradiction was detected from the evidence currently available, but the available evidence is incomplete.";
  }
  put("red_flags_contradictions", contradictionResult);

  const missing = missingInputs(report);
  const missingResult = blank(def("missing_information_required"), now);
  missingResult.missing_information_required = missing;
  if (missing.length > 0) {
    missingResult.status = "NOT_VERIFIED";
    missingResult.explanation = `Missing information required: ${missing.join("; ")}.`;
    missingResult.buyer_impact = "The investigation is constrained until the customer or supplier provides the missing information.";
    missingResult.recommended_action = "Collect the missing fields and re-run affected checks.";
  } else {
    missingResult.status = "NOT_APPLICABLE";
    missingResult.explanation = "No blocking missing order-input fields were detected for the canonical checklist.";
    missingResult.buyer_impact = "Checklist execution can proceed from the submitted order fields, subject to connector availability.";
    missingResult.recommended_action = "Request additional documents only where specific checklist items remain not verified.";
  }
  put("missing_information_required", missingResult);

  const finalOutcome = blank(def("final_outcome"), now);
  finalOutcome.status = outcomeToStatus(report.final_outcome);
  finalOutcome.evidence_classification = "CORROBORATED";
  finalOutcome.confidence = "medium";
  finalOutcome.source_names = ["VerifyFirst deterministic outcome model"];
  finalOutcome.explanation = `Commercial recommendation: ${report.final_outcome}. Overall risk rating: ${report.overall_risk_rating}.`;
  finalOutcome.buyer_impact = "This maps the commercial recommendation to the checklist status scale; it does not turn missing evidence into a pass.";
  finalOutcome.recommended_action = report.recommended_safeguards || "Review item-level recommendations before payment.";
  put("final_outcome", finalOutcome);

  const actions = blank(def("recommended_next_actions"), now);
  actions.status = "NOT_APPLICABLE";
  actions.evidence_classification = "NOT_INDEPENDENTLY_VERIFIED";
  actions.confidence = "medium";
  actions.source_names = ["VerifyFirst checklist synthesis"];
  actions.explanation = report.recommended_safeguards || "Recommended next actions are generated from item-level findings.";
  actions.buyer_impact = report.buyer_implications || "Follow-up actions should focus on unresolved and contradicted checklist items.";
  actions.recommended_action = [report.payment_recommendation, report.inspection_recommendation, report.testing_recommendation].filter(hasText).join(" ") || "Review unresolved checklist items before payment.";
  put("recommended_next_actions", actions);

  return CANONICAL_CHECKLIST.map((item) => byId.get(item.id) ?? blank(item, now));
}

// ---------------------------------------------------------------------------------------------
// Final-outcome gating.
//
// The commercial recommendation cannot be GO/PROCEED_WITH_SAFEGUARDS while any critical identity
// or sanctions check remains NOT_VERIFIED. Sanctions/UFLPA FAIL is NO_GO. Otherwise the current
// deterministic outcome (from computeOutcome) stands.
// ---------------------------------------------------------------------------------------------
const CRITICAL_IDENTITY_IDS: ChecklistId[] = [
  "legal_company_existence",
  "registration_status",
  "business_licence_validation",
  "sanctions_restricted_party",
];

export interface OutcomeGatingInput {
  overall: "low" | "medium" | "high" | "critical";
  outcome: FinalOutcome;
}

export function applyOutcomeGating(
  current: OutcomeGatingInput,
  checklist: ChecklistResult[],
  opts: { paymentDetailsProvided?: boolean } = {},
): { overall: OutcomeGatingInput["overall"]; outcome: FinalOutcome; blockers: string[] } {
  const byId = new Map<string, ChecklistResult>();
  for (const item of checklist) byId.set(item.id, item);
  const blockers: string[] = [];

  const anyFail = (ids: string[]) => ids.some((id) => byId.get(id)?.status === "FAIL");
  const anyNotVerified = (ids: string[]) => ids.filter((id) => byId.get(id)?.status === "NOT_VERIFIED");

  // Sanctions or UFLPA FAIL is a hard NO_GO.
  if (anyFail(["sanctions_restricted_party", "uflpa_forced_labour"])) {
    blockers.push("Confirmed sanctions or UFLPA match.");
    return { overall: "critical", outcome: "NO_GO", blockers };
  }
  // Any critical identity item still NOT_VERIFIED forces PAUSE.
  const unverified = anyNotVerified(CRITICAL_IDENTITY_IDS);
  if (unverified.length > 0) {
    for (const id of unverified) {
      const item = byId.get(id);
      if (item) blockers.push(`${item.title} is not independently verified.`);
    }
  }
  if (opts.paymentDetailsProvided) {
    const paymentBeneficiary = byId.get("red_flags_contradictions");
    if (paymentBeneficiary?.status === "NOT_VERIFIED") {
      blockers.push("Legal-entity / payment-beneficiary consistency is not independently verified.");
    }
  }
  // Contradictions flagged as FAIL (material identity/payment contradiction) → NO_GO
  const contradictions = byId.get("red_flags_contradictions");
  if (contradictions?.status === "FAIL") {
    blockers.push("Material verified identity/payment-beneficiary contradiction.");
    return { overall: "critical", outcome: "NO_GO", blockers };
  }
  if (blockers.length > 0) {
    return { overall: current.overall === "critical" ? "critical" : "high", outcome: "PAUSE_PENDING_CLARIFICATION", blockers };
  }
  return { overall: current.overall, outcome: current.outcome, blockers };
}

export function checklistResultsToFindings(results: ChecklistResult[]): Finding[] {
  return results.map((result) => ({
    section: result.section,
    item: result.title,
    status: result.status,
    confidence: result.confidence,
    source_name: result.source_names.join("; ") || "VerifyFirst checklist",
    source_url: result.source_urls[0] ?? null,
    retrieval_date: result.last_retrieval_date ?? new Date().toISOString(),
    evidence_excerpt: result.explanation,
    evidence_ids: result.evidence_ids,
    evidence_classification: result.evidence_classification,
    buyer_impact: result.buyer_impact,
    recommended_action: result.recommended_action,
  }));
}
