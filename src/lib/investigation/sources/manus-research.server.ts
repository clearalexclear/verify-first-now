import type { ExtractedDoc } from "../extract-documents.server";
import type {
  EvidenceClassification,
  Finding,
  ManusClaimValidationStatus,
  ManusEvidenceClaim,
  ManusResearchReport,
  ManusResearchStatus,
  ManusSourceType,
  ResolvedEntity,
} from "../types";
import {
  hasCorruptedBuyerFacingCjk,
  normalizeQuestionsBeforePayment,
  sanitizeBuyerFacingCjkText,
} from "../report-sanitizer";

const MANUS_DEFAULT_BASE_URL = "https://api.manus.ai";
const MANUS_SOURCE_NAME = "Manus deep research";

const ALLOWED_SOURCE_TYPES: ManusSourceType[] = [
  "official_government_registry",
  "third_party_database",
  "commercial_registry_aggregator",
  "marketplace_platform_recorded_data",
  "supplier_marketing_claim",
  "trade_data",
  "weak_public_web_intelligence",
  "buyer_interpretation",
];

export interface ManusResearchInput {
  caseId?: string | null;
  supplierName: string;
  supplierCountry: string;
  website?: string | null;
  marketplaceUrl?: string | null;
  productCategory?: string | null;
  destinationMarket?: string | null;
  estimatedOrderValue?: string | null;
  paymentConcerns?: string | null;
  resolved?: ResolvedEntity | null;
  extracted?: ExtractedDoc[];
}

export interface ManusResearchDeps {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface ManusRunResult {
  report: ManusResearchReport;
  findings: Finding[];
  rawOutput: unknown | null;
}

interface ManusTaskCreated {
  id: string;
  status: ManusResearchStatus;
}

interface ParsedOutput {
  claims: Array<Partial<ManusEvidenceClaim>>;
  buyer_interpretations: string[];
  questions_before_payment: string[];
}

function nowIso(deps: ManusResearchDeps): string {
  return deps.now ?? new Date().toISOString();
}

function boolEnv(value: string | undefined): boolean {
  return String(value ?? "").toLowerCase() === "true";
}

function normalizeSourceType(value: unknown): ManusSourceType | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_") as ManusSourceType;
  return ALLOWED_SOURCE_TYPES.includes(normalized) ? normalized : null;
}

function domainFromUrl(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function supplierTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&trade;|&amp;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["company", "limited", "ltd", "supplier", "factory", "china", "industry", "trade"].includes(token));
}

function isSupplierRelevant(claim: Partial<ManusEvidenceClaim>, input: ManusResearchInput): boolean {
  const text = [
    claim.claim,
    claim.exact_text_read_from_source,
    claim.source_title,
    claim.source_domain,
    claim.source_url,
    input.resolved?.legal_name_en,
    input.resolved?.legal_name_local,
    input.resolved?.registration_number,
  ].filter(Boolean).join(" ").toLowerCase();
  const supplier = input.supplierName.toLowerCase();
  const domain = domainFromUrl(input.website ?? input.marketplaceUrl);
  if (supplier && text.includes(supplier)) return true;
  if (domain && text.includes(domain)) return true;
  const tokens = supplierTokens(input.supplierName);
  return tokens.length > 0 && tokens.filter((token) => text.includes(token)).length >= Math.min(2, tokens.length);
}

function emptyReport(status: ManusResearchStatus, args: Partial<ManusResearchReport> = {}): ManusResearchReport {
  return {
    provider: "manus",
    status,
    manus_task_id: null,
    started_at: null,
    completed_at: null,
    error_message: null,
    accepted_claims: [],
    rejected_claims: [],
    supplier_marketing_claims: [],
    buyer_interpretations: [],
    questions_before_payment: [],
    rejected_reason_counts: {},
    sources_used: [],
    diagnostics: {
      claims_received: 0,
      claims_accepted: 0,
      claims_rejected: 0,
      sources_used: 0,
    },
    ...args,
  };
}

function textFromDoc(doc: ExtractedDoc): string {
  const entities = doc.extracted_entities ?? {};
  return [
    `filename=${doc.filename}`,
    `category=${doc.category ?? "unknown"}`,
    `summary=${doc.summary}`,
    entities.company_name_en && `company_name_en=${entities.company_name_en}`,
    entities.company_name_zh && `company_name_zh=${entities.company_name_zh}`,
    entities.usci_number && `uscc=${entities.usci_number}`,
    entities.registered_address && `address=${entities.registered_address}`,
    entities.certificate_authority && `certificate_authority=${entities.certificate_authority}`,
    entities.certificate_number && `certificate_number=${entities.certificate_number}`,
  ].filter(Boolean).join("; ");
}

export function buildManusSupplierResearchPrompt(input: ManusResearchInput): string {
  const docs = (input.extracted ?? []).map(textFromDoc).join("\n") || "No uploaded document text was available.";
  return [
    "You are assisting VerifyFirst with an evidence-bound Verified Supplier Report.",
    "Return structured JSON if possible, with top-level keys: claims, buyer_interpretations, questions_before_payment. If JSON is not possible, return clearly labelled markdown using the same fields.",
    "Do not make unsupported factual claims. For every factual claim, include claim, exact_text_read_from_source, source_url, source_title, source_domain, source_type, retrieved_at, limitation, buyer_implication.",
    "Allowed source_type values: official_government_registry, third_party_database, commercial_registry_aggregator, marketplace_platform_recorded_data, supplier_marketing_claim, trade_data, weak_public_web_intelligence, buyer_interpretation.",
    "Separate supplier marketing claims from third-party/platform/official records. Separate buyer interpretation from factual claims.",
    "Do not state official verification unless the source is an official government/public registry source and the exact source text supports the claim.",
    "",
    "Supplier context:",
    `- Supplier name: ${input.supplierName}`,
    `- Country: ${input.supplierCountry}`,
    `- Website/domain: ${input.website ?? "not provided"}`,
    `- Marketplace URL: ${input.marketplaceUrl ?? "not provided"}`,
    `- Product/category: ${input.productCategory ?? "not provided"}`,
    `- Destination market: ${input.destinationMarket ?? "not provided"}`,
    `- Estimated order value: ${input.estimatedOrderValue ?? "not provided"}`,
    `- Payment/customer concerns: ${input.paymentConcerns ?? "not provided"}`,
    `- Resolved English name from VerifyFirst: ${input.resolved?.legal_name_en ?? "not resolved"}`,
    `- Resolved local name from VerifyFirst: ${input.resolved?.legal_name_local ?? "not resolved"}`,
    `- Registration number from VerifyFirst: ${input.resolved?.registration_number ?? "not resolved"}`,
    "",
    "Uploaded evidence summary:",
    docs,
  ].join("\n");
}

function parseTaskId(payload: any): string | null {
  return payload?.id ?? payload?.task_id ?? payload?.data?.id ?? payload?.data?.task_id ?? null;
}

function parseTaskStatus(payload: any): ManusResearchStatus {
  const raw = String(payload?.status ?? payload?.data?.status ?? "").toLowerCase();
  if (raw === "queued" || raw === "running" || raw === "completed" || raw === "failed" || raw === "timed_out") return raw;
  if (raw === "success" || raw === "done") return "completed";
  return "running";
}

async function createManusTask(input: ManusResearchInput, deps: ManusResearchDeps): Promise<ManusTaskCreated> {
  const env = deps.env ?? process.env;
  const apiKey = env.MANUS_API_KEY;
  if (!apiKey) throw new Error("MANUS_API_KEY is not configured");
  const baseUrl = (env.MANUS_API_BASE_URL ?? MANUS_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const response = await (deps.fetch ?? fetch)(`${baseUrl}/v1/tasks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-manus-api-key": apiKey,
      "API_KEY": apiKey,
    },
    body: JSON.stringify({
      prompt: buildManusSupplierResearchPrompt(input),
      metadata: {
        kind: "verifyfirst_supplier_research",
        case_id: input.caseId ?? null,
        supplier_name: input.supplierName,
      },
    }),
  });
  if (!response.ok) throw new Error(`Manus task creation failed: HTTP ${response.status}`);
  const payload = await response.json();
  const id = parseTaskId(payload);
  if (!id) throw new Error("Manus task creation did not return a task ID");
  return { id, status: parseTaskStatus(payload) };
}

async function readManusTask(taskId: string, deps: ManusResearchDeps): Promise<any> {
  const env = deps.env ?? process.env;
  const apiKey = env.MANUS_API_KEY;
  const baseUrl = (env.MANUS_API_BASE_URL ?? MANUS_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const response = await (deps.fetch ?? fetch)(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { "x-manus-api-key": apiKey ?? "", "API_KEY": apiKey ?? "" },
  });
  if (!response.ok) throw new Error(`Manus task status failed: HTTP ${response.status}`);
  return response.json();
}

function textFromMessageList(list: any[]): string {
  return list
    .filter((message) => message?.role !== "user")
    .flatMap((message) => (Array.isArray(message?.content) ? message.content : []))
    .map((part: any) => String(part?.text ?? part?.output_text ?? ""))
    .filter(Boolean)
    .join("\n\n");
}

function outputFromTask(payload: any): unknown {
  const output = payload?.output ?? payload?.result ?? payload?.data?.output ?? payload?.data?.result ?? payload;
  if (Array.isArray(output)) {
    const text = textFromMessageList(output);
    if (text) return text;
  }
  return output;
}

function jsonAttachmentUrl(payload: any): string | null {
  const output = payload?.output;
  if (!Array.isArray(output)) return null;
  const files = output
    .filter((message: any) => message?.role !== "user")
    .flatMap((message: any) => (Array.isArray(message?.content) ? message.content : []))
    .filter((part: any) => part?.type === "output_file" && typeof part?.fileUrl === "string");
  const jsonFile = files.find(
    (part: any) => String(part.mimeType ?? "").includes("json") || String(part.fileName ?? "").toLowerCase().endsWith(".json"),
  );
  return jsonFile?.fileUrl ?? null;
}

async function resolveTaskOutput(payload: any, deps: ManusResearchDeps): Promise<unknown> {
  const url = jsonAttachmentUrl(payload);
  if (url) {
    try {
      const response = await (deps.fetch ?? fetch)(url);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) return text;
      }
    } catch {
      // fall through to inline output
    }
  }
  return outputFromTask(payload);
}

function claimFromObject(value: any): Partial<ManusEvidenceClaim> {
  const sourceUrl = String(value?.source_url ?? value?.url ?? "").trim();
  const sourceTitle = String(value?.source_title ?? value?.title ?? "").trim();
  const sourceType = normalizeSourceType(value?.source_type);
  return {
    claim: String(value?.claim ?? "").trim(),
    exact_text_read_from_source: String(value?.exact_text_read_from_source ?? value?.exact_text ?? value?.source_text ?? "").trim(),
    source_url: sourceUrl,
    source_title: sourceTitle,
    source_domain: String(value?.source_domain ?? domainFromUrl(sourceUrl)).trim(),
    source_type: sourceType ?? "weak_public_web_intelligence",
    retrieved_at: String(value?.retrieved_at ?? new Date().toISOString()).trim(),
    limitation: String(value?.limitation ?? "").trim(),
    buyer_implication: String(value?.buyer_implication ?? "").trim(),
  };
}

function sanitizeClaimText(value: string, sourceType: ManusSourceType): string {
  return sanitizeBuyerFacingCjkText(value, { sourceType });
}

function cleanSupplierNameForClaim(value: string): string {
  return value
    .replace(/&trade;|&amp;/gi, " & ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ")
    .replace(/\bCo\s*,?\s*Ltd\b\.?/i, "Co., Ltd.")
    .trim();
}

function applySourceSpecificClaimWording(value: string, partial: Partial<ManusEvidenceClaim>, sourceType: ManusSourceType, input: ManusResearchInput): string {
  if (sourceType !== "commercial_registry_aggregator") return value;
  const sourceText = `${partial.source_title ?? ""} ${partial.source_domain ?? ""} ${partial.source_url ?? ""}`;
  const uscc = [
    value,
    partial.exact_text_read_from_source,
    partial.source_title,
  ].join(" ").match(/\b[0-9A-Z]{18}\b/)?.[0];
  if (/registered as|with USCC|unified social credit|qichacha|qcc|tianyancha|aiqicha/i.test(`${value} ${sourceText}`) && uscc) {
    return `Commercial registry/search-snippet evidence reports ${cleanSupplierNameForClaim(input.supplierName)} with USCC ${uscc}.`;
  }
  if (!/tianyancha/i.test(sourceText)) return value;
  return value.replace(/^Commercial registry aggregator reports/i, "Tianyancha / registry-snippet data reports");
}

function applySourceSpecificLimitation(value: string, sourceType: ManusSourceType): string {
  if (sourceType === "commercial_registry_aggregator") {
    return "This is commercial registry/search-snippet evidence, not official GSXT verification.";
  }
  return value;
}

function claimHasCorruptedCjk(partial: Partial<ManusEvidenceClaim>): boolean {
  return [
    partial.claim,
    partial.exact_text_read_from_source,
    partial.limitation,
    partial.buyer_implication,
  ].some((value) => hasCorruptedBuyerFacingCjk(value));
}

function parseJsonOutput(raw: unknown): ParsedOutput | null {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const match = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const jsonText = match?.[1] ?? trimmed;
    try {
      value = JSON.parse(jsonText);
    } catch {
      return null;
    }
  }
  const root: any = (value as any)?.data ?? value;
  const claims = Array.isArray(root?.claims)
    ? root.claims
    : Array.isArray(root?.evidence_claims)
      ? root.evidence_claims
      : [];
  return {
    claims: claims.map(claimFromObject),
    buyer_interpretations: Array.isArray(root?.buyer_interpretations) ? root.buyer_interpretations.map(String) : [],
    questions_before_payment: normalizeQuestionsBeforePayment(root?.questions_before_payment),
  };
}

function parseMarkdownOutput(raw: unknown): ParsedOutput {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const claims = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) && /https?:\/\//i.test(line))
    .map((line) => {
      const url = line.match(/https?:\/\/\S+/i)?.[0].replace(/[),.;]+$/, "") ?? "";
      const typeMatch = line.match(/source[_\s-]?type\s*[:=]\s*([a-z_\s-]+)/i);
      const sourceType = normalizeSourceType(typeMatch?.[1]);
      return claimFromObject({
        claim: line.replace(/^[-*]\s+/, "").slice(0, 240),
        exact_text_read_from_source: line,
        source_url: url,
        source_type: sourceType ?? "weak_public_web_intelligence",
      });
    });
  return { claims, buyer_interpretations: [], questions_before_payment: [] };
}

export function parseManusResearchOutput(raw: unknown, input: ManusResearchInput, now = new Date().toISOString()): ManusResearchReport {
  const parsed = parseJsonOutput(raw) ?? parseMarkdownOutput(raw);
  const accepted: ManusEvidenceClaim[] = [];
  const rejected: ManusEvidenceClaim[] = [];
  const supplierMarketing: ManusEvidenceClaim[] = [];
  const rejectedReasonCounts: Partial<Record<ManusClaimValidationStatus, number>> = {};

  for (const partial of parsed.claims) {
    const sourceType = normalizeSourceType(partial.source_type) ?? "weak_public_web_intelligence";
    let validation: ManusClaimValidationStatus = "accepted";
    if (!partial.source_url || !/^https?:\/\//i.test(partial.source_url)) validation = "rejected_missing_source";
    else if (!partial.exact_text_read_from_source) validation = "rejected_missing_exact_text";
    else if (claimHasCorruptedCjk(partial)) validation = "rejected_corrupted_cjk";
    else if (sourceType === "supplier_marketing_claim") validation = "rejected_supplier_claim_only";
    else if (sourceType === "buyer_interpretation" || !isSupplierRelevant(partial, input)) validation = "rejected_low_relevance";

    const claim: ManusEvidenceClaim = {
      claim: applySourceSpecificClaimWording(sanitizeClaimText(String(partial.claim ?? ""), sourceType), partial, sourceType, input),
      exact_text_read_from_source: sanitizeClaimText(String(partial.exact_text_read_from_source ?? ""), sourceType),
      source_url: String(partial.source_url ?? ""),
      source_title: sanitizeClaimText(String(partial.source_title ?? ""), sourceType),
      source_domain: String(partial.source_domain || domainFromUrl(partial.source_url)),
      source_type: sourceType,
      retrieved_at: partial.retrieved_at || now,
      limitation: applySourceSpecificLimitation(sanitizeClaimText(partial.limitation || "Deep-research claim retained only as evidence-bound research; VerifyFirst did not independently verify the source beyond the captured citation.", sourceType), sourceType),
      buyer_implication: sanitizeClaimText(partial.buyer_implication || "Use this as supporting research and confirm critical items through official or licensed sources before payment.", sourceType),
      validation_status: validation,
    };

    if (validation === "accepted") accepted.push(claim);
    else {
      rejected.push(claim);
      rejectedReasonCounts[validation] = (rejectedReasonCounts[validation] ?? 0) + 1;
      if (validation === "rejected_supplier_claim_only") supplierMarketing.push(claim);
    }
  }

  const sourceKeys = new Set<string>();
  const sourcesUsed = accepted
    .map((claim) => ({
      title: claim.source_title || claim.source_domain || claim.source_url,
      url: claim.source_url,
      domain: claim.source_domain || domainFromUrl(claim.source_url),
      source_type: claim.source_type,
    }))
    .filter((source) => {
      const key = source.url.toLowerCase();
      if (sourceKeys.has(key)) return false;
      sourceKeys.add(key);
      return true;
    });

  return emptyReport("completed", {
    completed_at: now,
    accepted_claims: accepted,
    rejected_claims: rejected,
    supplier_marketing_claims: supplierMarketing,
    buyer_interpretations: parsed.buyer_interpretations,
    questions_before_payment: parsed.questions_before_payment,
    rejected_reason_counts: rejectedReasonCounts,
    sources_used: sourcesUsed,
    diagnostics: {
      claims_received: parsed.claims.length,
      claims_accepted: accepted.length,
      claims_rejected: rejected.length,
      sources_used: sourcesUsed.length,
    },
  });
}

function findingClassification(claims: ManusEvidenceClaim[]): EvidenceClassification {
  if (claims.some((claim) => claim.source_type === "official_government_registry")) return "VERIFIED";
  if (claims.some((claim) => claim.source_type === "third_party_database" || claim.source_type === "commercial_registry_aggregator" || claim.source_type === "trade_data")) return "CORROBORATED";
  return "NOT_INDEPENDENTLY_VERIFIED";
}

export function manusReportToFindings(report: ManusResearchReport, retrievedAt: string): Finding[] {
  if (report.accepted_claims.length === 0) return [];
  const excerpt = report.accepted_claims
    .slice(0, 4)
    .map((claim) => `${claim.claim} Source: ${claim.source_title || claim.source_domain}. Limitation: ${claim.limitation}`)
    .join(" ");
  return [{
    section: "digital_footprint",
    item: "Evidence-bound deep supplier research",
    status: report.accepted_claims.some((claim) => /contradict|mismatch|risk|penalt|lawsuit|enforcement/i.test(claim.claim)) ? "CAUTION" : "CAUTION",
    confidence: report.accepted_claims.length >= 2 ? "medium_high" : "medium",
    source_name: MANUS_SOURCE_NAME,
    source_url: report.accepted_claims[0]?.source_url ?? null,
    retrieval_date: retrievedAt,
    evidence_excerpt: excerpt,
    evidence_classification: findingClassification(report.accepted_claims),
    evidence_ids: [],
    buyer_impact: "Deep research added source-cited context for the supplier, but critical payment, registry, sanctions and certificate checks still depend on their own evidence standards.",
    recommended_action: "Use the cited sources as supporting context and resolve all required official/licensed verification gaps before payment.",
  }];
}

export async function runManusSupplierResearch(input: ManusResearchInput, deps: ManusResearchDeps = {}): Promise<ManusRunResult> {
  const env = deps.env ?? process.env;
  const startedAt = nowIso(deps);
  if (!boolEnv(env.MANUS_ENABLED) || !env.MANUS_API_KEY) {
    return {
      report: emptyReport("not_configured", {
        started_at: startedAt,
        completed_at: startedAt,
        error_message: "Deep research backend unavailable/not configured.",
      }),
      findings: [],
      rawOutput: null,
    };
  }

  try {
    const task = await createManusTask(input, deps);
    const timeoutSeconds = Math.max(1, Number(env.MANUS_TIMEOUT_SECONDS ?? "30") || 30);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let payload: any = { id: task.id, status: task.status };
    let status = task.status;
    while (status !== "completed" && status !== "failed" && Date.now() < deadline) {
      await (deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(5000);
      payload = await readManusTask(task.id, deps);
      status = parseTaskStatus(payload);
    }
    if (status !== "completed") {
      return {
        report: emptyReport(Date.now() >= deadline ? "timed_out" : "failed", {
          manus_task_id: task.id,
          started_at: startedAt,
          completed_at: nowIso(deps),
          error_message: status === "failed" ? "Manus task failed." : "Manus task timed out before completion.",
        }),
        findings: [],
        rawOutput: payload,
      };
    }
    const rawOutput = await resolveTaskOutput(payload, deps);
    const report = parseManusResearchOutput(rawOutput, input, nowIso(deps));
    report.manus_task_id = task.id;
    report.started_at = startedAt;
    return { report, findings: manusReportToFindings(report, nowIso(deps)), rawOutput };
  } catch (error) {
    return {
      report: emptyReport("failed", {
        started_at: startedAt,
        completed_at: nowIso(deps),
        error_message: error instanceof Error ? error.message : String(error),
      }),
      findings: [],
      rawOutput: null,
    };
  }
}
