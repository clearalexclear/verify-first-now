import type { Finding } from "../types";

export async function screenSanctions(args: {
  name: string;
  country: string;
}): Promise<Finding[]> {
  const now = new Date().toISOString();
  const apiKey = process.env.OPENSANCTIONS_API_KEY;

  if (!apiKey) {
    return [{
      section: "sanctions_forced_labour",
      item: "Sanctions and restricted-party screening (OpenSanctions commercial)",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "OpenSanctions Commercial API",
      source_url: "https://www.opensanctions.org/",
      retrieval_date: now,
      evidence_excerpt: "",
      evidence_ids: [],
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      buyer_impact: "OpenSanctions is treated as a credentialed commercial connector and is not configured for this environment.",
      recommended_action: "Supply licensed OpenSanctions API credentials or complete restricted-party screening manually before relying on this finding.",
    }];
  }

  try {
    const res = await fetch("https://api.opensanctions.org/match/sanctions?algorithm=name-based", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${apiKey}` },
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
        item: "Sanctions and restricted-party screening (OpenSanctions commercial)",
        status: "NOT_VERIFIED",
        confidence: "low",
        source_name: "OpenSanctions Commercial API",
        source_url: "https://www.opensanctions.org/",
        retrieval_date: now,
        evidence_excerpt: "",
        evidence_ids: [],
        evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
        buyer_impact: "Sanctions check could not be completed automatically.",
        recommended_action: "Re-run screening with valid credentials or request a manual sanctions report before payment.",
      }];
    }
    const data = await res.json() as any;
    const results = data.responses?.q1?.results ?? [];
    const matches = results.filter((r: any) => r.match || (r.score ?? 0) >= 0.85);
    if (matches.length === 0) {
      return [{
        section: "sanctions_forced_labour",
        item: "Sanctions and restricted-party screening (OpenSanctions commercial)",
        status: "PASS",
        confidence: "medium_high",
        source_name: "OpenSanctions Commercial API",
        source_url: "https://www.opensanctions.org/datasets/sanctions/",
        retrieval_date: now,
        evidence_excerpt: `No high-confidence match for "${args.name}" (country: ${args.country}) in the configured OpenSanctions commercial screening response.`,
        evidence_ids: [],
        evidence_classification: "VERIFIED",
        buyer_impact: "No sanctions exposure identified from this configured dataset response.",
        recommended_action: "Re-screen at any change of legal entity or beneficial owner.",
      }];
    }
    return matches.slice(0, 5).map((m: any) => ({
      section: "sanctions_forced_labour" as const,
      item: `Sanctions match: ${m.caption ?? m.id}`,
      status: "FAIL" as const,
      confidence: "high" as const,
      source_name: "OpenSanctions Commercial API",
      source_url: `https://www.opensanctions.org/entities/${m.id}/`,
      retrieval_date: now,
      evidence_excerpt:
        `OpenSanctions match score ${(m.score ?? 0).toFixed(2)}; datasets: ${(m.datasets ?? []).join(", ")}.`,
      evidence_ids: [],
      evidence_classification: "VERIFIED" as const,
      buyer_impact:
        "Direct or near-identity match on a sanctions / restricted-party list. Doing business may be prohibited.",
      recommended_action:
        "Do not pay. Escalate to legal/compliance for a formal sanctions determination on the matched record.",
    }));
  } catch (e) {
    return [{
      section: "sanctions_forced_labour",
      item: "Sanctions and restricted-party screening (OpenSanctions commercial)",
      status: "NOT_VERIFIED",
      confidence: "low",
      source_name: "OpenSanctions Commercial API",
      source_url: "https://www.opensanctions.org/",
      retrieval_date: now,
      evidence_excerpt: "",
      evidence_ids: [],
      evidence_classification: "NOT_INDEPENDENTLY_VERIFIED",
      buyer_impact: `Network or service error during sanctions screening: ${(e as Error).message}.`,
      recommended_action: "Re-run screening manually before payment.",
    }];
  }
}
