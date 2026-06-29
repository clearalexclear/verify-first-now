// Adverse media + litigation/enforcement screening via Firecrawl web search.
// Best-effort; classifies hits via the LLM. Returns CAUTION/PASS plus the
// excerpts/URLs that drove the decision so the report stays sourced.

import { aiJson } from "../ai.server";
import { fcSearch } from "../firecrawl.server";
import type { Finding } from "../types";

const ADVERSE_TERMS = [
  "fraud",
  "scam",
  "complaint",
  "lawsuit",
  "blacklist",
  "investigation",
  "counterfeit",
  "labor violation",
];

interface ClassifyOut {
  status: "PASS" | "CAUTION" | "FAIL" | "NOT_VERIFIED";
  confidence: "high" | "medium_high" | "medium" | "low";
  evidence_excerpt: string;
  buyer_impact: string;
  recommended_action: string;
}

export async function screenAdverseMedia(args: {
  name: string;
  chineseName: string | null;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const queries = [
    `"${args.name}" (${ADVERSE_TERMS.map((t) => `"${t}"`).join(" OR ")})`,
    args.chineseName ? `"${args.chineseName}" 投诉 OR 诈骗 OR 黑名单` : null,
  ].filter(Boolean) as string[];

  const allHits: { url: string; title: string; description: string }[] = [];
  for (const q of queries) {
    const hits = await fcSearch(q, { limit: 5, tbs: "qdr:y" });
    for (const h of hits) {
      allHits.push({ url: h.url, title: h.title ?? "", description: h.description ?? "" });
    }
  }

  if (allHits.length === 0) {
    return [{
      section: "digital_footprint",
      item: "Adverse media screening",
      status: "PASS",
      confidence: "medium",
      source_name: "Public web search (Firecrawl)",
      source_url: null,
      retrieval_date: now,
      evidence_excerpt: `Searched ${queries.length} adverse-media queries against the public web; no relevant results within the past 12 months.`,
      buyer_impact: "No public adverse media indicators within search scope.",
      recommended_action: "Re-screen quarterly or before next purchase order.",
    }];
  }

  let classification: ClassifyOut;
  try {
    classification = await aiJson<ClassifyOut>(
      [
        {
          role: "system",
          content:
            "You triage adverse-media search results about a Chinese/Vietnamese supplier. " +
            "Return ONLY JSON. Mark CAUTION only if the hits credibly describe wrongdoing by THIS exact entity " +
            "(not a similarly-named one). Mark PASS otherwise. Quote the strongest sentence from the snippets in evidence_excerpt. " +
            "Never invent details that aren't in the snippets.",
        },
        {
          role: "user",
          content:
            `Supplier: ${args.name}${args.chineseName ? ` (${args.chineseName})` : ""}\n\nHits:\n` +
            allHits
              .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.description}`)
              .join("\n\n") +
            "\n\nRespond as JSON: " +
            `{"status":"PASS|CAUTION|FAIL|NOT_VERIFIED","confidence":"high|medium_high|medium|low",` +
            `"evidence_excerpt":"","buyer_impact":"","recommended_action":""}`,
        },
      ],
      { model: "google/gemini-3-flash-preview" },
    );
  } catch (e) {
    classification = {
      status: "NOT_VERIFIED",
      confidence: "low",
      evidence_excerpt: "",
      buyer_impact: `Adverse-media classification failed: ${(e as Error).message}`,
      recommended_action: "Re-run adverse-media screening before payment.",
    };
  }

  return [{
    section: "digital_footprint",
    item: "Adverse media screening",
    status: classification.status,
    confidence: classification.confidence,
    source_name: "Public web search (Firecrawl) — top adverse-media hits",
    source_url: allHits[0]?.url ?? null,
    retrieval_date: now,
    evidence_excerpt: classification.evidence_excerpt || "",
    buyer_impact: classification.buyer_impact,
    recommended_action: classification.recommended_action,
  }];
}

export async function screenLitigation(args: {
  name: string;
  chineseName: string | null;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const queries = [
    `"${args.name}" (lawsuit OR judgment OR enforcement OR penalty)`,
    args.chineseName
      ? `site:wenshu.court.gov.cn OR site:credit.org.cn "${args.chineseName}"`
      : null,
  ].filter(Boolean) as string[];

  const hits: { url: string; title: string; description: string }[] = [];
  for (const q of queries) {
    const r = await fcSearch(q, { limit: 5 });
    for (const h of r) hits.push({ url: h.url, title: h.title ?? "", description: h.description ?? "" });
  }

  if (hits.length === 0) {
    return [{
      section: "litigation_enforcement",
      item: "Litigation and enforcement screening",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "Public web search (Firecrawl)",
      source_url: null,
      retrieval_date: now,
      evidence_excerpt: "",
      buyer_impact:
        "Coverage of Chinese court judgments and enforcement is limited via public search; absence of hits does not mean no record exists.",
      recommended_action:
        "If the order value warrants it, commission a litigation search via a Chinese commercial-records provider (e.g. Qichacha, Tianyancha).",
    }];
  }

  let cls: ClassifyOut;
  try {
    cls = await aiJson<ClassifyOut>(
      [
        {
          role: "system",
          content:
            "Classify whether the following search hits show genuine litigation or enforcement action against the named entity. " +
            "Return ONLY JSON. Be conservative — mark NOT_VERIFIED unless the snippet clearly references the same entity.",
        },
        {
          role: "user",
          content:
            `Entity: ${args.name}${args.chineseName ? ` (${args.chineseName})` : ""}\n\n` +
            hits.map((h, i) => `${i + 1}. ${h.title}\n${h.url}\n${h.description}`).join("\n\n") +
            "\n\nJSON: {status,confidence,evidence_excerpt,buyer_impact,recommended_action}",
        },
      ],
      { model: "google/gemini-3-flash-preview" },
    );
  } catch {
    cls = {
      status: "NOT_VERIFIED",
      confidence: "low",
      evidence_excerpt: "",
      buyer_impact: "Litigation classification failed.",
      recommended_action: "Re-screen manually.",
    };
  }

  return [{
    section: "litigation_enforcement",
    item: "Litigation and enforcement screening",
    status: cls.status,
    confidence: cls.confidence,
    source_name: "Public web search (Firecrawl) — court / enforcement results",
    source_url: hits[0]?.url ?? null,
    retrieval_date: now,
    evidence_excerpt: cls.evidence_excerpt,
    buyer_impact: cls.buyer_impact,
    recommended_action: cls.recommended_action,
  }];
}
