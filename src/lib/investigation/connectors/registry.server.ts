import { notConfiguredResult, type ConnectorResult, type InvestigationConnector } from "./types";

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
  const connector: InvestigationConnector = {
    id: args.id,
    name: args.name,
    category: args.category,
    requiredEnv: args.requiredEnv,
    sourceUrl: args.sourceUrl,
    mode: "paid_disabled",
    rawResponseStorageAllowed: false,
    isEnabled: () => false,
    async run() {
      return notConfiguredResult(connector, args.notes);
    },
  };
  return connector;
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
        connectorId: domainRdap.id,
        status: "skipped",
        mode: domainRdap.mode,
        retrievedAt,
        confidence: "low",
        sourceUrl: domainRdap.sourceUrl,
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
          connectorId: domainRdap.id,
          status: "not_found",
          mode: domainRdap.mode,
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
        connectorId: domainRdap.id,
        status: res.ok ? "success" : "error",
        mode: domainRdap.mode,
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
        connectorId: domainRdap.id,
        status: "error",
        mode: domainRdap.mode,
        retrievedAt,
        confidence: "low",
        sourceUrl: domainRdap.sourceUrl,
        evidence: [],
        rawResponseStorageAllowed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

interface CpscRecall {
  recallNumber?: string;
  title?: string;
  date?: string;
  url?: string;
  products: Array<{ name?: string; description?: string; model?: string; type?: string }>;
  manufacturers: string[];
  hazards: string[];
}

function normalizeCpscRecall(raw: any): CpscRecall {
  return {
    recallNumber: raw?.RecallNumber ?? raw?.recallNumber ?? undefined,
    title: raw?.Title ?? raw?.RecallTitle ?? raw?.title ?? undefined,
    date: raw?.RecallDate ?? raw?.LastPublishDate ?? raw?.date ?? undefined,
    url: raw?.URL ?? raw?.RecallURL ?? raw?.url ?? undefined,
    products: Array.isArray(raw?.Products)
      ? raw.Products.map((p: any) => ({
          name: p?.Name,
          description: p?.Description,
          model: p?.Model,
          type: p?.Type,
        }))
      : [],
    manufacturers: Array.isArray(raw?.Manufacturers)
      ? raw.Manufacturers.map((m: any) => m?.CompanyName ?? m?.Name).filter(Boolean)
      : [],
    hazards: Array.isArray(raw?.Hazards)
      ? raw.Hazards.map((h: any) => h?.Name).filter(Boolean)
      : [],
  };
}

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
    if (!input.query) return notConfiguredResult(cpscRecalls, "No product query supplied for CPSC recall screening.");
    try {
      const url = `${cpscRecalls.sourceUrl}?format=json&RecallTitle=${encodeURIComponent(input.query)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const raw = await res.json().catch(() => []);
      const list: any[] = Array.isArray(raw) ? raw : [];
      const recalls = list.slice(0, 25).map(normalizeCpscRecall);
      const count = list.length;
      const excerpt = count > 0
        ? `CPSC returned ${count} recall result(s) for "${input.query}". Top titles: ` +
          recalls.slice(0, 5).map((r) => `"${r.title ?? r.recallNumber ?? "untitled"}" (${r.date?.slice(0, 10) ?? "no date"})`).join("; ") +
          ". Relevance to the exact proposed product has NOT been assessed."
        : `CPSC returned no recall result for "${input.query}". A no-result search is not proof that no recall risk exists.`;
      return {
        connectorId: cpscRecalls.id,
        status: res.ok ? "success" : "error",
        mode: cpscRecalls.mode,
        retrievedAt,
        confidence: res.ok ? "medium_high" : "low",
        sourceUrl: url,
        evidence: [{
          factKey: "cpsc.recalls.search_results",
          factValue: { query: input.query, count, recalls },
          classification: "CORROBORATED",
          confidence: "medium_high",
          sourceName: "U.S. CPSC recalls API",
          sourceUrl: url,
          retrievalDate: retrievedAt,
          evidenceExcerpt: excerpt,
        }],
        rawResponse: raw,
        rawResponseStorageAllowed: true,
        metadata: { count },
      };
    } catch (error) {
      return {
        connectorId: cpscRecalls.id,
        status: "error",
        mode: cpscRecalls.mode,
        retrievedAt,
        confidence: "low",
        sourceUrl: cpscRecalls.sourceUrl,
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
    return notConfiguredResult(firecrawlWebIntelligence, "Firecrawl remains classified as web intelligence only and cannot independently verify corporate registration, shipment history, certificate validity, or litigation.");
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
