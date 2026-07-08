import type { ExtractedDoc } from "../extract-documents.server";
import type { Finding, FindingConfidence, ResolvedEntity } from "../types";
import { OFFICIAL_BROWSER_ASSISTED_PROVIDER, OFFICIAL_BROWSER_ASSISTED_SOURCE } from "./official-browser-assisted.server";
import { OPEN_WEB_CHINA_REGISTRY_LABEL, OPEN_WEB_CHINA_REGISTRY_PROVIDER, OPEN_WEB_CHINA_REGISTRY_SOURCE, runOpenWebChinaRegistryResolver } from "./open-web-china-registry.server";

export const CHINA_REGISTRY_SOURCE = "China registry provider";
export const QINCHECK_SOURCE = "QINCheck China registry";
export const PANDA360_SOURCE = "Panda360 China registry";

type ApiProviderName = "qincheck" | "panda360";
type ProviderName = ApiProviderName | typeof OFFICIAL_BROWSER_ASSISTED_PROVIDER | typeof OPEN_WEB_CHINA_REGISTRY_PROVIDER;
type ProviderPreference = ProviderName | "auto" | "disabled";

export interface ChinaRegistrySearchInput {
  statedName: string;
  chineseName: string | null;
  country: string;
  website: string | null;
  productCategory?: string | null;
  cityProvinceHint?: string | null;
  resolved: ResolvedEntity;
  extracted: ExtractedDoc[];
}

interface RegistryRecord {
  provider: ProviderName;
  sourceName: string;
  sourceUrl: string;
  raw: unknown;
  legalNameEn: string | null;
  legalNameLocal: string | null;
  uscc: string | null;
  registrationStatus: string | null;
  incorporationDate: string | null;
  registeredCapital: string | null;
  legalRepresentative: string | null;
  registeredAddress: string | null;
  businessScope: string | null;
  shareholders: string[];
  relatedCompanies: string[];
  litigation: string[];
  enforcement: string[];
  riskFlags: string[];
}

class AmbiguousRegistryMatchError extends Error {
  constructor(public rawResponse: unknown) {
    super("Multiple China registry matches were returned; none had enough matching fields to auto-select.");
  }
}

export interface ChinaRegistryResult {
  status: "success" | "not_configured" | "not_found" | "ambiguous" | "error" | "disabled" | "pending_admin";
  provider: ProviderName | null;
  sourceName: string;
  sourceUrl: string | null;
  retrievedAt: string;
  findings: Finding[];
  resolvedPatch: Partial<ResolvedEntity> | null;
  rawResponse: unknown | null;
  error?: string;
  evidenceCount: number;
  fieldsReturned: string[];
}

function providerPreference(env: Record<string, string | undefined>): ProviderPreference {
  const raw = (env.CHINA_REGISTRY_PROVIDER || "auto").trim().toLowerCase();
  if (raw === "qincheck") return "qincheck";
  if (raw === "panda360") return "panda360";
  if (raw === OPEN_WEB_CHINA_REGISTRY_PROVIDER || raw === "open_web") return OPEN_WEB_CHINA_REGISTRY_PROVIDER;
  if (raw === OFFICIAL_BROWSER_ASSISTED_PROVIDER) return OFFICIAL_BROWSER_ASSISTED_PROVIDER;
  if (raw === "disabled") return "disabled";
  return "auto";
}

function enabled(env: Record<string, string | undefined>): boolean {
  return String(env.CHINA_REGISTRY_ENABLED ?? "false").toLowerCase() === "true";
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function clean(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function values(raw: any, keys: string[]): unknown {
  for (const key of keys) {
    const path = key.split(".");
    let current = raw;
    for (const part of path) current = current?.[part];
    if (current !== undefined && current !== null && current !== "") return current;
  }
  return null;
}

function stringValue(raw: any, keys: string[]): string | null {
  return clean(values(raw, keys));
}

function arrayValue(raw: any, keys: string[]): string[] {
  const value = values(raw, keys);
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => {
      if (typeof item === "string") return item;
      return item?.name ?? item?.companyName ?? item?.shareholderName ?? item?.legalName ?? item?.title ?? JSON.stringify(item);
    })
    .map(clean)
    .filter((item): item is string => Boolean(item));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/co\.?,? ?ltd\.?|limited|company|inc\.?|corp\.?|有限公司|有限责任公司/g, "")
    .replace(/[\s.,'’“”"()（）-]+/g, "")
    .trim();
}

function extractUsccFromText(value: unknown): string | null {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.match(/[0-9A-Z]{18}/)?.[0] ?? null;
}

function submittedUscc(args: ChinaRegistrySearchInput): string | null {
  for (const doc of args.extracted) {
    const found = extractUsccFromText(doc.extracted_entities) ?? extractUsccFromText(doc.summary);
    if (found) return found;
  }
  return args.resolved.registration_number ?? null;
}

export function chinaRegistrySearchTerms(args: ChinaRegistrySearchInput): string[] {
  return [
    submittedUscc(args),
    args.resolved.legal_name_local,
    args.chineseName,
    args.statedName,
  ].map(clean).filter((item, index, all): item is string => Boolean(item) && all.indexOf(item) === index);
}

function enoughFieldsMatch(candidate: RegistryRecord, args: ChinaRegistrySearchInput): boolean {
  const uscc = submittedUscc(args);
  if (uscc && candidate.uscc === uscc) return true;
  const names = [args.resolved.legal_name_local, args.chineseName, args.statedName, args.resolved.legal_name_en]
    .map(normalize)
    .filter(Boolean);
  const candidateNames = [candidate.legalNameLocal, candidate.legalNameEn].map(normalize).filter(Boolean);
  if (candidateNames.some((name) => names.some((input) => name === input || name.includes(input) || input.includes(name)))) return true;
  const website = normalize(args.website);
  const address = normalize(candidate.registeredAddress);
  return Boolean(website && address && address.includes(website));
}

function normalizeRecord(provider: ProviderName, raw: any, sourceUrl: string): RegistryRecord {
  const root = raw?.data ?? raw?.company ?? raw?.result ?? raw?.report ?? raw;
  const sourceName = provider === "qincheck" ? QINCHECK_SOURCE : provider === "panda360" ? PANDA360_SOURCE : OPEN_WEB_CHINA_REGISTRY_SOURCE;
  return {
    provider,
    sourceName,
    sourceUrl,
    raw,
    legalNameEn: stringValue(root, ["legalNameEn", "legal_name_en", "englishName", "nameEn", "companyNameEn"]),
    legalNameLocal: stringValue(root, ["legalName", "legalNameCn", "legal_name_cn", "chineseName", "nameCn", "companyName", "name"]),
    uscc: stringValue(root, ["uscc", "unifiedSocialCreditCode", "creditCode", "registrationNumber", "registration_number"]) ?? extractUsccFromText(root),
    registrationStatus: stringValue(root, ["registrationStatus", "status", "regStatus", "companyStatus"]),
    incorporationDate: stringValue(root, ["incorporationDate", "registrationDate", "establishDate", "foundedDate", "startDate"]),
    registeredCapital: stringValue(root, ["registeredCapital", "regCapital", "capital"]),
    legalRepresentative: stringValue(root, ["legalRepresentative", "legalRep", "representative", "legalPerson"]),
    registeredAddress: stringValue(root, ["registeredAddress", "address", "regAddress"]),
    businessScope: stringValue(root, ["businessScope", "scope"]),
    shareholders: arrayValue(root, ["shareholders", "partners", "owners", "shareholderList"]),
    relatedCompanies: arrayValue(root, ["relatedCompanies", "affiliates", "branches", "subsidiaries"]),
    litigation: arrayValue(root, ["litigation", "courtRecords", "lawsuits", "cases"]),
    enforcement: arrayValue(root, ["enforcement", "administrativePenalties", "penalties", "dishonestDebtorRecords"]),
    riskFlags: arrayValue(root, ["riskFlags", "risks", "warnings"]),
  };
}

function fieldsReturned(record: RegistryRecord): string[] {
  const out: string[] = [];
  if (record.legalNameEn || record.legalNameLocal) out.push("legal_name");
  if (record.uscc) out.push("uscc");
  if (record.registrationStatus) out.push("registration_status");
  if (record.incorporationDate) out.push("incorporation_date");
  if (record.registeredCapital) out.push("registered_capital");
  if (record.legalRepresentative) out.push("legal_representative");
  if (record.registeredAddress) out.push("registered_address");
  if (record.businessScope) out.push("business_scope");
  if (record.shareholders.length) out.push("shareholders");
  if (record.relatedCompanies.length) out.push("related_companies");
  if (record.litigation.length) out.push("litigation");
  if (record.enforcement.length) out.push("enforcement");
  if (record.riskFlags.length) out.push("risk_flags");
  return out;
}

function finding(args: {
  item: string;
  section: Finding["section"];
  value: string | string[];
  source: RegistryRecord;
  retrievedAt: string;
  status?: Finding["status"];
  confidence?: FindingConfidence;
}): Finding {
  const text = Array.isArray(args.value) ? args.value.join("; ") : args.value;
  return {
    section: args.section,
    item: args.item,
    status: args.status ?? "PASS",
    confidence: args.confidence ?? "high",
    source_name: args.source.sourceName,
    source_url: args.source.sourceUrl,
    retrieval_date: args.retrievedAt,
    evidence_excerpt: `${args.item}: ${text}`,
    evidence_classification: "VERIFIED",
    buyer_impact: "This fact was retrieved from a configured China registry provider.",
    recommended_action: "Retain this registry evidence with the supplier file and re-check if supplier documents conflict.",
  };
}

function businessLicenceFinding(record: RegistryRecord, retrievedAt: string, extracted: ExtractedDoc[]): Finding | null {
  const rawDocs = extracted.map((doc) => `${doc.filename}\n${doc.summary}\n${JSON.stringify(doc.extracted_entities)}`).join("\n");
  if (!rawDocs || !record.uscc || !rawDocs.includes(record.uscc)) return null;
  return finding({
    item: "Business licence validation",
    section: "certificates_documents",
    value: `Uploaded business licence matches official registry USCC ${record.uscc}.`,
    source: record,
    retrievedAt,
  });
}

export function chinaRegistryRecordToFindings(record: RegistryRecord, retrievedAt: string, extracted: ExtractedDoc[] = []): Finding[] {
  const out: Array<Finding | null> = [
    record.legalNameEn || record.legalNameLocal ? finding({ item: "Legal company existence", section: "legal_entity", value: record.legalNameLocal || record.legalNameEn!, source: record, retrievedAt }) : null,
    record.legalNameLocal ? finding({ item: "Chinese legal name", section: "legal_entity", value: record.legalNameLocal, source: record, retrievedAt }) : null,
    record.uscc ? finding({ item: "Unified Social Credit Code", section: "legal_entity", value: record.uscc, source: record, retrievedAt }) : null,
    record.registrationStatus ? finding({ item: "Registration status", section: "legal_entity", value: record.registrationStatus, source: record, retrievedAt }) : null,
    record.incorporationDate ? finding({ item: "Incorporation date", section: "legal_entity", value: record.incorporationDate, source: record, retrievedAt }) : null,
    record.registeredCapital ? finding({ item: "Registered capital", section: "legal_entity", value: record.registeredCapital, source: record, retrievedAt }) : null,
    record.legalRepresentative ? finding({ item: "Legal representative", section: "legal_entity", value: record.legalRepresentative, source: record, retrievedAt }) : null,
    record.registeredAddress ? finding({ item: "Registered address", section: "legal_entity", value: record.registeredAddress, source: record, retrievedAt }) : null,
    record.businessScope ? finding({ item: "Business scope", section: "legal_entity", value: record.businessScope, source: record, retrievedAt }) : null,
    record.shareholders.length ? finding({ item: "Shareholders and beneficial ownership", section: "ownership", value: record.shareholders, source: record, retrievedAt }) : null,
    record.relatedCompanies.length ? finding({ item: "Related companies", section: "ownership", value: record.relatedCompanies, source: record, retrievedAt }) : null,
    record.litigation.length ? finding({ item: "Litigation and enforcement screening", section: "litigation_enforcement", value: record.litigation, source: record, retrievedAt, status: "CAUTION", confidence: "medium_high" }) : null,
    record.enforcement.length || record.riskFlags.length ? finding({ item: "Enforcement and administrative penalties", section: "litigation_enforcement", value: [...record.enforcement, ...record.riskFlags], source: record, retrievedAt, status: "CAUTION", confidence: "medium_high" }) : null,
    businessLicenceFinding(record, retrievedAt, extracted),
  ];
  return out.filter((item): item is Finding => Boolean(item));
}

function resolvedPatch(record: RegistryRecord): Partial<ResolvedEntity> {
  return {
    matched: true,
    legal_name_en: record.legalNameEn,
    legal_name_local: record.legalNameLocal,
    registration_number: record.uscc,
    registration_status: record.registrationStatus,
    registration_date: record.incorporationDate,
    registered_capital: record.registeredCapital,
    registered_address: record.registeredAddress,
    legal_representative: record.legalRepresentative,
    business_scope: record.businessScope,
    shareholders: record.shareholders,
    related_companies: record.relatedCompanies,
    confidence: "high",
    sources: [{ name: record.sourceName, url: record.sourceUrl }],
    notes: `Resolved using ${record.sourceName}.`,
  };
}

function result(status: ChinaRegistryResult["status"], args: Partial<ChinaRegistryResult>): ChinaRegistryResult {
  return {
    status,
    provider: args.provider ?? null,
    sourceName: args.sourceName ?? CHINA_REGISTRY_SOURCE,
    sourceUrl: args.sourceUrl ?? null,
    retrievedAt: args.retrievedAt ?? new Date().toISOString(),
    findings: args.findings ?? [],
    resolvedPatch: args.resolvedPatch ?? null,
    rawResponse: args.rawResponse ?? null,
    error: args.error,
    evidenceCount: args.findings?.length ?? 0,
    fieldsReturned: args.fieldsReturned ?? [],
  };
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000) });
  const body = await res.text();
  const raw = body ? JSON.parse(body) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  return raw;
}

async function runQincheck(term: string, apiKey: string): Promise<RegistryRecord> {
  const url = `https://qincheck.com/api/report?q=${encodeURIComponent(term)}`;
  const raw = await fetchJson(url, { "x-api-key": apiKey });
  return normalizeRecord("qincheck", raw, url);
}

async function runPanda360(term: string, apiKey: string, args: ChinaRegistrySearchInput): Promise<RegistryRecord> {
  const base = "https://www.chinacheckup.com";
  const searchUrl = `${base}/wp-json/chinacheckup/v1/search?search_terms=${encodeURIComponent(term)}`;
  const searchRaw: any = await fetchJson(searchUrl, { "X-API-Key": apiKey });
  const matches = Array.isArray(searchRaw?.results) ? searchRaw.results : Array.isArray(searchRaw) ? searchRaw : [];
  if (matches.length > 1) {
    const selectable = matches
      .map((candidate: unknown) => normalizeRecord("panda360", candidate, searchUrl))
      .filter((candidate: RegistryRecord) => enoughFieldsMatch(candidate, args));
    if (selectable.length !== 1) throw new AmbiguousRegistryMatchError(searchRaw);
    const uscc = selectable[0].uscc;
    if (!uscc) throw new AmbiguousRegistryMatchError(searchRaw);
    const fullUrl = `${base}/wp-json/chinacheckup/v1/getFull?uscc=${encodeURIComponent(uscc)}`;
    const fullRaw = await fetchJson(fullUrl, { "X-API-Key": apiKey });
    return normalizeRecord("panda360", fullRaw, fullUrl);
  }
  const first = matches[0] ?? searchRaw?.data?.[0] ?? searchRaw?.result ?? searchRaw;
  const uscc = stringValue(first, ["uscc", "unifiedSocialCreditCode", "creditCode"]) ?? extractUsccFromText(first);
  if (!uscc) return normalizeRecord("panda360", first, searchUrl);
  const fullUrl = `${base}/wp-json/chinacheckup/v1/getFull?uscc=${encodeURIComponent(uscc)}`;
  const fullRaw = await fetchJson(fullUrl, { "X-API-Key": apiKey });
  return normalizeRecord("panda360", fullRaw, fullUrl);
}

async function tryProvider(provider: ApiProviderName, args: ChinaRegistrySearchInput, env: Record<string, string | undefined>): Promise<ChinaRegistryResult> {
  const retrievedAt = new Date().toISOString();
  const key = provider === "qincheck" ? env.QINCHECK_API_KEY : env.PANDA360_API_KEY;
  if (!key) {
    return result("not_configured", {
      provider,
      sourceName: provider === "qincheck" ? QINCHECK_SOURCE : PANDA360_SOURCE,
      retrievedAt,
      error: `${provider === "qincheck" ? "QINCHECK_API_KEY" : "PANDA360_API_KEY"} is not configured.`,
    });
  }
  const terms = chinaRegistrySearchTerms(args);
  if (terms.length === 0) {
    return result("not_configured", { provider, retrievedAt, error: "No usable company name or USCC was supplied." });
  }
  try {
    const records: RegistryRecord[] = [];
    for (const term of terms) {
      const record = provider === "qincheck" ? await runQincheck(term, key) : await runPanda360(term, key, args);
      records.push(record);
      if (enoughFieldsMatch(record, args)) {
        const findings = chinaRegistryRecordToFindings(record, retrievedAt, args.extracted);
        return result("success", {
          provider,
          sourceName: record.sourceName,
          sourceUrl: record.sourceUrl,
          retrievedAt,
          findings,
          resolvedPatch: resolvedPatch(record),
          rawResponse: record.raw,
          fieldsReturned: fieldsReturned(record),
        });
      }
    }
    if (records.length > 0) {
      return result(records.length > 1 ? "ambiguous" : "not_found", {
        provider,
        sourceName: provider === "qincheck" ? QINCHECK_SOURCE : PANDA360_SOURCE,
        sourceUrl: records[0]?.sourceUrl ?? null,
        retrievedAt,
        rawResponse: records.map((record) => record.raw),
        error: records.length > 1 ? "Multiple or weak China registry matches were returned; none had enough matching fields to auto-select." : "No sufficiently matching registry record found.",
      });
    }
    return result("not_found", {
      provider,
      sourceName: provider === "qincheck" ? QINCHECK_SOURCE : PANDA360_SOURCE,
      retrievedAt,
      error: "No registry record was returned.",
    });
  } catch (error) {
    if (error instanceof AmbiguousRegistryMatchError) {
      return result("ambiguous", {
        provider,
        sourceName: provider === "qincheck" ? QINCHECK_SOURCE : PANDA360_SOURCE,
        retrievedAt,
        rawResponse: error.rawResponse,
        error: error.message,
      });
    }
    return result("error", {
      provider,
      sourceName: provider === "qincheck" ? QINCHECK_SOURCE : PANDA360_SOURCE,
      retrievedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function retrieveChinaRegistryEvidence(
  args: ChinaRegistrySearchInput,
  env: Record<string, string | undefined> = process.env,
): Promise<ChinaRegistryResult> {
  if (!enabled(env)) return result("disabled", { error: "CHINA_REGISTRY_ENABLED is not true." });
  const preference = providerPreference(env);
  if (preference === "disabled") return result("disabled", { error: "CHINA_REGISTRY_PROVIDER is disabled." });
  if (preference === OFFICIAL_BROWSER_ASSISTED_PROVIDER) {
    return result("pending_admin", {
      provider: OFFICIAL_BROWSER_ASSISTED_PROVIDER,
      sourceName: OFFICIAL_BROWSER_ASSISTED_SOURCE,
      error: "Official browser-assisted registry verification requires analyst completion.",
    });
  }
  if (preference === OPEN_WEB_CHINA_REGISTRY_PROVIDER) {
    const openWeb = await runOpenWebChinaRegistryResolver(args, { env });
    return result(openWeb.status === "conflict" ? "success" : openWeb.status, {
      provider: OPEN_WEB_CHINA_REGISTRY_PROVIDER,
      sourceName: OPEN_WEB_CHINA_REGISTRY_SOURCE,
      sourceUrl: openWeb.findings[0]?.source_url ?? null,
      findings: openWeb.findings,
      resolvedPatch: openWeb.resolvedPatch,
      rawResponse: openWeb.rawResponse,
      fieldsReturned: openWeb.fieldsReturned,
      error: openWeb.error,
    });
  }
  const order: ApiProviderName[] = preference === "auto" ? ["qincheck", "panda360"] : [preference];
  let last: ChinaRegistryResult | null = null;
  const attempted: ChinaRegistryResult[] = [];
  for (const provider of order) {
    const current = await tryProvider(provider, args, env);
    if (current.status === "success") return current;
    attempted.push(current);
    last = current;
    if (preference !== "auto") break;
  }
  if (preference === "auto" && attempted.every((current) => current.status === "not_configured")) {
    const openWeb = await runOpenWebChinaRegistryResolver(args, { env });
    if (openWeb.status === "success" || openWeb.status === "conflict") {
      return result("success", {
        provider: OPEN_WEB_CHINA_REGISTRY_PROVIDER,
        sourceName: OPEN_WEB_CHINA_REGISTRY_SOURCE,
        sourceUrl: openWeb.findings[0]?.source_url ?? null,
        findings: openWeb.findings,
        resolvedPatch: openWeb.resolvedPatch,
        rawResponse: openWeb.rawResponse,
        fieldsReturned: openWeb.fieldsReturned,
        error: openWeb.status === "conflict" ? "Conflicting open-web registry evidence was found; checklist items are marked CAUTION where applicable." : undefined,
      });
    }
    return result("pending_admin", {
      provider: OFFICIAL_BROWSER_ASSISTED_PROVIDER,
      sourceName: OFFICIAL_BROWSER_ASSISTED_SOURCE,
      error: openWeb.error
        ? `QINCheck and Panda360 are not configured. ${openWeb.error} Official browser-assisted verification task is required.`
        : "QINCheck and Panda360 are not configured. Official browser-assisted verification task is required.",
      rawResponse: { open_web_registry: { status: openWeb.status, diagnostics: openWeb.diagnostics, note: OPEN_WEB_CHINA_REGISTRY_LABEL } },
    });
  }
  return last ?? result("not_configured", { error: "No China registry provider is configured." });
}
