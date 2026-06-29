// Resolve the supplier's likely registered legal entity. Uses Firecrawl to
// search Chinese and Vietnamese registry mirrors plus the supplier's own
// website, then asks the LLM to propose a best-match candidate.

import { aiJson } from "../ai.server";
import { fcSearch, fcScrape } from "../firecrawl.server";
import type { ResolvedEntity } from "../types";
import type { ExtractedDoc } from "../extract-documents.server";

export async function resolveLegalEntity(args: {
  statedName: string;
  chineseName: string | null;
  country: string;
  website: string;
  extracted: ExtractedDoc[];
}): Promise<{ entity: ResolvedEntity; sources: { name: string; url: string | null }[] }> {
  const sources: { name: string; url: string | null }[] = [];
  const corpus: string[] = [];

  // 1) Pull the supplier's own website footer/about page.
  if (args.website) {
    const scraped = await fcScrape(args.website, { formats: ["markdown", "links"] });
    if (scraped) {
      corpus.push(`# Supplier website (${args.website})\n${scraped.markdown.slice(0, 4_000)}`);
      sources.push({ name: `Supplier website: ${scraped.title || args.website}`, url: scraped.sourceURL });
    }
  }

  // 2) Search registry mirrors.
  const queries = [
    args.chineseName
      ? `${args.chineseName} 统一社会信用代码`
      : `${args.statedName} ${args.country} registered company`,
    args.chineseName ? `site:qcc.com ${args.chineseName}` : null,
    args.chineseName ? `site:tianyancha.com ${args.chineseName}` : null,
    args.country.toLowerCase().includes("vietnam") ? `site:dichvuthongtin.dkkd.gov.vn ${args.statedName}` : null,
  ].filter(Boolean) as string[];

  for (const q of queries) {
    const hits = await fcSearch(q, { limit: 4 });
    for (const h of hits) {
      corpus.push(`# Search hit: ${h.title}\n${h.url}\n${h.description ?? ""}`);
      sources.push({ name: h.title ?? "Registry search hit", url: h.url });
    }
  }

  // 3) Include extracted document facts.
  for (const doc of args.extracted) {
    corpus.push(
      `# Customer-supplied document (${doc.filename}, ${doc.category ?? "uncategorised"})\n` +
        JSON.stringify(doc.extracted_entities) +
        `\nSummary: ${doc.summary}`,
    );
  }

  const emptyEntity: ResolvedEntity = {
    matched: false,
    legal_name_en: null,
    legal_name_local: null,
    registration_number: null,
    registration_country: args.country,
    registration_status: null,
    registration_date: null,
    registered_capital: null,
    registered_address: null,
    legal_representative: null,
    business_scope: null,
    shareholders: [],
    related_companies: [],
    manufacturer_indicators: [],
    trading_indicators: [],
    confidence: "low",
    sources,
    notes: "",
  };

  if (corpus.length === 0) {
    return {
      entity: { ...emptyEntity, notes: "No corporate-registry sources were reachable during this run." },
      sources,
    };
  }

  try {
    const parsed = await aiJson<Omit<ResolvedEntity, "sources" | "registration_country">>(
      [
        {
          role: "system",
          content:
            "You resolve a Chinese or Vietnamese supplier's likely registered legal entity from a corpus of " +
            "web snippets and customer-supplied documents. CRITICAL: never invent USCI codes, registration " +
            "numbers, addresses, or representative names. If the corpus does not state a fact, leave it null. " +
            "Use null, not 'unknown'. Only set matched=true if at least two independent sources agree on the " +
            "legal name OR a customer document states the registered name and a search hit confirms it.",
        },
        {
          role: "user",
          content:
            `Stated supplier: "${args.statedName}"` +
            (args.chineseName ? ` (Chinese: "${args.chineseName}")` : "") +
            `\nCountry: ${args.country}\nWebsite: ${args.website}\n\nCorpus (truncated):\n\n${corpus
              .join("\n\n---\n\n")
              .slice(0, 14_000)}\n\n` +
            `Return ONLY this JSON shape:\n` +
            `{"matched":false,"legal_name_en":null,"legal_name_local":null,"registration_number":null,` +
            `"registration_status":null,"registration_date":null,"registered_capital":null,` +
            `"registered_address":null,"legal_representative":null,"business_scope":null,` +
            `"shareholders":[],"related_companies":[],"manufacturer_indicators":[],"trading_indicators":[],` +
            `"confidence":"low","notes":""}`,
        },
      ],
      { model: "google/gemini-2.5-flash" },
    );
    return {
      entity: { ...emptyEntity, ...parsed, registration_country: args.country, sources },
      sources,
    };
  } catch (e) {
    return {
      entity: { ...emptyEntity, notes: `Entity resolution failed: ${(e as Error).message}` },
      sources,
    };
  }
}
