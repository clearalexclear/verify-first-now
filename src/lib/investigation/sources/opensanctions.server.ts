// OpenSanctions free /match API. Returns sanctioned-party hits for an entity.
// No API key required for the public endpoint at modest volume.
// Docs: https://www.opensanctions.org/api/

import type { Finding } from "../types";

interface MatchResponse {
  responses?: Record<
    string,
    {
      results?: Array<{
        id: string;
        caption?: string;
        score?: number;
        match?: boolean;
        datasets?: string[];
        properties?: Record<string, unknown>;
      }>;
    }
  >;
}

export async function screenSanctions(args: {
  name: string;
  country: string;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  try {
    const res = await fetch("https://api.opensanctions.org/match/sanctions?algorithm=name-based", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: {
          q1: {
            schema: "Company",
            properties: { name: [args.name], country: [args.country] },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return [{
        section: "sanctions_forced_labour",
        item: "Sanctions and restricted-party screening (OpenSanctions consolidated)",
        status: "NOT_VERIFIED",
        confidence: "low",
        source_name: "OpenSanctions",
        source_url: "https://www.opensanctions.org/",
        retrieval_date: now,
        evidence_excerpt: "",
        buyer_impact: "Sanctions check could not be completed automatically.",
        recommended_action: "Re-run screening or request a manual sanctions report before payment.",
      }];
    }
    const data = (await res.json()) as MatchResponse;
    const results = data.responses?.q1?.results ?? [];
    const matches = results.filter((r) => r.match || (r.score ?? 0) >= 0.85);
    if (matches.length === 0) {
      return [{
        section: "sanctions_forced_labour",
        item: "Sanctions and restricted-party screening (OpenSanctions consolidated)",
        status: "PASS",
        confidence: "medium_high",
        source_name: "OpenSanctions consolidated sanctions dataset",
        source_url: "https://www.opensanctions.org/datasets/sanctions/",
        retrieval_date: now,
        evidence_excerpt: `No high-confidence match for "${args.name}" (country: ${args.country}) across OpenSanctions consolidated sanctions, PEPs and watchlists.`,
        buyer_impact: "No sanctions exposure identified from this dataset.",
        recommended_action: "Re-screen at any change of legal entity or beneficial owner.",
      }];
    }
    return matches.slice(0, 5).map((m) => ({
      section: "sanctions_forced_labour" as const,
      item: `Sanctions match: ${m.caption ?? m.id}`,
      status: "FAIL" as const,
      confidence: "high" as const,
      source_name: "OpenSanctions",
      source_url: `https://www.opensanctions.org/entities/${m.id}/`,
      retrieval_date: now,
      evidence_excerpt:
        `OpenSanctions match score ${(m.score ?? 0).toFixed(2)}; datasets: ${(m.datasets ?? []).join(", ")}.`,
      buyer_impact:
        "Direct or near-identity match on a sanctions / restricted-party list. Doing business may be prohibited.",
      recommended_action:
        "DO NOT pay. Escalate to legal/compliance for a formal sanctions determination on the matched record.",
    }));
  } catch (e) {
    return [{
      section: "sanctions_forced_labour",
      item: "Sanctions and restricted-party screening (OpenSanctions consolidated)",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "OpenSanctions",
      source_url: "https://www.opensanctions.org/",
      retrieval_date: now,
      evidence_excerpt: "",
      buyer_impact: `Network or service error during sanctions screening: ${(e as Error).message}.`,
      recommended_action: "Re-run screening manually before payment.",
    }];
  }
}
