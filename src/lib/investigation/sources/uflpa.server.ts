// UFLPA Entity List screening. Uses a bundled snapshot to avoid runtime
// dependence on dhs.gov; refresh by overwriting src/lib/risk-data/uflpa.json.

import type { Finding } from "../types";
import uflpa from "@/lib/risk-data/uflpa.json";

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

export async function screenUflpa(args: {
  name: string;
  destinationMarket: string;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const isUsBound = /united states|usa|u\.s\.a?\.|^us$/i.test(args.destinationMarket);
  const target = norm(args.name);
  if (!target) return [];

  let best = { score: 0, entity: "" };
  for (const e of uflpa.entities as string[]) {
    const score = dice(target, norm(e));
    if (score > best.score) best = { score, entity: e };
  }

  const baseFinding = (status: Finding["status"], confidence: Finding["confidence"], evidence: string, impact: string, action: string): Finding => ({
    section: "sanctions_forced_labour",
    item: "UFLPA (Uyghur Forced Labor Prevention Act) Entity List screening",
    status,
    confidence,
    source_name: `UFLPA Entity List snapshot ${uflpa.snapshot_date}`,
    source_url: "https://www.dhs.gov/uflpa-entity-list",
    retrieval_date: now,
    evidence_excerpt: evidence,
    buyer_impact: impact,
    recommended_action: action,
  });

  if (!isUsBound) {
    return [baseFinding(
      "NOT_APPLICABLE",
      "high",
      `Destination market is ${args.destinationMarket || "not the United States"} — UFLPA screening is informational only.`,
      "UFLPA applies only to imports into the United States.",
      "If shipments may later transit through the US, re-run this check before the change.",
    )];
  }

  if (best.score >= 0.9) {
    return [baseFinding(
      "FAIL",
      "high",
      `Strong name match (${best.score.toFixed(2)}) to listed entity: "${best.entity}".`,
      "Goods produced wholly or in part by this entity carry a rebuttable presumption of forced-labour use; CBP can detain or exclude the shipment.",
      "Do not proceed without specific UFLPA-compliant documentation showing the goods are unrelated to this entity, reviewed by trade counsel.",
    )];
  }
  if (best.score >= 0.75) {
    return [baseFinding(
      "CAUTION",
      "medium_high",
      `Partial name similarity (${best.score.toFixed(2)}) to listed entity: "${best.entity}". Identity may differ.`,
      "Potential UFLPA exposure; ambiguity in the legal-entity identity must be resolved before US-bound shipment.",
      "Confirm the supplier's exact registered legal name, USCI/registration number, and registered address; re-run this check.",
    )];
  }
  return [baseFinding(
    "PASS",
    "medium_high",
    `No name match to the UFLPA Entity List snapshot (${(uflpa.entities as string[]).length} entries, ${uflpa.snapshot_date}).`,
    "No known UFLPA-listed parent or supplier identified for this name.",
    "UFLPA enforcement extends beyond listed names; for cotton, polysilicon, tomatoes and aluminium from Xinjiang request supply-chain mapping evidence regardless.",
  )];
}
