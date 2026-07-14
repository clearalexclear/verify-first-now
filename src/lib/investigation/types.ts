// Shared types for the AI investigation pipeline.
// Used by source modules, the orchestrator, the PDF renderer, and the
// public report view. Keep this client-safe - no server-only imports here.

export type FindingStatus =
  | "PASS"
  | "CAUTION"
  | "FAIL"
  | "NOT_VERIFIED"
  | "NOT_APPLICABLE";

export type FindingConfidence =
  | "high"
  | "medium_high"
  | "medium"
  | "low";

export type EvidenceClassification =
  | "VERIFIED"
  | "CORROBORATED"
  | "SUPPLIER_CLAIMED"
  | "INFERRED"
  | "NOT_INDEPENDENTLY_VERIFIED"
  | "CONTRADICTED";

export type FinalOutcome =
  | "GO"
  | "PROCEED_WITH_SAFEGUARDS"
  | "PAUSE_PENDING_CLARIFICATION"
  | "NO_GO";

export type ReportSectionKey =
  | "legal_entity"
  | "entity_payment_match"
  | "factory_vs_trader"
  | "ownership"
  | "product_capacity_fit"
  | "export_history"
  | "certificates_documents"
  | "regulatory"
  | "litigation_enforcement"
  | "sanctions_forced_labour"
  | "digital_footprint"
  | "payment_safeguards";

export interface Finding {
  section: ReportSectionKey;
  item: string;
  status: FindingStatus;
  confidence: FindingConfidence;
  source_name: string;
  source_url: string | null;
  retrieval_date: string; // ISO
  evidence_excerpt: string; // empty string => downgraded to NOT_VERIFIED
  evidence_ids?: string[];
  evidence_classification?: EvidenceClassification;
  buyer_impact: string;
  recommended_action: string;
}

export interface ResolvedEntity {
  matched: boolean;
  legal_name_en: string | null;
  legal_name_local: string | null;
  registration_number: string | null;
  registration_country: string;
  registration_status: string | null;
  registration_date: string | null;
  registered_capital: string | null;
  registered_address: string | null;
  legal_representative: string | null;
  business_scope: string | null;
  shareholders: string[];
  related_companies: string[];
  manufacturer_indicators: string[];
  trading_indicators: string[];
  confidence: FindingConfidence;
  sources: { name: string; url: string | null }[];
  notes: string;
}

export interface ChecklistReportResult {
  id: string;
  title: string;
  section: ReportSectionKey;
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
  paid_connector_dependency: string | null;
  last_retrieval_date: string | null;
}

export interface SourceEntry {
  name: string;
  url: string | null;
  retrieved_at: string;
  category?: string;
}

export interface UnavailableSource {
  name: string;
  reason: string;
  category?: string;
}

export interface InvestigationReport {
  generated_at: string;
  order_reference: string;
  case_reference: string;
  supplier_input: {
    name: string;
    chinese_name: string | null;
    country: string;
    url: string;
    contact: string | null;
  };
  customer_input: {
    name: string;
    company: string;
    email: string;
    destination_market: string;
    estimated_order_value: string;
    product_category: string;
    concerns: string | null;
  };
  resolved_entity: ResolvedEntity;
  findings: Finding[];
  checklist_results: ChecklistReportResult[];
  overall_risk_rating: "low" | "medium" | "high" | "critical";
  final_outcome: FinalOutcome;
  executive_summary: string;
  key_findings: string[];
  buyer_implications: string;
  recommended_safeguards: string;
  payment_recommendation: string;
  inspection_recommendation: string;
  testing_recommendation: string;
  methodology: string;
  limitations: string;
  sources_used: SourceEntry[];
  sources_queried?: SourceEntry[];
  customer_evidence?: SourceEntry[];
  sources_unavailable?: UnavailableSource[];
  critical_blockers?: string[];
  verified_report_decision?: VerifiedReportDecision;
}

export interface VerifiedReportDecision {
  payment_decision: "PROCEED" | "PAUSE" | "NO_GO";
  why: string[];
  deal_specific_blockers: string[];
  entity_payment_consistency: "MATCH" | "MINOR_ISSUES" | "MISMATCH" | "NOT_VERIFIED";
  documents_checked: string[];
  ask_supplier_before_payment: string[];
}

export const SECTION_TITLES: Record<ReportSectionKey, string> = {
  legal_entity: "Legal-entity verification",
  entity_payment_match: "Entity and payment-party matching",
  factory_vs_trader: "Factory versus trading-company assessment",
  ownership: "Ownership and related companies",
  product_capacity_fit: "Product and capacity fit",
  export_history: "Export history",
  certificates_documents: "Certificate and document analysis",
  regulatory: "Destination-market regulatory relevance",
  litigation_enforcement: "Litigation and enforcement screening",
  sanctions_forced_labour: "Sanctions and forced-labour screening",
  digital_footprint: "Digital-footprint and adverse-media screening",
  payment_safeguards: "Payment and transaction safeguards",
};

export const OUTCOME_LABEL: Record<FinalOutcome, string> = {
  GO: "Go",
  PROCEED_WITH_SAFEGUARDS: "Proceed with safeguards",
  PAUSE_PENDING_CLARIFICATION: "Pause pending clarification",
  NO_GO: "Do not proceed",
};

const ORDER_VALUE_LABELS: Record<string, string> = {
  "under_1k": "Under US$1,000",
  "1_10k": "US$1,000 – US$10,000",
  "10_50k": "US$10,000 – US$50,000",
  "50_100k": "US$50,000 – US$100,000",
  "100_500k": "US$100,000 – US$500,000",
  "over_500k": "Over US$500,000",
};

export function humanizeOrderValue(raw: string | null | undefined): string {
  if (!raw) return "Not provided";
  const key = String(raw).trim().toLowerCase();
  if (ORDER_VALUE_LABELS[key]) return ORDER_VALUE_LABELS[key];
  // If a bare number, render as USD
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (Number.isFinite(n) && n > 0) {
    return `US$${n.toLocaleString("en-US")}`;
  }
  return String(raw);
}


export const STATUS_LABEL: Record<FindingStatus, string> = {
  PASS: "Pass",
  CAUTION: "Caution",
  FAIL: "Fail",
  NOT_VERIFIED: "Not independently verified",
  NOT_APPLICABLE: "Not applicable",
};

export const CONFIDENCE_LABEL: Record<FindingConfidence, string> = {
  high: "High",
  medium_high: "Medium-High",
  medium: "Medium",
  low: "Low",
};

export const CLASSIFICATION_LABEL: Record<EvidenceClassification, string> = {
  VERIFIED: "Verified",
  CORROBORATED: "Corroborated",
  SUPPLIER_CLAIMED: "Supplier claimed",
  INFERRED: "Inferred",
  NOT_INDEPENDENTLY_VERIFIED: "Not independently verified",
  CONTRADICTED: "Contradicted",
};
