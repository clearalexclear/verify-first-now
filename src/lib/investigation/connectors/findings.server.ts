import type { Finding } from "../types";
import { getConnector, persistConnectorRun } from "./registry.server";
import type { ConnectorResult, InvestigationConnector } from "./types";
import { loadManualEvidenceFindings, MANUAL_SOURCE, MANUAL_SOURCE_LABEL } from "../sources/manual-evidence.server";
import { loadOfficialRegistryFindings, OFFICIAL_BROWSER_ASSISTED_PROVIDER, OFFICIAL_BROWSER_ASSISTED_SOURCE } from "../sources/official-browser-assisted.server";

const PAID_DISABLED_CONNECTORS = [
  "qcc_corporate_registry",
  "importgenius_shipments",
  "iaf_certsearch",
  "opensanctions_commercial",
] as const;

function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const host = new URL(withScheme).hostname.replace(/^www\./i, "");
    return host || null;
  } catch {
    return null;
  }
}

async function evidenceIdsForRun(runId: string): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("evidence_facts")
    .select("id")
    .eq("connector_run_id", runId);
  return (data ?? []).map((row: { id: string }) => row.id);
}

function disabledConnectorFinding(connector: InvestigationConnector, result: ConnectorResult): Finding {
  const categoryLabel = connector.category.replace(/_/g, " ");
  return {
    section:
      connector.category === "shipment_data"
        ? "export_history"
        : connector.category === "certification"
          ? "certificates_documents"
          : connector.category === "sanctions"
            ? "sanctions_forced_labour"
            : "legal_entity",
    item: `${connector.name} ${categoryLabel} check`,
    status: "NOT_VERIFIED",
    confidence: "low",
    source_name: connector.name,
    source_url: connector.sourceUrl ?? null,
    retrieval_date: result.retrievedAt,
    evidence_excerpt: "",
    evidence_ids: [],
    evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
    buyer_impact: "This paid connector is intentionally disabled until licensed credentials are supplied.",
    recommended_action: result.error ?? "Configure licensed credentials before treating this source as available.",
  };
}

function rdapFinding(result: ConnectorResult, evidenceIds: string[], domain: string): Finding | null {
  const evidence = result.evidence[0];
  if (!evidence && result.status === "skipped") return null;
  if (!evidence) {
    return {
      section: "digital_footprint",
      item: "Domain RDAP registration",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "RDAP",
      source_url: result.sourceUrl ?? null,
      retrieval_date: result.retrievedAt,
      evidence_excerpt: "",
      evidence_ids: [],
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      buyer_impact: "The supplier domain could not be checked through RDAP during this run.",
      recommended_action: "Confirm the supplier domain and re-run the check.",
    };
  }
  return {
    section: "digital_footprint",
    item: "Domain RDAP registration",
    status: result.status === "success" ? "PASS" : "NOT_VERIFIED",
    confidence: evidence.confidence,
    source_name: evidence.sourceName,
    source_url: evidence.sourceUrl ?? result.sourceUrl ?? null,
    retrieval_date: evidence.retrievalDate,
    evidence_excerpt: evidence.evidenceExcerpt ?? `RDAP checked ${domain}.`,
    evidence_ids: evidenceIds,
    evidence_classification: evidence.classification,
    buyer_impact:
      result.status === "success"
        ? "The submitted domain has independently retrieved registration metadata. This does not verify corporate registration."
        : "No RDAP registration metadata was independently verified for the submitted domain.",
    recommended_action: "Compare RDAP registrant and website contact details against the supplier's registered legal entity once QCC data is available.",
  };
}

function cpscFinding(result: ConnectorResult, evidenceIds: string[], query: string): Finding | null {
  const evidence = result.evidence[0];
  if (!evidence && result.status === "not_configured") return null;
  const val: any = evidence?.factValue ?? {};
  const recalls: any[] = Array.isArray(val?.recalls) ? val.recalls : [];
  const count: number = typeof val?.count === "number" ? val.count : recalls.length;
  const topLines = recalls.slice(0, 5).map((r: any) => {
    const title = r?.title ?? r?.recallNumber ?? "untitled";
    const date = r?.date ? String(r.date).slice(0, 10) : "no date";
    const brand = Array.isArray(r?.manufacturers) && r.manufacturers.length ? ` - brand: ${r.manufacturers.join(", ")}` : "";
    const models = Array.isArray(r?.products) && r.products.length
      ? ` - products: ${r.products.map((p: any) => [p.name, p.model].filter(Boolean).join(" ")).filter(Boolean).slice(0, 3).join("; ")}`
      : "";
    return `- ${title} (${date})${brand}${models}${r?.url ? ` - ${r.url}` : ""}`;
  }).join("\n");
  return {
    section: "regulatory",
    item: "U.S. CPSC recall screening",
    // Broad text-search results by themselves cannot establish relevance to the exact proposed
    // product. Until per-recall product-match logic exists, stay NOT_VERIFIED regardless of hit count.
    status: "NOT_VERIFIED",
    confidence: evidence?.confidence ?? "low",
    source_name: evidence?.sourceName ?? "U.S. CPSC recalls API",
    source_url: evidence?.sourceUrl ?? result.sourceUrl ?? null,
    retrieval_date: evidence?.retrievalDate ?? result.retrievedAt,
    evidence_excerpt: count > 0
      ? `CPSC returned ${count} recall result(s) for "${query}". Relevance to the exact proposed product has not been assessed.\n${topLines}`
      : `CPSC returned no recall result for "${query}". A no-result search is not proof no recall risk exists.`,
    evidence_ids: evidenceIds,
    evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
    buyer_impact: count > 0
      ? `CPSC returned ${count} result(s) for the broad product query. Each result must be reviewed against the exact proposed product (brand, model, materials) before it can be treated as a recall risk or dismissed as unrelated.`
      : "No CPSC recall result was returned for this broad query, but no-result searches must not be treated as proof no recalls exist.",
    recommended_action: "Match the exact product brand, model number, materials and intended use against each recall result before treating it as either a hit or a clean pass.",
  };
}

export interface ConnectorRunSummary {
  connectorId: string;
  connectorName: string;
  category: string;
  status: string;
  mode: string;
  sourceUrl: string | null;
  retrievedAt: string;
  reason?: string | null;
}

export async function runConnectorEvidenceChecks(args: {
  caseId: string;
  jobId?: string | null;
  website?: string | null;
  productQuery?: string | null;
}): Promise<Finding[]> {
  const { findings } = await runConnectorEvidenceChecksDetailed(args);
  return findings;
}

export async function runConnectorEvidenceChecksDetailed(args: {
  caseId: string;
  jobId?: string | null;
  website?: string | null;
  productQuery?: string | null;
}): Promise<{ findings: Finding[]; runs: ConnectorRunSummary[] }> {
  const findings: Finding[] = [];
  const runs: ConnectorRunSummary[] = [];
  const ctx = { caseId: args.caseId, jobId: args.jobId ?? null, env: process.env as Record<string, string | undefined> };

  const record = (connector: InvestigationConnector, result: ConnectorResult, reason?: string | null) => {
    runs.push({
      connectorId: connector.id,
      connectorName: connector.name,
      category: connector.category,
      status: result.status,
      mode: result.mode,
      sourceUrl: result.sourceUrl ?? connector.sourceUrl ?? null,
      retrievedAt: result.retrievedAt,
      reason: reason ?? result.error ?? null,
    });
  };

  const manualFindings = await loadManualEvidenceFindings(args.caseId);
  if (manualFindings.length > 0) {
    findings.push(...manualFindings);
    runs.push({
      connectorId: MANUAL_SOURCE,
      connectorName: MANUAL_SOURCE_LABEL,
      category: "manual_evidence",
      status: "success",
      mode: "mock",
      sourceUrl: null,
      retrievedAt: new Date().toISOString(),
      reason: `${manualFindings.length} active manual evidence ${manualFindings.length === 1 ? "entry" : "entries"}`,
    });
  }

  const officialRegistryFindings = await loadOfficialRegistryFindings(args.caseId);
  if (officialRegistryFindings.length > 0) {
    findings.push(...officialRegistryFindings);
    runs.push({
      connectorId: OFFICIAL_BROWSER_ASSISTED_PROVIDER,
      connectorName: OFFICIAL_BROWSER_ASSISTED_SOURCE,
      category: "corporate_registry",
      status: "success",
      mode: "official_free",
      sourceUrl: officialRegistryFindings[0]?.source_url ?? null,
      retrievedAt: new Date().toISOString(),
      reason: `${officialRegistryFindings.length} official browser-assisted registry evidence ${officialRegistryFindings.length === 1 ? "entry" : "entries"}`,
    });
  }

  for (const id of PAID_DISABLED_CONNECTORS) {
    const connector = getConnector(id);
    if (!connector) continue;
    const result = await connector.run({}, ctx);
    await persistConnectorRun({ result, caseId: args.caseId, jobId: args.jobId ?? null });
    findings.push(disabledConnectorFinding(connector, result));
    record(connector, result, "Paid connector disabled until licensed credentials are supplied.");
  }

  const domain = extractDomain(args.website);
  const rdap = getConnector("domain_rdap") as InvestigationConnector<{ domain: string }> | null;
  if (rdap && domain) {
    const result = await rdap.run({ domain }, ctx);
    const runId = await persistConnectorRun({ result, caseId: args.caseId, jobId: args.jobId ?? null });
    const finding = rdapFinding(result, await evidenceIdsForRun(runId), domain);
    if (finding) findings.push(finding);
    record(rdap, result);
  }

  const cpsc = getConnector("cpsc_recalls") as InvestigationConnector<{ query: string }> | null;
  const query = args.productQuery?.trim();
  if (cpsc && query) {
    const result = await cpsc.run({ query }, ctx);
    const runId = await persistConnectorRun({ result, caseId: args.caseId, jobId: args.jobId ?? null });
    const finding = cpscFinding(result, await evidenceIdsForRun(runId), query);
    if (finding) findings.push(finding);
    record(cpsc, result);
  }

  return { findings, runs };
}
