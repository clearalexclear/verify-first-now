import type { FindingConfidence } from "../types";

export type ConnectorMode = "mock" | "official_free" | "paid_disabled" | "paid_enabled";
export type ConnectorStatus = "success" | "not_configured" | "not_found" | "rate_limited" | "error" | "skipped";

export type ConnectorCategory =
  | "corporate_registry"
  | "shipment_data"
  | "certification"
  | "sanctions"
  | "uflpa_forced_labour"
  | "product_recalls"
  | "domain_website"
  | "general_web_research";

export type EvidenceClassification =
  | "VERIFIED"
  | "CORROBORATED"
  | "SUPPLIER_CLAIMED"
  | "INFERRED"
  | "NOT_INDEPENDENTLY_VERIFIED"
  | "CONTRADICTED";

export interface ConnectorContext {
  caseId: string;
  jobId?: string | null;
  env: Record<string, string | undefined>;
}

export interface NormalizedEvidence {
  factKey: string;
  factValue: unknown;
  classification: EvidenceClassification;
  confidence: FindingConfidence;
  sourceName: string;
  sourceUrl?: string | null;
  retrievalDate: string;
  evidenceExcerpt?: string | null;
  licenseNotes?: string | null;
}

export interface ConnectorResult<T = unknown> {
  connectorId: string;
  status: ConnectorStatus;
  mode: ConnectorMode;
  retrievedAt: string;
  confidence: FindingConfidence;
  sourceUrl?: string | null;
  evidence: NormalizedEvidence[];
  rawResponse?: T;
  rawResponseStorageAllowed: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface InvestigationConnector<Input = unknown, Output = unknown> {
  id: string;
  name: string;
  category: ConnectorCategory;
  mode: ConnectorMode;
  requiredEnv: string[];
  sourceUrl?: string;
  rawResponseStorageAllowed: boolean;
  isEnabled(env: Record<string, string | undefined>): boolean;
  run(input: Input, ctx: ConnectorContext): Promise<ConnectorResult<Output>>;
}

export function notConfiguredResult(connector: Pick<InvestigationConnector, "id" | "mode" | "requiredEnv" | "sourceUrl">, message?: string): ConnectorResult {
  return {
    connectorId: connector.id,
    status: "not_configured",
    mode: connector.mode,
    retrievedAt: new Date().toISOString(),
    confidence: "low",
    sourceUrl: connector.sourceUrl ?? null,
    evidence: [],
    rawResponseStorageAllowed: false,
    error: message ?? `Connector is not configured. Required environment: ${connector.requiredEnv.join(", ") || "n/a"}`,
  };
}
