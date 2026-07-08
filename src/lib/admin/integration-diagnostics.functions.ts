// Admin-only diagnostic aggregator for VerifyFirst integrations.
// Reports, per provider: env presence, last connector_run status/error,
// number of evidence facts produced, latest excerpt, and the checklist
// items the provider is expected to influence. Does not modify anything.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ProviderStatus =
  | "configured"
  | "not_configured"
  | "official_free"
  | "web_intelligence_only";

interface ProviderReport {
  id: string;
  name: string;
  category: string;
  status: ProviderStatus;
  requiredEnv: string[];
  envConfigured: Record<string, boolean>;
  lastRun: {
    at: string | null;
    status: string | null;
    error: string | null;
    sourceUrl: string | null;
    fieldsReturned?: string[];
    evidenceCount?: number | null;
  };
  assistedTaskStatus?: "pending" | "completed" | "cancelled" | null;
  evidenceCount: number;
  lastEvidenceExcerpt: string | null;
  checklistItemsAffected: string[];
  notes: string;
}

// Static provider catalogue. Kept explicit so unavailable APIs are never
// silently marked as queried.
const PROVIDERS: Array<{
  id: string;
  name: string;
  category: string;
  requiredEnv: string[];
  connectorRunId?: string; // matches connectors.id / connector_runs.connector_id
  evidenceSourcePatterns?: string[]; // ILIKE patterns on evidence_facts.source_name
  checklistItemsAffected: string[];
  notes: string;
  paidDisabled?: boolean;
  webIntelligenceOnly?: boolean;
}> = [
  {
    id: "dhs_uflpa",
    name: "DHS UFLPA Entity List snapshot",
    category: "sanctions_forced_labour",
    requiredEnv: [],
    evidenceSourcePatterns: ["DHS UFLPA%"],
    checklistItemsAffected: ["uflpa_forced_labour"],
    notes: "Official free source. Snapshot is refreshed from dhs.gov and stored in source_snapshots; screenUflpa reads that snapshot on every case.",
  },
  {
    id: "cpsc_recalls",
    name: "CPSC recalls API",
    category: "product_recalls",
    requiredEnv: [],
    connectorRunId: "cpsc_recalls",
    evidenceSourcePatterns: ["U.S. CPSC%", "CPSC%"],
    checklistItemsAffected: ["product_recall_history"],
    notes: "Official free source. Broad title-match search only; broad matches do not automatically trigger CAUTION.",
  },
  {
    id: "domain_rdap",
    name: "Domain RDAP",
    category: "domain_website",
    requiredEnv: [],
    connectorRunId: "domain_rdap",
    evidenceSourcePatterns: ["RDAP%"],
    checklistItemsAffected: ["domain_rdap_registration"],
    notes: "Official free source. Establishes only that a domain record exists; cannot independently verify supplier identity.",
  },
  {
    id: "firecrawl_web_intelligence",
    name: "Firecrawl web intelligence",
    category: "general_web_research",
    requiredEnv: ["FIRECRAWL_API_KEY", "LOVABLE_API_KEY"],
    webIntelligenceOnly: true,
    evidenceSourcePatterns: ["%Firecrawl%", "Public web search%", "Supplier website%"],
    checklistItemsAffected: [
      "website_consistency",
      "adverse_media",
      "litigation_enforcement",
      "export_history_probe",
      "entity_resolution",
    ],
    notes: "Web intelligence only. Not accepted as official verification for corporate registration, sanctions, litigation, certificates, or shipment history.",
  },
  {
    id: "opensanctions_commercial",
    name: "OpenSanctions Commercial API",
    category: "sanctions",
    requiredEnv: ["OPENSANCTIONS_API_KEY"],
    connectorRunId: "opensanctions_commercial",
    evidenceSourcePatterns: ["OpenSanctions%"],
    checklistItemsAffected: ["sanctions_restricted_party"],
    notes: "Paid/credentialed. Disabled connector plus the standalone screenSanctions helper — both remain NOT_VERIFIED without a key.",
    paidDisabled: true,
  },
  {
    id: "china_registry_qincheck",
    name: "QINCheck China registry",
    category: "corporate_registry",
    requiredEnv: ["CHINA_REGISTRY_ENABLED", "QINCHECK_API_KEY"],
    connectorRunId: "china_registry_qincheck",
    evidenceSourcePatterns: ["QINCheck China registry%"],
    checklistItemsAffected: [
      "legal_company_existence",
      "chinese_legal_name",
      "unified_social_credit_code",
      "registration_status",
      "incorporation_date",
      "registered_capital",
      "legal_representative",
      "registered_address",
      "business_scope",
      "shareholders_beneficial_ownership",
      "related_companies",
      "litigation_court_records",
      "enforcement_administrative_penalties",
      "business_licence_validation",
    ],
    notes: "Preferred automated China registry provider. Used first when CHINA_REGISTRY_PROVIDER is auto or qincheck and CHINA_REGISTRY_ENABLED=true.",
    paidDisabled: true,
  },
  {
    id: "china_registry_panda360",
    name: "Panda360 China registry",
    category: "corporate_registry",
    requiredEnv: ["CHINA_REGISTRY_ENABLED", "PANDA360_API_KEY"],
    connectorRunId: "china_registry_panda360",
    evidenceSourcePatterns: ["Panda360 China registry%"],
    checklistItemsAffected: [
      "legal_company_existence",
      "chinese_legal_name",
      "unified_social_credit_code",
      "registration_status",
      "incorporation_date",
      "registered_capital",
      "legal_representative",
      "registered_address",
      "business_scope",
      "shareholders_beneficial_ownership",
      "related_companies",
      "litigation_court_records",
      "enforcement_administrative_penalties",
      "business_licence_validation",
    ],
    notes: "Fallback automated China registry provider. Used when QINCheck is unavailable in auto mode, or directly when CHINA_REGISTRY_PROVIDER=panda360.",
    paidDisabled: true,
  },
  {
    id: "official_browser_assisted",
    name: "Official browser-assisted verification",
    category: "corporate_registry",
    requiredEnv: [],
    connectorRunId: "official_browser_assisted",
    evidenceSourcePatterns: ["Official browser-assisted verification%"],
    checklistItemsAffected: [
      "legal_company_existence",
      "chinese_legal_name",
      "unified_social_credit_code",
      "registration_status",
      "incorporation_date",
      "registered_capital",
      "legal_representative",
      "registered_address",
      "business_scope",
      "shareholders_beneficial_ownership",
      "related_companies",
      "litigation_court_records",
      "enforcement_administrative_penalties",
      "business_licence_validation",
    ],
    notes: "Admin-assisted official/public source fallback. Pending tasks are created when QINCheck and Panda360 are unavailable; verified evidence requires analyst citation or attachment.",
  },
  {
    id: "qcc_corporate_registry",
    name: "QCC International API",
    category: "corporate_registry",
    requiredEnv: ["QCC_API_KEY"],
    connectorRunId: "qcc_corporate_registry",
    checklistItemsAffected: ["legal_entity_registration", "business_licence"],
    notes: "Paid connector. Not implemented — returns not_configured. Tianyancha is NOT implemented.",
    paidDisabled: true,
  },
  {
    id: "importgenius_shipments",
    name: "ImportGenius API",
    category: "shipment_data",
    requiredEnv: ["IMPORTGENIUS_API_KEY"],
    connectorRunId: "importgenius_shipments",
    checklistItemsAffected: ["export_history_records"],
    notes: "Paid connector. Not implemented — returns not_configured.",
    paidDisabled: true,
  },
  {
    id: "iaf_certsearch",
    name: "IAF CertSearch",
    category: "certification",
    requiredEnv: ["IAF_CERTSEARCH_API_KEY"],
    connectorRunId: "iaf_certsearch",
    checklistItemsAffected: ["management_system_certificates"],
    notes: "Paid/credentialed. Not implemented — returns not_configured.",
    paidDisabled: true,
  },
];

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error("Role lookup failed");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin role required");
}

export const getIntegrationDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const envConfigured = (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [
        k,
        k === "CHINA_REGISTRY_ENABLED"
          ? String(process.env[k] ?? "").toLowerCase() === "true"
          : Boolean(process.env[k]),
      ]));

    const reports: ProviderReport[] = [];

    for (const p of PROVIDERS) {
      const env = envConfigured(p.requiredEnv);
      const envOk = p.requiredEnv.length === 0 || p.requiredEnv.every((k) => env[k]);

      let status: ProviderStatus;
      if (p.paidDisabled) status = envOk ? "configured" : "not_configured";
      else if (p.webIntelligenceOnly) status = envOk ? "web_intelligence_only" : "not_configured";
      else status = "official_free";

      // Last connector_run
      let lastRun: ProviderReport["lastRun"] = { at: null, status: null, error: null, sourceUrl: null };
      if (p.connectorRunId) {
        let q = db
          .from("connector_runs")
          .select("status, error_message, retrieved_at, source_url, metadata")
          .eq("connector_id", p.connectorRunId)
          .order("retrieved_at", { ascending: false })
          .limit(1);
        if (data.caseId) q = q.eq("case_id", data.caseId);
        const { data: rows } = await q;
        const row = rows?.[0];
        if (row) {
          lastRun = {
            at: row.retrieved_at,
            status: row.status,
            error: row.error_message,
            sourceUrl: row.source_url,
            fieldsReturned: Array.isArray(row.metadata?.fields_returned) ? row.metadata.fields_returned : [],
            evidenceCount: typeof row.metadata?.evidence_count === "number" ? row.metadata.evidence_count : null,
          };
        }
      }

      // Evidence counts / last excerpt from evidence_facts
      let evidenceCount = 0;
      let lastEvidenceExcerpt: string | null = null;
      if (p.evidenceSourcePatterns?.length) {
        for (const pat of p.evidenceSourcePatterns) {
          let cq = db
            .from("evidence_facts")
            .select("id", { count: "exact", head: true })
            .ilike("source_name", pat);
          if (data.caseId) cq = cq.eq("case_id", data.caseId);
          const { count } = await cq;
          evidenceCount += count ?? 0;
        }
        let eq = db
          .from("evidence_facts")
          .select("evidence_excerpt, retrieval_date, source_name")
          .or(p.evidenceSourcePatterns.map((pat) => `source_name.ilike.${pat}`).join(","))
          .order("retrieval_date", { ascending: false })
          .limit(1);
        if (data.caseId) eq = eq.eq("case_id", data.caseId);
        const { data: latest } = await eq;
        lastEvidenceExcerpt = latest?.[0]?.evidence_excerpt ?? null;
      }

      let assistedTaskStatus: ProviderReport["assistedTaskStatus"] = null;
      if (p.id === "official_browser_assisted") {
        let tq = db
          .from("official_registry_verification_tasks")
          .select("status, updated_at")
          .order("updated_at", { ascending: false })
          .limit(1);
        if (data.caseId) tq = tq.eq("case_id", data.caseId);
        const { data: taskRows } = await tq;
        assistedTaskStatus = taskRows?.[0]?.status ?? null;
      }

      reports.push({
        id: p.id,
        name: p.name,
        category: p.category,
        status,
        requiredEnv: p.requiredEnv,
        envConfigured: env,
        lastRun,
        assistedTaskStatus,
        evidenceCount,
        lastEvidenceExcerpt,
        checklistItemsAffected: p.checklistItemsAffected,
        notes: p.notes,
      });
    }

    // Also surface which providers are known NOT implemented in code.
    const notImplemented = ["tianyancha"].map((id) => ({
      id,
      name: id,
      reason: "Not implemented in this codebase. Not queried; not listed as queried in any report.",
    }));

    return { generatedAt: new Date().toISOString(), scopedToCase: data.caseId ?? null, providers: reports, notImplemented };
  });
