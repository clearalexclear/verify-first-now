import type { Finding } from "../types";
import { isUnreliableChineseExtraction, UFLPA_LOCAL_NAME_UNCERTAIN } from "../report-sanitizer";

const SOURCE_KEY = "dhs_uflpa";
const SOURCE_URL = "https://www.dhs.gov/uflpa-entity-list";

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/co\.?,? ?ltd\.?/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function refreshUflpaSnapshot() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`DHS UFLPA refresh failed: ${res.status}`);
  const html = await res.text();
  const checksum = await sha256Hex(html);
  const names = Array.from(html.matchAll(/>([^<>]{4,160}(?:Co\.|Corporation|Group|Ltd\.|Limited|Company|LLC)[^<>]*)</gi))
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((name, idx, arr) => name && arr.indexOf(name) === idx)
    .slice(0, 500);
  const snapshotVersion = new Date().toISOString().slice(0, 10);

  await db.from("source_snapshots").upsert({
    source_key: SOURCE_KEY,
    source_url: SOURCE_URL,
    snapshot_version: snapshotVersion,
    publication_date: snapshotVersion,
    retrieval_date: new Date().toISOString(),
    checksum,
    last_successful_refresh: new Date().toISOString(),
    payload: { entities: names, extraction_method: "html_name_pattern" },
  }, { onConflict: "source_key,snapshot_version,checksum" });

  return { snapshotVersion, checksum, entityCount: names.length };
}

async function latestSnapshot(): Promise<{ entities: string[]; snapshotVersion: string; retrievalDate: string; checksum: string } | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .from("source_snapshots")
    .select("snapshot_version, retrieval_date, checksum, payload")
    .eq("source_key", SOURCE_KEY)
    .order("retrieval_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    entities: Array.isArray(data.payload?.entities) ? data.payload.entities : [],
    snapshotVersion: data.snapshot_version,
    retrievalDate: data.retrieval_date,
    checksum: data.checksum,
  };
}

export async function screenUflpa(args: {
  statedName: string;
  resolvedNameEn?: string | null;
  resolvedNameLocal?: string | null;
  aliases?: string[];
  entityResolved?: boolean;
  destinationMarket: string;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const isUsBound = /united states|usa|u\.s\.a?\.|^us$/i.test(args.destinationMarket);
  const resolvedNameLocal = isUnreliableChineseExtraction(args.resolvedNameLocal) ? null : args.resolvedNameLocal;
  const candidates = Array.from(new Set([
    args.statedName,
    args.resolvedNameEn ?? "",
    resolvedNameLocal ?? "",
    ...(args.aliases ?? []),
  ].filter((n) => n && n.trim().length)));
  if (candidates.length === 0) return [];

  const snapshot = await latestSnapshot();
  const baseFinding = (
    status: Finding["status"],
    confidence: Finding["confidence"],
    evidence: string,
    impact: string,
    action: string,
    classification: Finding["evidence_classification"] = status === "NOT_APPLICABLE" ? "NOT_INDEPENDENTLY_VERIFIED" : "VERIFIED",
  ): Finding => ({
    section: "sanctions_forced_labour",
    item: "UFLPA (Uyghur Forced Labor Prevention Act) Entity List screening",
    status,
    confidence,
    source_name: snapshot ? `DHS UFLPA Entity List snapshot ${snapshot.snapshotVersion}` : "DHS UFLPA Entity List",
    source_url: SOURCE_URL,
    retrieval_date: snapshot?.retrievalDate ?? now,
    evidence_excerpt: evidence,
    evidence_ids: [],
    evidence_classification: classification,
    buyer_impact: impact,
    recommended_action: action,
  });

  if (!isUsBound) {
    return [baseFinding(
      "NOT_APPLICABLE",
      "high",
      `Destination market is ${args.destinationMarket || "not the United States"}; UFLPA screening is informational only.`,
      "UFLPA applies to imports into the United States.",
      "If shipments may later enter the US, re-run this check before the change.",
    )];
  }

  if (!snapshot || snapshot.entities.length === 0) {
    return [baseFinding(
      "NOT_VERIFIED",
      "low",
      "",
      "No current DHS UFLPA snapshot is stored. A missing snapshot cannot be treated as a pass.",
      "Run the UFLPA refresh process and re-screen before US-bound shipment.",
      "NOT_INDEPENDENTLY_VERIFIED",
    )];
  }

  // Score every candidate name against every listed entity.
  let best = { score: 0, entity: "", target: "" };
  for (const name of candidates) {
    const target = norm(name);
    if (!target) continue;
    for (const e of snapshot.entities) {
      const score = dice(target, norm(e));
      if (score > best.score) best = { score, entity: e, target: name };
    }
  }

  if (best.score >= 0.9) {
    return [baseFinding(
      "FAIL",
      "high",
      `Strong name match (${best.score.toFixed(2)}) between "${best.target}" and listed entity: "${best.entity}". Snapshot ${snapshot.snapshotVersion}, checksum ${snapshot.checksum}.`,
      "Goods produced wholly or in part by this entity carry a rebuttable presumption of forced-labour use; CBP can detain or exclude the shipment.",
      "Do not proceed without specific UFLPA-compliant documentation reviewed by trade counsel.",
    )];
  }
  if (best.score >= 0.75) {
    return [baseFinding(
      "CAUTION",
      "medium_high",
      `Partial name similarity (${best.score.toFixed(2)}) between "${best.target}" and listed entity: "${best.entity}". Snapshot ${snapshot.snapshotVersion}, checksum ${snapshot.checksum}.`,
      "Potential UFLPA exposure; ambiguity in the legal-entity identity must be resolved before US-bound shipment.",
      "Confirm exact registered legal name, registration number, and registered address; re-run this check.",
    )];
  }

  // No name match. If the legal entity is NOT resolved, we cannot treat this as a pass;
  // aliases and the official legal name were not screened.
  if (!args.entityResolved) {
    return [baseFinding(
      "NOT_VERIFIED",
      "low",
      `No match found for the submitted name in the stored DHS UFLPA snapshot (${snapshot.entities.length} entries, version ${snapshot.snapshotVersion}). The supplier's verified Chinese legal name, verified English name and known aliases were not screened because the legal entity could not be resolved.`,
      "Cannot be treated as a UFLPA pass until the legal entity is verified and screened by all names and aliases.",
      "Resolve the official Chinese legal name (统一社会信用代码) and English legal name via QCC or the State Administration for Market Regulation, then re-run UFLPA screening against all names and known aliases.",
      "NOT_INDEPENDENTLY_VERIFIED",
    )];
  }

  return [baseFinding(
    "PASS",
    "medium_high",
    `No name match to stored DHS UFLPA snapshot for verified names (English: "${args.resolvedNameEn ?? "n/a"}"; ${resolvedNameLocal ? `local: "${resolvedNameLocal}"` : UFLPA_LOCAL_NAME_UNCERTAIN}; aliases: ${(args.aliases ?? []).join("; ") || "none"}). Snapshot ${snapshot.snapshotVersion}, ${snapshot.entities.length} entries, checksum ${snapshot.checksum}.`,
    "No listed-entity name match identified in the stored official snapshot after screening the verified legal names.",
    "For high-risk sectors or Xinjiang-linked supply chains, request supply-chain mapping regardless of name-screening result.",
  )];
}
