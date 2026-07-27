import { fcSearch, type FirecrawlSearchHit } from "../firecrawl.server";
import type {
  Finding,
  FindingStatus,
  SupplierInternetScoutingReport,
  SupplierScoutingEvidence,
  SupplierScoutingSourceType,
  SupplierScoutingTrustLevel,
} from "../types";
import type { ExtractedDoc } from "../extract-documents.server";
import type { ResolvedEntity } from "../types";

const GENERIC_NAME_TOKENS = new Set([
  "company",
  "limited",
  "ltd",
  "co",
  "corporation",
  "corp",
  "inc",
  "llc",
  "manufacturer",
  "supplier",
  "factory",
  "trading",
  "trade",
  "industry",
  "industrial",
  "china",
  "product",
  "products",
  "export",
  "import",
  "cookware",
  "kitchenware",
  "hardware",
]);

const USELESS_TEXT = /deveirter|detrevni|gnirts|noitartsiger|edoC tiderC laicoS deifinU|代码|国Unified Social Credit Code公|名称Unified Social Credit Code注册|مصنع|مورد/i;

export interface SupplierScoutingInput {
  supplierName: string;
  resolved: ResolvedEntity;
  website?: string | null;
  marketplaceUrl?: string | null;
  productCategory?: string | null;
  destinationMarket?: string | null;
  extracted?: ExtractedDoc[];
}

export interface SupplierScoutingDeps {
  search?: typeof fcSearch;
  now?: string;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function domainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function nameTokens(value: string | null | undefined): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !GENERIC_NAME_TOKENS.has(token));
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => (v ?? "").trim()).filter(Boolean)));
}

function certificateNumbers(extracted: ExtractedDoc[]): string[] {
  return unique(extracted.map((doc) => doc.extracted_entities?.certificate_number));
}

function uploadedCompanyNames(extracted: ExtractedDoc[]): string[] {
  return unique(extracted.flatMap((doc) => [
    doc.extracted_entities?.company_name_en,
    doc.extracted_entities?.company_name_zh,
    doc.business_licence?.englishName,
    doc.business_licence?.chineseLegalName,
    doc.proforma_invoice?.issuerSellerEntity,
  ]));
}

export function buildSupplierScoutingQueryPlan(input: SupplierScoutingInput): string[] {
  const supplier = input.supplierName.trim();
  const resolvedName = input.resolved.legal_name_en?.trim();
  const localName = input.resolved.legal_name_local?.trim();
  const registrationNumber = input.resolved.registration_number?.trim();
  const domain = domainFromUrl(input.website ?? input.marketplaceUrl);
  const product = input.productCategory?.trim();
  const destination = input.destinationMarket?.trim();
  const certs = certificateNumbers(input.extracted ?? []);
  const names = unique([supplier, resolvedName, localName]);
  const primary = names[0] ?? supplier;

  const queries = [
    `"${primary}"`,
    `"${primary}" Alibaba`,
    `"${primary}" manufacturer`,
    `"${primary}" "trading company"`,
    `"${primary}" address`,
    registrationNumber && `"${primary}" "${registrationNumber}"`,
    domain && `"${domain}" "${primary}"`,
    product && `"${primary}" "${product}"`,
    destination && `"${primary}" "${destination}" import export`,
    `"${primary}" lawsuit litigation court dispute fraud scam complaint`,
    `"${primary}" recall CPSC FDA "food contact" LFGB`,
    `"${primary}" shipment importer export "bill of lading"`,
    `"${primary}" "trade fair" exhibition`,
    ...certs.flatMap((cert) => [
      `"${primary}" "${cert}"`,
      `"${cert}" certificate issuer lab`,
    ]),
    ...names.slice(1).map((name) => `"${name}"`),
  ];

  return unique(queries).slice(0, 18);
}

function sourceTypeFor(hit: FirecrawlSearchHit, query: string, domain: string | null): SupplierScoutingSourceType {
  const text = `${hit.url} ${hit.title ?? ""} ${hit.description ?? ""}`.toLowerCase();
  if (domain && text.includes(domain)) return "supplier_site";
  if (/alibaba|1688\.com|made-in-china|globalsources|exporthub/.test(text)) return "marketplace";
  if (/gov\.cn|samr\.gov\.cn|creditchina|gsxt|customs\.gov|cpsc\.gov|fda\.gov/.test(text)) return "official_source";
  if (/tuv|tüv|sgs|intertek|ul\.com|bureauveritas|bvna|cert|certificate/.test(text)) return "certificate_issuer";
  if (/importyeti|panjiva|shipment|bill of lading|trade data|importer/.test(text)) return "trade_data";
  if (/lawsuit|litigation|court|fraud|scam|complaint|dispute|recall/.test(`${text} ${query.toLowerCase()}`)) return "adverse_media";
  if (/linkedin|facebook|youtube|instagram|x\.com|twitter/.test(text)) return "social";
  if (/directory|manufacturer|supplier|catalog|catalogue|b2b/.test(text)) return "directory";
  return "directory";
}

function trustLevelFor(type: SupplierScoutingSourceType): SupplierScoutingTrustLevel {
  if (type === "official_source") return "official";
  if (type === "certificate_issuer" || type === "trade_data") return "trusted_public";
  if (type === "marketplace") return "marketplace";
  if (type === "directory" || type === "supplier_site") return "directory";
  return "weak";
}

function textForHit(hit: FirecrawlSearchHit): string {
  return `${hit.title ?? ""}\n${hit.description ?? ""}\n${hit.markdown ?? ""}\n${hit.url ?? ""}`;
}

function isRawGarbage(value: string): boolean {
  if (USELESS_TEXT.test(value)) return true;
  if (/[{}<>]{8,}|function\(|var\s+|window\./i.test(value)) return true;
  const arabic = (value.match(/[\u0600-\u06ff]/g) ?? []).length;
  return arabic > 0;
}

export function evaluateScoutingHit(input: SupplierScoutingInput, query: string, hit: FirecrawlSearchHit, now: string): SupplierScoutingEvidence | null {
  const text = textForHit(hit);
  if (!hit.url || isRawGarbage(text)) return null;

  const supplierExact = normalizeText(input.supplierName);
  const resolvedExact = normalizeText(input.resolved.legal_name_en);
  const localExact = normalizeText(input.resolved.legal_name_local);
  const domain = domainFromUrl(input.website ?? input.marketplaceUrl);
  const registrationNumber = input.resolved.registration_number?.trim();
  const certs = certificateNumbers(input.extracted ?? []);
  const uploadedNames = uploadedCompanyNames(input.extracted ?? []);
  const lower = normalizeText(text);

  const matchedIdentifiers: string[] = [];
  if (supplierExact && lower.includes(supplierExact)) matchedIdentifiers.push("supplier name");
  if (resolvedExact && lower.includes(resolvedExact)) matchedIdentifiers.push("resolved entity name");
  if (localExact && lower.includes(localExact)) matchedIdentifiers.push("local legal name");
  if (domain && lower.includes(domain)) matchedIdentifiers.push("supplier domain");
  if (registrationNumber && lower.includes(registrationNumber.toLowerCase())) matchedIdentifiers.push("registration number");
  for (const cert of certs) {
    if (cert && lower.includes(cert.toLowerCase())) matchedIdentifiers.push("certificate number");
  }
  for (const name of uploadedNames) {
    const normalized = normalizeText(name);
    if (normalized && lower.includes(normalized)) matchedIdentifiers.push("uploaded document company name");
  }

  const tokens = nameTokens(input.supplierName);
  const tokenMatches = tokens.filter((token) => lower.includes(token));
  if (tokenMatches.length >= Math.min(2, Math.max(tokens.length, 2))) matchedIdentifiers.push("normalized supplier name tokens");

  if (matchedIdentifiers.length === 0) return null;

  const type = sourceTypeFor(hit, query, domain);
  if (type === "social" && !matchedIdentifiers.includes("supplier domain") && !matchedIdentifiers.includes("supplier name")) return null;
  const relevanceScore = Math.min(100, matchedIdentifiers.length * 25 + (type === "supplier_site" ? 25 : 0) + (type === "official_source" ? 15 : 0));
  if (relevanceScore < 35) return null;

  const extractedFacts = extractFacts(input, hit, text);
  const title = cleanBuyerSnippet(hit.title || hit.url);
  return {
    title,
    url: hit.url,
    source_type: type,
    retrieved_at: now,
    query_used: query,
    matched_identifiers: unique(matchedIdentifiers),
    relevance_score: relevanceScore,
    trust_level: trustLevelFor(type),
    extracted_facts: extractedFacts,
    buyer_safe_summary: summaryForEvidence(type, title, extractedFacts),
    limitation: limitationForSource(type),
  };
}

function cleanBuyerSnippet(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[{}[\]]/g, "")
    .slice(0, 220)
    .trim();
}

function extractFacts(input: SupplierScoutingInput, hit: FirecrawlSearchHit, text: string): SupplierScoutingEvidence["extracted_facts"] {
  const title = cleanBuyerSnippet(hit.title || "");
  const desc = cleanBuyerSnippet(hit.description || "");
  const combined = `${title}. ${desc}`;
  const onlineNames = unique([title.match(/[A-Z][A-Za-z0-9&.,'’\-\s]+(?:Co\.?,?\s*Ltd\.?|Ltd\.?|Limited|LLC|GmbH|Inc\.?)/)?.[0], input.supplierName]);
  const product = input.productCategory && new RegExp(input.productCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)
    ? [input.productCategory]
    : [];
  return {
    online_names: onlineNames.slice(0, 3),
    marketplace_badges: unique([combined.match(/\b(?:Gold Supplier|Verified Supplier|Audited Supplier|Assessed Supplier|years? supplier)\b/i)?.[0]]),
    manufacturer_or_trader_claims: unique([
      /\bmanufacturer\b/i.test(text) ? "Manufacturer claim appears in public page text." : null,
      /\btrading company\b|\btrader\b/i.test(text) ? "Trading-company claim appears in public page text." : null,
      /\bfactory\b/i.test(text) ? "Factory claim appears in public page text." : null,
    ]),
    product_categories: product,
    contact_details: unique([hit.url.includes("@") ? hit.url : null, combined.match(/[A-Z][A-Za-z\s]+(?:Road|Rd\.|Street|St\.|Avenue|Industrial Zone|District)[^.;]{0,80}/i)?.[0]]).slice(0, 3),
    certificate_references: unique(certificateNumbers(input.extracted ?? []).filter((cert) => text.toLowerCase().includes(cert.toLowerCase()))),
    export_or_customer_traces: /shipment|bill of lading|importer|export/i.test(text) ? ["Public page mentions shipment/export/import context."] : [],
    trade_fair_traces: /trade fair|exhibition|canton fair|messe/i.test(text) ? ["Public page mentions trade fair or exhibition activity."] : [],
    adverse_or_complaint_indicators: /fraud|scam|complaint|recall|unsafe|warning/i.test(text) ? ["Public page contains adverse or complaint terms; review source context manually."] : [],
    litigation_or_enforcement_indicators: /lawsuit|litigation|court|judgment|enforcement|penalt/i.test(text) ? ["Public page contains litigation or enforcement terms; review source context manually."] : [],
    contradictions: [],
  };
}

function summaryForEvidence(type: SupplierScoutingSourceType, title: string, facts: SupplierScoutingEvidence["extracted_facts"]): string {
  const sourceLabel = type === "marketplace"
    ? "Marketplace company profile found"
    : type === "supplier_site"
      ? "Supplier website page found"
      : type === "certificate_issuer"
        ? "Certificate issuer/lab page found"
        : type === "trade_data"
          ? "Public trade-data page found"
          : type === "official_source"
            ? "Official/public-source page found"
            : "Supplier-linked public web page found";
  const supports = facts.manufacturer_or_trader_claims.length || facts.product_categories.length
    ? `It supports that the supplier presents itself online as a manufacturer/trader${facts.product_categories[0] ? ` in ${facts.product_categories[0]}` : ""}.`
    : "It supports that a supplier-linked online presence exists.";
  const parts = [
    `${sourceLabel}: ${title}.`,
    supports,
    facts.marketplace_badges[0] && `Marketplace indicator: ${facts.marketplace_badges[0]}.`,
    facts.certificate_references[0] && `Certificate reference visible: ${facts.certificate_references[0]}.`,
    facts.export_or_customer_traces[0],
    facts.trade_fair_traces[0],
    facts.adverse_or_complaint_indicators[0],
    facts.litigation_or_enforcement_indicators[0],
  ].filter(Boolean);
  return parts.join(" ");
}

function limitationForSource(type: SupplierScoutingSourceType): string {
  if (type === "official_source") return "Official/public source capture can support public-web corroboration, but this pass is not a licensed corporate registry API verification.";
  if (type === "certificate_issuer") return "Public certificate references do not prove certificate authenticity unless confirmed directly with the issuing body.";
  if (type === "trade_data") return "Public shipment or trade-data snippets are not a licensed bill-of-lading dataset.";
  if (type === "supplier_site") return "Supplier website content is supplier-controlled and cannot independently verify legal status.";
  if (type === "marketplace") return "Marketplace profile content may be supplier-provided and is not official registry verification.";
  return "Directory/public web content is weak intelligence and must be corroborated before reliance.";
}

function buildAggregate(input: SupplierScoutingInput, evidence: SupplierScoutingEvidence[], queries: string[], foundCount: number, now: string): SupplierInternetScoutingReport {
  const identifiers = unique(evidence.flatMap((item) => item.matched_identifiers));
  const summaries = evidence.map((item) => item.buyer_safe_summary).slice(0, 6);
  const corroborates = unique(evidence.flatMap((item) => [
    item.extracted_facts.online_names.length ? `Online identity/name usage for ${input.supplierName}` : null,
    item.extracted_facts.manufacturer_or_trader_claims.length ? "Supplier public profile includes manufacturer/trader positioning claims." : null,
    item.extracted_facts.product_categories.length ? "Public pages mention the submitted product category." : null,
    item.extracted_facts.certificate_references.length ? "Uploaded certificate numbers appear in public web results." : null,
    item.extracted_facts.trade_fair_traces.length ? "Trade fair or exhibition traces were found." : null,
  ]));
  const contradictions = unique(evidence.flatMap((item) => [
    ...item.extracted_facts.contradictions,
    ...item.extracted_facts.adverse_or_complaint_indicators,
    ...item.extracted_facts.litigation_or_enforcement_indicators,
  ]));
  return {
    generated_at: now,
    queries_run: queries,
    evidence,
    what_found_online: summaries.length ? summaries : ["No supplier-linked public web sources were retained by the relevance gates."],
    what_this_corroborates: corroborates.length ? corroborates : ["No public-web fact was strong enough to corroborate the supplier identity or operating claims."],
    still_not_verified: [
      "Corporate registry status is not officially verified by this scouting pass.",
      "Sanctions/RPS clearance is not completed by public web scouting.",
      "Certificate authenticity is not issuer-verified unless a direct issuer source confirms it.",
      "Shipment history is not verified by a licensed trade-data source.",
      "Litigation and adverse-media coverage is limited to public web search.",
    ],
    potential_contradictions: contradictions.length ? contradictions : ["No supplier-linked contradiction was retained from the public-web scouting pass."],
    buyer_impact: evidence.length
      ? "Public web intelligence can help the buyer spot online presence, marketplace positioning and possible gaps, but it is not official legal, sanctions, certificate or shipment verification."
      : "The supplier has little retained public-web evidence from the targeted searches, so the buyer should rely on document reconciliation and official/paid checks before payment.",
    recommended_next_actions: [
      "Confirm the uploaded business licence against GSXT/CODS or licensed registry data.",
      "Ask the supplier for issuer verification links for each certificate/test report.",
      "Use licensed shipment data if export history matters to the buying decision.",
    ],
    diagnostics: {
      searches_run: queries.length,
      sources_found: foundCount,
      retained_sources: evidence.length,
      rejected_sources: Math.max(0, foundCount - evidence.length),
      matched_identifiers: identifiers,
    },
  };
}

function scoutingFinding(report: SupplierInternetScoutingReport, now: string): Finding {
  const hasEvidence = report.evidence.length > 0;
  const hasConcerns = report.potential_contradictions.some((item) => !/^No supplier-linked contradiction/i.test(item));
  const status: FindingStatus = !hasEvidence ? "NOT_VERIFIED" : hasConcerns ? "CAUTION" : "CAUTION";
  const classification = report.evidence.filter((item) => item.trust_level !== "weak").length >= 2 ? "CORROBORATED" : "NOT_INDEPENDENTLY_VERIFIED";
  return {
    section: "digital_footprint",
    item: "Public web intelligence scouting",
    status,
    confidence: hasEvidence ? "medium" : "low",
    source_name: "Public web intelligence",
    source_url: report.evidence[0]?.url ?? null,
    retrieval_date: now,
    evidence_excerpt: report.what_found_online.join(" "),
    evidence_ids: [],
    evidence_classification: classification,
    buyer_impact: report.buyer_impact,
    recommended_action: report.recommended_next_actions.join(" "),
  };
}

export async function scoutSupplierInternet(input: SupplierScoutingInput, deps: SupplierScoutingDeps = {}): Promise<{
  report: SupplierInternetScoutingReport;
  findings: Finding[];
}> {
  const now = deps.now ?? new Date().toISOString();
  const search = deps.search ?? fcSearch;
  const queries = buildSupplierScoutingQueryPlan(input);
  const byUrl = new Map<string, SupplierScoutingEvidence>();
  let foundCount = 0;

  for (const query of queries) {
    const hits = await search(query, { limit: 3, scrape: true });
    foundCount += hits.length;
    for (const hit of hits) {
      if (byUrl.has(hit.url)) continue;
      const evidence = evaluateScoutingHit(input, query, hit, now);
      if (evidence) byUrl.set(hit.url, evidence);
    }
  }

  const evidence = Array.from(byUrl.values()).sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 12);
  const report = buildAggregate(input, evidence, queries, foundCount, now);
  return { report, findings: [scoutingFinding(report, now)] };
}
