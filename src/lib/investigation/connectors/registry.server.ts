import { notConfiguredResult, type ConnectorContext, type ConnectorResult, type InvestigationConnector } from "./types";

function hasAll(env: Record<string, string | undefined>, keys: string[]) {
  return keys.every((key) => Boolean(env[key]));
}

function disabledPaidConnector(args: {
  id: string;
  name: string;
  category: InvestigationConnector["category"];
  requiredEnv: string[];
  sourceUrl: string;
  notes: string;
}): InvestigationConnector {
  return {
    ...args,
    mode: "paid_disabled",
    rawResponseStorageAllowed: false,
    isEnabled: () => false,
    async run() {
      return notConfiguredResult(this, args.notes);
    },
  };
}

const qccCorporateRegistry = disabledPaidConnector({
  id: "qcc_corporate_registry",
  name: "QCC International API",
  category: "corporate_registry",
  requiredEnv: ["QCC_API_KEY"],
  sourceUrl: "https://www.qcc.com/",
  notes: "QCC International API is the preferred Chinese corporate registry provider, but it remains disabled until commercial credentials and permitted-response storage rules are supplied.",
});

const importGeniusShipments = disabledPaidConnector({
  id: "importgenius_shipments",
  name: "ImportGenius API",
  category: "shipment_data",
  requiredEnv: ["IMPORTGENIUS_API_KEY"],
  sourceUrl: "https://www.importgenius.com/",
  notes: "ImportGenius is the preferred shipment-data provider, but this connector must return not_configured until licensed API credentials are supplied.",
});

const iafCertSearch = disabledPaidConnector({
  id: "iaf_certsearch",
  name: "IAF CertSearch",
  category: "certification",
  requiredEnv: ["IAF_CERTSEARCH_API_KEY"],
  sourceUrl: "https://www.iafcertsearch.org/",
  notes: "IAF CertSearch covers accredited management-system certificates only and is disabled until access/licensing is confirmed.",
});

const openSanctionsCommercial = disabledPaidConnector({
  id: "opensanctions_commercial",
  name: "OpenSanctions Commercial API",
  category: "sanctions",
  requiredEnv: ["OPENSANCTIONS_API_KEY"],
  sourceUrl: "https://www.opensanctions.org/",
  notes: "OpenSanctions is treated as credentialed/pay-as-you-go for commercial use and is disabled until credentials are supplied.",
});

const domainRdap: InvestigationConnector<{ domain: string }> = {
  id: "domain_rdap",
  name: "Domain RDAP",
  category: "domain_website",
  mode: "official_free",
  requiredEnv: [],
  sourceUrl: "https://rdap.org/",
  rawResponseStorageAllowed: true,
  isEnabled: () => true,
  async run(input) {
    const retrievedAt = new Date().toISOString();
    if (!input.domain) {
      return {
        connectorId: this.id,
        status: "skipped",
        mode: this.mode,
        retrievedAt,
        confidence: "low",
        sourceUrl: this.sourceUrl,
        evidence: [],
        rawResponseStorageAllowed: false,
        error: "No domain supplied",
      };
    }
    try {
      const url = `https://rdap.org/domain/${encodeURIComponent(input.domain)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.status === 404) {
        return {
          connectorId: this.id,
          status: "not_found",
          mode: this.mode,
          retrievedAt,
          confidence: "medium",
          sourceUrl: url,
          evidence: [{
            factKey: "domain.rdap.not_found",
            factValue: input.domain,
            classification: "NOT_INDEPENDENTLY_VERIFIED",
            confidence: "medium",
            sourceName: "RDAP",
            sourceUrl: url,
            retrievalDate: retrievedAt,
            evidenceExcerpt: "RDAP returned 404 for the submitted domain. This is not proof the supplier lacks a website.",
          }],
          rawResponseStorageAllowed: false,
        };
      }
      const raw = await res.json();
      return {
        connectorId: this.id,
        status: res.ok ? "success" : "error",
        mode: this.mode,
        retrievedAt,
        confidence: res.ok ? "medium_high" : "low",
        sourceUrl: url,
        evidence: res.ok ? [{
          factKey: "domain.rdap.registration",
          factValue: { ldhName: raw.ldhName, events: raw.events, entities: raw.entities },
          classification: "VERIFIED",
          confidence: "medium_high",
          sourceName: "RDAP",
          sourceUrl: url,
          retrievalDate: retrievedAt,
          evidenceExcerpt: `RDAP record retrieved for ${raw.ldhName ?? input.domain}.`,
        }] : [],
        rawResponse: raw,
        rawResponseStorageAllowed: true,
      };
    } catch (error) {
      return {
        connectorId: this.id,
        status: "error",
        mode: this.mode,
        retrievedAt,
        confidence: "low",
        sourceUrl: this.sourceUrl,
        evidence: [],
        rawResponseStorageAllowed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

const cpscRecalls: InvestigationConnector<{ query: string }> = {
  id: "cpsc_recalls",
  name: "CPSC recalls",
  category: "product_recalls",
  mode: "official_free",
  requiredEnv: [],
  sourceUrl: "https://www.saferproducts.gov/RestWebServices/Recall",
  rawResponseStorageAllowed: true,
  isEnabled: () => true,
  async run(input) {
    const retrievedAt = new Date().toISOString();
    if (!input.query) return notConfiguredResult(this, "No product query supplied for CPSC recall screening.");
    try {
      const url = `${this.sourceUrl}?format=json&RecallTitle=${encodeURIComponent(input.query)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const raw = await res.json().catch(() => []);
      const count = Array.isArray(raw) ? raw.length : 0;
      return {
        connectorId: this.id,
        status: res.ok ? "success" : "error",
        mode: this.mode,
        retrievedAt,
        confidence: res.ok ? "medium_high" : "low",
        sourceUrl: url,
        evidence: [{
          factKey: "cpsc.recalls.search_result_count",
          factValue: count,
          classification: count > 0 ? "CORROBORATED" : "NOT_INDEPENDENTLY_VERIFIED",
          confidence: "medium_high",
          sourceName: "U.S. CPSC recalls API",
          sourceUrl: url,
          retrievalDate: retrievedAt,
          evidenceExcerpt: count > 0
            ? `CPSC returned ${count} recall result(s) for the product query. These require product-specific review.`
            : `CPSC returned no recall result for the product query. This is not proof no recall risk exists.`,
        }],
        rawResponse: raw,
        rawResponseStorageAllowed: true,
      };
    } catch (error) {
      return {
        connectorId: this.id,
        status: "error",
        mode: this.mode,
        retrievedAt,
        confidence: "low",
        sourceUrl: this.sourceUrl,
        evidence: [],
        rawResponseStorageAllowed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

const firecrawlWebIntelligence: InvestigationConnector = {
  id: "firecrawl_web_intelligence",
  name: "Firecrawl web intelligence",
  category: "general_web_research",
  mode: "paid_disabled",
  requiredEnv: ["FIRECRAWL_API_KEY", "LOVABLE_API_KEY"],
  sourceUrl: "https://www.firecrawl.dev/",
  rawResponseStorageAllowed: false,
  isEnabled: (env) => hasAll(env, ["FIRECRAWL_API_KEY", "LOVABLE_API_KEY"]),
  async run() {
    return notConfiguredResult(this, "Firecrawl remains classified as web intelligence only and cannot independently verify corporate registration, shipment history, certificate validity, or litigation.");
  },
};

export const connectorRegistry: InvestigationConnector[] = [
  qccCorporateRegistry,
  importGeniusShipments,
  iafCertSearch,
  openSanctionsCommercial,
  domainRdap,
  cpscRecalls,
  firecrawlWebIntelligence,
];

export function getConnector(id: string) {
  return connectorRegistry.find((connector) => connector.id === id) ?? null;
}

export async function persistConnectorRun(args: {
  result: ConnectorResult;
  caseId: string;
  jobId?: string | null;
  requestHash?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const started = Date.now();
  const { data: run, error } = await db
    .from("connector_runs")
    .insert({
      connector_id: args.result.connectorId,
      case_id: args.caseId,
      job_id: args.jobId ?? null,
      status: args.result.status,
      mode: args.result.mode,
      request_hash: args.requestHash ?? null,
      retrieved_at: args.result.retrievedAt,
      duration_ms: Date.now() - started,
      confidence: args.result.confidence,
      source_url: args.result.sourceUrl ?? null,
      raw_response_storage_allowed: args.result.rawResponseStorageAllowed,
      error_message: args.result.error ?? null,
      metadata: args.result.metadata ?? {},
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(`Could not persist connector run: ${error?.message ?? "unknown"}`);

  for (const evidence of args.result.evidence) {
    await db.from("evidence_facts").insert({
      case_id: args.caseId,
      connector_run_id: run.id,
      fact_key: evidence.factKey,
      fact_value: evidence.factValue,
      classification: evidence.classification,
      confidence: evidence.confidence,
      source_name: evidence.sourceName,
      source_url: evidence.sourceUrl ?? null,
      retrieval_date: evidence.retrievalDate,
      evidence_excerpt: evidence.evidenceExcerpt ?? null,
      license_notes: evidence.licenseNotes ?? null,
    });
  }

  return run.id as string;
}
