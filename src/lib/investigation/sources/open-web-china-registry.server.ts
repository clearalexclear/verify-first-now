import { fcScrape, fcSearch, type FirecrawlSearchHit } from "../firecrawl.server";
import type { EvidenceClassification, Finding, FindingConfidence, ResolvedEntity } from "../types";
import type { ExtractedDoc } from "../extract-documents.server";
import { isStrictUsccCandidate, validateUsccChecksum } from "../uscc";

export const OPEN_WEB_CHINA_REGISTRY_PROVIDER = "open_web_china_registry";
export const OPEN_WEB_CHINA_REGISTRY_SOURCE = "Open-web registry intelligence";
export const OPEN_WEB_CHINA_REGISTRY_LABEL =
  "Open-web registry intelligence — not equivalent to direct official registry API verification.";

type RegistryItem =
  | "Legal company existence"
  | "Chinese legal name"
  | "Unified Social Credit Code"
  | "Registration status"
  | "Incorporation date"
  | "Registered capital"
  | "Legal representative"
  | "Registered address"
  | "Business scope"
  | "Shareholders and beneficial ownership"
  | "Related companies"
  | "Litigation and enforcement screening"
  | "Enforcement and administrative penalties";

export interface OpenWebRegistryInput {
  statedName: string;
  chineseName: string | null;
  country?: string | null;
  website: string | null;
  productCategory?: string | null;
  cityProvinceHint?: string | null;
  resolved: ResolvedEntity;
  extracted: ExtractedDoc[];
}

export interface OpenWebRegistryEvidenceSource {
  url: string;
  title: string;
  snippet: string;
  markdown: string;
  kind: "official" | "marketplace" | "company_website" | "indexed_registry" | "court_or_enforcement" | "public_web";
}

export interface OpenWebRegistryExtract {
  chineseLegalName: string | null;
  englishName: string | null;
  uscc: string | null;
  registrationStatus: string | null;
  incorporationDate: string | null;
  registeredCapital: string | null;
  registeredAddress: string | null;
  legalRepresentative: string | null;
  businessScope: string | null;
  shareholdersOwnership: string | null;
  relatedCompanies: string | null;
  litigationMentions: string | null;
  enforcementPenaltyMentions: string | null;
  abnormalOperationMentions: string | null;
}

export interface OpenWebRegistryResult {
  status: "success" | "not_configured" | "not_found" | "conflict" | "error";
  findings: Finding[];
  resolvedPatch: Partial<ResolvedEntity> | null;
  rawResponse: unknown | null;
  fieldsReturned: string[];
  diagnostics: {
    searchesRun: string[];
    sourcesFound: number;
    fieldsExtracted: string[];
    conflicts: string[];
    confidence: FindingConfidence;
    checklistImpact: string[];
    impactLevels?: Record<"identity_accepted" | "supplier_linked_caution" | "diagnostic_only" | "ignored_noise", number>;
    ignoredInvalidUsccCandidates?: number;
  };
  error?: string;
}

interface SupplierContext {
  statedName: string;
  chineseName: string | null;
  domain: string | null;
  knownUscc: string | null;
  englishTokens: string[];
  country: string | null;
}

interface OpenWebRegistryDeps {
  search?: typeof fcSearch;
  scrape?: typeof fcScrape;
  env?: Record<string, string | undefined>;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter((item): item is string => Boolean(item))));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/co\.?,? ?ltd\.?|limited|company|inc\.?|corp\.?|有限公司|有限责任公司/g, "")
    .replace(/[\s.,'’“”"()（）-]+/g, "")
    .trim();
}

export function cleanMarketingEntityName(value: string | null | undefined, submittedName?: string | null): string | null {
  let out = clean(value);
  if (!out) return null;
  const original = out;
  const stripOnce = /^(?:(?:OEM|ODM|OBM|Factory|China|Manufacturer|Supplier|Professional|Custom|Wholesale|Exporter)\s+)+(.+)$/i;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(stripOnce, "$1").trim();
    if (next === out) break;
    out = next;
  }
  const legalSuffix = out.match(/^(.+?\b(?:Co\.?,?\s*Ltd\.?|Company Limited|Limited|LLC|Inc\.?|Corp\.?|Corporation)\.?)/i);
  if (legalSuffix) out = legalSuffix[1].trim();
  out = out.replace(/^[\s,;:|/-]+|[\s,;:|/-]+$/g, "");
  if (!out) return original;
  const submitted = normalize(submittedName);
  if (!submitted) return out;
  const cleaned = normalize(out);
  const before = normalize(original);
  if (cleaned === submitted || cleaned.includes(submitted) || submitted.includes(cleaned)) return out;
  return before === submitted || before.includes(submitted) || submitted.includes(before) ? out : original;
}

function tokenizeEnglishName(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !["limited", "company", "corp", "corporation", "cookware", "kitchenware", "factory", "trading", "export", "import"].includes(token));
}

function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sourceKind(url: string, submittedDomain: string | null): OpenWebRegistryEvidenceSource["kind"] {
  const host = websiteDomain(url) ?? "";
  if (/creditchina\.gov\.cn|gsxt\.gov\.cn|samr\.gov\.cn|court\.gov\.cn|zxgk\.court\.gov\.cn|gov\.cn$/i.test(host)) return "official";
  if (/court|zxgk|wenshu|legal|law/i.test(host)) return "court_or_enforcement";
  if (/qcc\.com|tianyancha\.com|aiqicha\.baidu\.com|qixin\.com/i.test(host)) return "indexed_registry";
  if (/alibaba|1688\.com|made-in-china|globalsources/i.test(host)) return "marketplace";
  if (submittedDomain && host === submittedDomain) return "company_website";
  return "public_web";
}

function isIgnorableSource(source: OpenWebRegistryEvidenceSource): boolean {
  const text = `${source.url}\n${source.title}\n${source.snippet}`.toLowerCase();
  return (
    /\.(pdf)(?:$|[?#])/i.test(source.url) ||
    /login|captcha|help|guide|manual|\bform\b|download|template|publication|publisher|press|copyright|about-us|contact-us/i.test(text)
  );
}

export { isStrictUsccCandidate, validateUsccChecksum };

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = clean(match?.[1] ?? match?.[0]);
    if (value) return value.replace(/[，,。；;：:\]|】）)]+$/g, "").trim();
  }
  return null;
}

function windowAround(text: string, needle: string, radius = 220): string | null {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + needle.length + radius));
}

function registryLabelNear(text: string, value: string | null): boolean {
  if (!value) return false;
  const window = windowAround(text, value) ?? text.slice(0, 600);
  return /企业名称|公司名称|统一社会信用代码|信用代码|法定代表人|注册资本|经营状态|登记状态|经营范围|工商信息/i.test(window);
}

function hasStrongSupplierIdentifier(text: string, context: SupplierContext): boolean {
  const lower = text.toLowerCase();
  const exactEnglish = clean(context.statedName);
  if (exactEnglish && lower.includes(exactEnglish.toLowerCase())) return true;
  if (context.chineseName && text.includes(context.chineseName)) return true;
  if (context.domain && lower.includes(context.domain.toLowerCase())) return true;
  if (context.knownUscc && lower.includes(context.knownUscc.toLowerCase())) return true;
  if (context.englishTokens.length >= 2) {
    const hits = context.englishTokens.filter((token) => lower.includes(token)).length;
    if (hits >= Math.min(2, context.englishTokens.length)) return true;
  }
  return false;
}

function hasExactSupplierNameOrDomain(text: string, context: SupplierContext): boolean {
  const lower = text.toLowerCase();
  const exactEnglish = clean(context.statedName);
  return Boolean(
    (exactEnglish && lower.includes(exactEnglish.toLowerCase())) ||
      (context.domain && lower.includes(context.domain.toLowerCase())),
  );
}

function hasSupplierIdentifierNear(text: string, value: string | null, context: SupplierContext): boolean {
  if (!value) return false;
  const window = windowAround(text, value, 320) ?? "";
  return hasStrongSupplierIdentifier(window, context);
}

function contextForInput(input: OpenWebRegistryInput): SupplierContext {
  return {
    statedName: input.statedName,
    chineseName: input.chineseName ?? input.resolved.legal_name_local,
    domain: websiteDomain(input.website),
    knownUscc: input.resolved.registration_number,
    englishTokens: tokenizeEnglishName(input.statedName || input.resolved.legal_name_en),
    country: input.country ?? input.resolved.registration_country ?? null,
  };
}

function extractUsccCandidates(text: string): string[] {
  return Array.from(new Set((text.match(/[0-9A-Z]{18}/gi) ?? []).map((value) => value.toUpperCase()).filter(isStrictUsccCandidate)));
}

function countIgnoredUsccNoise(text: string): number {
  return (text.match(/[0-9A-Z]{18}/gi) ?? [])
    .map((value) => value.toUpperCase())
    .filter((value) => !isStrictUsccCandidate(value)).length;
}

function isAcceptedSupplierIdentityCandidate(args: {
  value: string | null;
  field: keyof OpenWebRegistryExtract;
  sourceText: string;
  context?: SupplierContext;
  acceptedChineseNames: Set<string>;
  trustedAgreementCount?: number;
}): boolean {
  if (!args.value) return false;
  if (!args.context) return true;
  const { context, sourceText: text, value } = args;
  const valueKey = normalize(value);
  const linkedChineseName = args.field === "chineseLegalName" && (
    (context.chineseName && normalize(context.chineseName) === valueKey) ||
    args.acceptedChineseNames.has(valueKey)
  );
  if (linkedChineseName) return true;
  if (hasExactSupplierNameOrDomain(text, context)) return true;
  if (args.field === "uscc") {
    const supplierLinked = hasExactSupplierNameOrDomain(text, context);
    const isChina = !context.country || /china|cn|中国/i.test(context.country);
    if (isChina) return validateUsccChecksum(value) && supplierLinked;
    return supplierLinked && (args.trustedAgreementCount ?? 0) >= 2;
  }
  if (context.englishTokens.length >= 2) {
    const lower = text.toLowerCase();
    const hits = context.englishTokens.filter((token) => lower.includes(token)).length;
    if (hits >= Math.min(2, context.englishTokens.length)) return true;
  }
  return false;
}

function extractFromText(text: string, context?: SupplierContext): OpenWebRegistryExtract {
  const rawChineseName = firstMatch(text, [/([\u4e00-\u9fa5（）()]{4,}(?:有限公司|有限责任公司|股份有限公司))/]);
  const rawUscc = firstMatch(text, [/(?:统一社会信用代码|信用代码|USCC|Unified Social Credit Code)[：:\s]*([0-9A-Z]{18})/i, /([0-9A-Z]{18})/]);
  const rawEnglishName = firstMatch(text, [/([A-Z][A-Za-z0-9&.,'’\-\s]{4,}(?:Co\.?,?\s*Ltd\.?|Company Limited|Limited))/i]);
  const chineseLegalName =
    rawChineseName &&
    (!context || (registryLabelNear(text, rawChineseName) && hasSupplierIdentifierNear(text, rawChineseName, context)))
      ? rawChineseName
      : null;
  const uscc =
    rawUscc &&
    (!context || (validateUsccChecksum(rawUscc) && hasSupplierIdentifierNear(text, rawUscc, context)))
      ? rawUscc
      : null;
  return {
    chineseLegalName,
    englishName: cleanMarketingEntityName(rawEnglishName, context?.statedName),
    uscc,
    registrationStatus: firstMatch(text, [/(?:经营状态|登记状态|注册状态|Status)[：:\s]*([^\n\r，,。；;]{2,40})/i]),
    incorporationDate: firstMatch(text, [/(?:成立日期|注册日期|成立时间|Incorporation Date|Established)[：:\s]*(\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2})/i]),
    registeredCapital: firstMatch(text, [/(?:注册资本|Registered Capital)[：:\s]*([^\n\r，,。；;]{2,40})/i]),
    registeredAddress: firstMatch(text, [/(?:注册地址|住所|企业地址|Registered Address|Address)[：:\s]*([^\n\r。；;]{6,120})/i]),
    legalRepresentative: firstMatch(text, [/(?:法定代表人|法人代表|Legal Representative)[：:\s]*([^\n\r，,。；;]{2,30})/i]),
    businessScope: firstMatch(text, [/(?:经营范围|Business Scope)[：:\s]*([^\n\r]{8,260})/i]),
    shareholdersOwnership: firstMatch(text, [/(?:股东|投资人|Shareholders?|Ownership)[：:\s]*([^\n\r]{2,180})/i]),
    relatedCompanies: firstMatch(text, [/(?:关联企业|分支机构|Related Companies|Affiliates)[：:\s]*([^\n\r]{2,180})/i]),
    litigationMentions: /裁判文书|诉讼|开庭公告|法院|lawsuit|litigation|court/i.test(text)
      ? firstMatch(text, [/(?:裁判文书|诉讼|Litigation|Court)[：:\s]*([^\n\r。；;]{2,180})/i]) ?? "Public page mentions litigation or court-record terms."
      : null,
    enforcementPenaltyMentions: /行政处罚|被执行人|失信|处罚|enforcement|penalt/i.test(text)
      ? firstMatch(text, [/(?:行政处罚|被执行人|失信|处罚|Enforcement|Penalty)[：:\s]*([^\n\r。；;]{2,180})/i]) ?? "Public page mentions enforcement or administrative-penalty terms."
      : null,
    abnormalOperationMentions: /经营异常|异常名录|abnormal operation/i.test(text)
      ? firstMatch(text, [/(?:经营异常|异常名录|Abnormal Operation)[：:\s]*([^\n\r。；;]{2,180})/i]) ?? "Public page mentions abnormal-operation records."
      : null,
  };
}

function sourceText(source: OpenWebRegistryEvidenceSource): string {
  return `${source.title}\n${source.snippet}\n${source.markdown}`.slice(0, 12_000);
}

function relevanceForSource(source: OpenWebRegistryEvidenceSource, context?: SupplierContext): { relevant: boolean; redFlags: string[] } {
  const text = sourceText(source);
  const redFlags: string[] = [];
  if (!context) return { relevant: true, redFlags };
  const hasIdentifier = hasStrongSupplierIdentifier(text, context);
  const candidates = extractUsccCandidates(text);
  const invalidCandidates = candidates.filter((candidate) => !validateUsccChecksum(candidate));
  if (invalidCandidates.length > 0 && hasIdentifier) {
    redFlags.push(`Invalid USCC candidate found near supplier context: ${invalidCandidates[0]}`);
  }
  const extractedWithoutContext = extractFromText(text);
  if (isIgnorableSource(source)) return { relevant: false, redFlags };
  if (source.kind === "public_web" && !/统一社会信用代码|信用代码|法定代表人|注册资本|经营状态|经营范围|工商信息/i.test(text)) {
    return { relevant: false, redFlags };
  }
  return { relevant: hasIdentifier, redFlags };
}

export function buildOpenWebRegistryQueries(input: OpenWebRegistryInput): string[] {
  const domain = websiteDomain(input.website);
  const names = unique([input.resolved.registration_number, input.resolved.legal_name_local, input.chineseName, input.statedName, domain, input.productCategory, input.cityProvinceHint]);
  const core = unique([input.chineseName, input.statedName, input.resolved.legal_name_local, input.resolved.legal_name_en]);
  const suffixes = ["统一社会信用代码", "法定代表人", "注册资本", "经营状态", "经营范围", "工商信息", "行政处罚", "经营异常", "被执行人", "裁判文书"];
  const out: string[] = [];
  for (const name of core.slice(0, 4)) {
    for (const suffix of suffixes) out.push(`${name} ${suffix}`);
  }
  if (domain) out.push(`${domain} 统一社会信用代码`, `site:${domain} 公司 统一社会信用代码`);
  if (input.productCategory) out.push(`${input.statedName} ${input.productCategory} 工商信息`);
  if (input.cityProvinceHint) out.push(`${input.statedName} ${input.cityProvinceHint} 工商信息`);
  return unique([...out, ...names]).slice(0, 24);
}

function countValues(values: Array<string | null>): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) {
    const key = normalize(value);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

function consensus(values: Array<string | null>): { value: string | null; count: number; conflict: boolean } {
  const cleaned = values.map(clean).filter((item): item is string => Boolean(item));
  if (cleaned.length === 0) return { value: null, count: 0, conflict: false };
  const counts = countValues(cleaned);
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const value = cleaned.find((item) => normalize(item) === sorted[0][0]) ?? cleaned[0];
  return { value, count: sorted[0][1], conflict: sorted.length > 1 };
}

function classificationForField(args: {
  value: string | null;
  sourceCount: number;
  official: boolean;
  conflict: boolean;
  weak: boolean;
}): EvidenceClassification {
  if (!args.value) return "NOT_INDEPENDENTLY_VERIFIED";
  if (args.conflict) return "CONTRADICTED";
  if (args.official) return "VERIFIED";
  if (args.sourceCount >= 2 && !args.weak) return "CORROBORATED";
  return "NOT_INDEPENDENTLY_VERIFIED";
}

function statusForClassification(classification: EvidenceClassification): Finding["status"] {
  if (classification === "CONTRADICTED") return "CAUTION";
  if (classification === "VERIFIED" || classification === "CORROBORATED") return "PASS";
  return "NOT_VERIFIED";
}

function confidenceForClassification(classification: EvidenceClassification): FindingConfidence {
  if (classification === "VERIFIED") return "high";
  if (classification === "CORROBORATED") return "medium_high";
  if (classification === "CONTRADICTED") return "medium";
  return "low";
}

function finding(args: {
  item: RegistryItem;
  section: Finding["section"];
  value: string;
  classification: EvidenceClassification;
  source: OpenWebRegistryEvidenceSource;
  retrievedAt: string;
  note?: string;
}): Finding {
  const label = args.source.kind === "official"
    ? `${OPEN_WEB_CHINA_REGISTRY_SOURCE} — official source: ${args.source.title || args.source.url}`
    : OPEN_WEB_CHINA_REGISTRY_SOURCE;
  const status = statusForClassification(args.classification);
  return {
    section: args.section,
    item: args.item,
    status,
    confidence: confidenceForClassification(args.classification),
    source_name: label,
    source_url: args.source.url,
    retrieval_date: args.retrievedAt,
    evidence_excerpt: `${args.item}: ${args.value}. ${OPEN_WEB_CHINA_REGISTRY_LABEL}${args.note ? ` ${args.note}` : ""}`,
    evidence_classification: args.classification,
    buyer_impact: status === "PASS"
      ? "This registry item is supported by public web evidence, but open-web registry intelligence is weaker than direct official registry API verification."
      : "This registry item cannot be relied on without stronger official registry evidence.",
    recommended_action: args.classification === "VERIFIED"
      ? "Retain the captured official/public source evidence and compare against supplier documents."
      : "Confirm this field through QINCheck, Panda360, QCC, or an official registry capture before relying on it.",
  };
}

interface ExtractedSource {
  source: OpenWebRegistryEvidenceSource;
  text: string;
  extract: OpenWebRegistryExtract;
}

function bestSourceForField(entries: ExtractedSource[], field: keyof OpenWebRegistryExtract): OpenWebRegistryEvidenceSource | null {
  return entries.find((entry) => entry.source.kind === "official" && clean(entry.extract[field]))?.source
    ?? entries.find((entry) => clean(entry.extract[field]))?.source
    ?? null;
}

function fieldFinding(args: {
  item: RegistryItem;
  section: Finding["section"];
  field: keyof OpenWebRegistryExtract;
  entries: ExtractedSource[];
  retrievedAt: string;
  weak: boolean;
  conflicts: string[];
  context?: SupplierContext;
  acceptedChineseNames: Set<string>;
  trustedAgreementCounts: Map<string, number>;
}): Finding | null {
  const acceptedEntries = args.entries.filter((entry) =>
    isAcceptedSupplierIdentityCandidate({
      value: clean(entry.extract[args.field]),
      field: args.field,
      sourceText: entry.text,
      context: args.context,
      acceptedChineseNames: args.acceptedChineseNames,
      trustedAgreementCount: args.trustedAgreementCounts.get(normalize(clean(entry.extract[args.field]))),
    }),
  );
  const rejectedEntries = args.entries.filter((entry) => clean(entry.extract[args.field]) && !acceptedEntries.includes(entry));
  if (rejectedEntries.length > 0 && ["chineseLegalName", "uscc", "registeredCapital", "registeredAddress", "legalRepresentative", "businessScope"].includes(args.field)) {
    args.conflicts.push("Unrelated registry entity detected in open-web results; not accepted as supplier identity.");
  }
  const values = acceptedEntries.map((entry) => clean(entry.extract[args.field]));
  const selected = consensus(values);
  if (!selected.value) return null;
  const source = bestSourceForField(acceptedEntries, args.field);
  if (!source) return null;
  const official = acceptedEntries.some((entry) => entry.source.kind === "official" && clean(entry.extract[args.field]));
  let classification = classificationForField({
    value: selected.value,
    sourceCount: selected.count,
    official,
    conflict: selected.conflict,
    weak: args.weak,
  });
  let note: string | undefined;
  if (selected.conflict) args.conflicts.push(`Conflicting ${args.item} values found across public sources`);
  if (args.field === "uscc" && !validateUsccChecksum(selected.value)) {
    classification = "CONTRADICTED";
    note = "The USCC-like value failed the local structural checksum validation.";
    args.conflicts.push("Invalid USCC checksum");
  } else if (args.field === "uscc") {
    note = "The USCC is structurally valid; this alone is not official verification.";
  }
  return finding({
    item: args.item,
    section: args.section,
    value: selected.value,
    classification,
    source,
    retrievedAt: args.retrievedAt,
    note,
  });
}

export function openWebRegistryFindingsFromSources(
  sources: OpenWebRegistryEvidenceSource[],
  retrievedAt = new Date().toISOString(),
  input?: OpenWebRegistryInput,
): Pick<OpenWebRegistryResult, "findings" | "resolvedPatch" | "fieldsReturned" | "diagnostics" | "rawResponse" | "status"> {
  const context = input ? contextForInput(input) : undefined;
  const redFlags: string[] = [];
  let ignoredInvalidUsccCandidates = 0;
  const relevantSources = sources.filter((source) => {
    const relevance = relevanceForSource(source, context);
    redFlags.push(...relevance.redFlags);
    if (context) {
      const text = sourceText(source);
      ignoredInvalidUsccCandidates += countIgnoredUsccNoise(text);
      if (!hasStrongSupplierIdentifier(text, context)) {
        ignoredInvalidUsccCandidates += extractUsccCandidates(text).filter((candidate) => !validateUsccChecksum(candidate)).length;
      }
    }
    return relevance.relevant;
  });
  const qualitySources = relevantSources.filter((source) => source.kind === "official" || source.kind === "indexed_registry" || source.kind === "company_website" || source.kind === "court_or_enforcement");
  const entries = qualitySources.map((source) => {
    const text = sourceText(source);
    return { source, text, extract: extractFromText(text, context) };
  });
  const weak = qualitySources.length < 2 && !qualitySources.some((source) => source.kind === "official");
  const conflicts: string[] = [];
  const acceptedChineseNames = new Set<string>();
  const trustedAgreementCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!["official", "indexed_registry", "company_website", "court_or_enforcement"].includes(entry.source.kind)) continue;
    for (const key of ["uscc", "chineseLegalName", "englishName"] as const) {
      const value = clean(entry.extract[key]);
      if (!value) continue;
      const normalized = normalize(value);
      trustedAgreementCounts.set(normalized, (trustedAgreementCounts.get(normalized) ?? 0) + 1);
    }
  }
  const maybe = (item: RegistryItem, section: Finding["section"], field: keyof OpenWebRegistryExtract) =>
    fieldFinding({ item, section, field, entries, retrievedAt, weak, conflicts, context, acceptedChineseNames, trustedAgreementCounts });
  const findings = [
    maybe("Legal company existence", "legal_entity", "chineseLegalName") ?? maybe("Legal company existence", "legal_entity", "englishName"),
    maybe("Chinese legal name", "legal_entity", "chineseLegalName"),
    maybe("Unified Social Credit Code", "legal_entity", "uscc"),
    maybe("Registration status", "legal_entity", "registrationStatus"),
    maybe("Incorporation date", "legal_entity", "incorporationDate"),
    maybe("Registered capital", "legal_entity", "registeredCapital"),
    maybe("Legal representative", "legal_entity", "legalRepresentative"),
    maybe("Registered address", "legal_entity", "registeredAddress"),
    maybe("Business scope", "legal_entity", "businessScope"),
    maybe("Shareholders and beneficial ownership", "ownership", "shareholdersOwnership"),
    maybe("Related companies", "ownership", "relatedCompanies"),
    maybe("Litigation and enforcement screening", "litigation_enforcement", "litigationMentions"),
    maybe("Enforcement and administrative penalties", "litigation_enforcement", "enforcementPenaltyMentions"),
    maybe("Enforcement and administrative penalties", "litigation_enforcement", "abnormalOperationMentions"),
  ].filter((item): item is Finding => Boolean(item));
  for (const finding of findings) {
    if ((finding.item === "Chinese legal name" || finding.item === "Legal company existence") && /[\u4e00-\u9fa5]/.test(finding.evidence_excerpt)) {
      const value = finding.evidence_excerpt.match(/: ([^.。]+)[.。]/)?.[1];
      if (value) acceptedChineseNames.add(normalize(value));
    }
  }
  for (const redFlag of Array.from(new Set(redFlags))) {
    findings.push({
      section: "legal_entity",
      item: "Red flags and contradictions",
      status: "CAUTION",
      confidence: "medium",
      source_name: OPEN_WEB_CHINA_REGISTRY_SOURCE,
      source_url: sources[0]?.url ?? null,
      retrieval_date: retrievedAt,
      evidence_excerpt: `${redFlag} ${OPEN_WEB_CHINA_REGISTRY_LABEL}`,
      evidence_classification: "INFERRED",
      buyer_impact: "The resolver found a registry-like entity that was not tied to the submitted supplier identifiers, so it was rejected as supplier identity evidence.",
      recommended_action: "Review the search result manually or verify the supplier through QINCheck, Panda360, QCC, or an official registry capture.",
    });
  }

  const fieldsReturned = Array.from(new Set(findings.map((item) => item.item)));
  const identityAcceptedCount = findings.filter((item) => item.item !== "Red flags and contradictions" && item.status !== "NOT_VERIFIED").length;
  const supplierLinkedCautionCount = findings.filter((item) => item.item === "Red flags and contradictions" && item.status === "CAUTION").length;
  const diagnosticOnlyCount = ignoredInvalidUsccCandidates;
  const ignoredNoiseCount = Math.max(0, sources.length - qualitySources.length);
  const allClassifications = findings.map((item) => item.evidence_classification ?? "NOT_INDEPENDENTLY_VERIFIED");
  const confidence: FindingConfidence = allClassifications.includes("VERIFIED")
    ? "high"
    : allClassifications.includes("CORROBORATED")
      ? "medium_high"
      : allClassifications.includes("CONTRADICTED")
        ? "medium"
        : "low";
  const name = findings.find((item) => item.item === "Chinese legal name" || item.item === "Legal company existence");
  const uscc = findings.find((item) => item.item === "Unified Social Credit Code");
  const status = findings.find((item) => item.item === "Registration status");
  const patch: Partial<ResolvedEntity> | null = name || uscc
    ? {
        matched: Boolean(name || uscc),
        legal_name_en: entries.map((item) => item.extract.englishName).find(Boolean) ?? null,
        legal_name_local: entries.map((item) => item.extract.chineseLegalName).find(Boolean) ?? null,
        registration_number: uscc?.evidence_classification === "CONTRADICTED" ? null : entries.map((item) => item.extract.uscc).find(Boolean) ?? null,
        registration_status: entries.map((item) => item.extract.registrationStatus).find(Boolean) ?? null,
        registration_date: entries.map((item) => item.extract.incorporationDate).find(Boolean) ?? null,
        registered_capital: entries.map((item) => item.extract.registeredCapital).find(Boolean) ?? null,
        registered_address: entries.map((item) => item.extract.registeredAddress).find(Boolean) ?? null,
        legal_representative: entries.map((item) => item.extract.legalRepresentative).find(Boolean) ?? null,
        business_scope: entries.map((item) => item.extract.businessScope).find(Boolean) ?? null,
        shareholders: unique(entries.map((item) => item.extract.shareholdersOwnership)),
        related_companies: unique(entries.map((item) => item.extract.relatedCompanies)),
        confidence,
        sources: unique(qualitySources.map((source) => source.url)).map((url) => ({ name: OPEN_WEB_CHINA_REGISTRY_SOURCE, url })),
        notes: OPEN_WEB_CHINA_REGISTRY_LABEL,
      }
    : null;
  const diagnostics = {
      searchesRun: [],
      sourcesFound: qualitySources.length,
      fieldsExtracted: fieldsReturned,
      conflicts,
      confidence,
      checklistImpact: fieldsReturned,
      ignoredInvalidUsccCandidates,
      impactLevels: {
        identity_accepted: identityAcceptedCount,
        supplier_linked_caution: supplierLinkedCautionCount,
        diagnostic_only: diagnosticOnlyCount,
        ignored_noise: ignoredNoiseCount,
      },
    };
  return {
    status: findings.length ? conflicts.length ? "conflict" : "success" : "not_found",
    findings,
    resolvedPatch: patch,
    fieldsReturned,
    rawResponse: {
      sources: qualitySources.map((source) => ({ url: source.url, title: source.title, kind: source.kind, snippet: source.snippet.slice(0, 800) })),
      rejected_sources: sources.length - qualitySources.length,
      extracts: entries.map((entry) => entry.extract),
      conflicts,
      diagnostics,
    },
    diagnostics,
  };
}

export async function runOpenWebChinaRegistryResolver(
  input: OpenWebRegistryInput,
  deps: OpenWebRegistryDeps = {},
): Promise<OpenWebRegistryResult> {
  const env = deps.env ?? process.env;
  if (!env.LOVABLE_API_KEY || !env.FIRECRAWL_API_KEY) {
    return {
      status: "not_configured",
      findings: [],
      resolvedPatch: null,
      rawResponse: null,
      fieldsReturned: [],
      diagnostics: { searchesRun: [], sourcesFound: 0, fieldsExtracted: [], conflicts: [], confidence: "low", checklistImpact: [] },
      error: "LOVABLE_API_KEY and FIRECRAWL_API_KEY are required for open-web China registry resolution.",
    };
  }
  const search = deps.search ?? fcSearch;
  const scrape = deps.scrape ?? fcScrape;
  const queries = buildOpenWebRegistryQueries(input);
  const domain = websiteDomain(input.website);
  const hits = new Map<string, FirecrawlSearchHit>();
  for (const query of queries) {
    const results = await search(query, { limit: 4, country: "cn", scrape: true });
    for (const hit of results) {
      if (hit.url && hits.size < 20) hits.set(hit.url, hit);
    }
  }
  const sources: OpenWebRegistryEvidenceSource[] = [];
  for (const hit of hits.values()) {
    const kind = sourceKind(hit.url, domain);
    const scraped = kind === "official" || kind === "indexed_registry" || kind === "court_or_enforcement" || kind === "company_website"
      ? await scrape(hit.url, { formats: ["markdown"], onlyMainContent: true })
      : null;
    const markdown = scraped?.markdown || hit.markdown || hit.description || "";
    const text = `${hit.title ?? ""}\n${hit.description ?? ""}\n${markdown}`;
    if (!/[0-9A-Z]{18}|统一社会信用代码|法定代表人|注册资本|经营状态|经营范围|工商信息|行政处罚|经营异常|被执行人|裁判文书/i.test(text)) continue;
    sources.push({
      url: scraped?.sourceURL ?? hit.url,
      title: scraped?.title || hit.title || hit.url,
      snippet: hit.description ?? "",
      markdown,
      kind,
    });
  }
  const mapped = openWebRegistryFindingsFromSources(sources, new Date().toISOString(), input);
  mapped.diagnostics.searchesRun = queries;
  if (mapped.rawResponse && typeof mapped.rawResponse === "object") {
    (mapped.rawResponse as { diagnostics?: unknown }).diagnostics = mapped.diagnostics;
  }
  return {
    ...mapped,
    error: mapped.status === "not_found" ? "No usable open-web China registry evidence was found." : undefined,
  };
}
