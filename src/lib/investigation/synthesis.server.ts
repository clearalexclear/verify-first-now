// Risk synthesis. Deterministic outcome calculation + an LLM call for
// executive prose. The model is never given license to choose the outcome.

import { aiJson } from "./ai.server";
import type {
  FinalOutcome,
  Finding,
  InvestigationReport,
  ResolvedEntity,
} from "./types";

export function computeOutcome(findings: Finding[]): {
  overall: "low" | "medium" | "high" | "critical";
  outcome: FinalOutcome;
} {
  const fail = findings.filter((f) => f.status === "FAIL").length;
  const caution = findings.filter((f) => f.status === "CAUTION").length;
  const notVerified = findings.filter((f) => f.status === "NOT_VERIFIED").length;

  if (fail > 0) return { overall: "critical", outcome: "NO_GO" };
  if (caution >= 3) return { overall: "high", outcome: "PAUSE_PENDING_CLARIFICATION" };
  if (caution >= 1) return { overall: "medium", outcome: "PROCEED_WITH_SAFEGUARDS" };
  if (notVerified >= 5) return { overall: "medium", outcome: "PROCEED_WITH_SAFEGUARDS" };
  return { overall: "low", outcome: "GO" };
}

interface Synth {
  executive_summary: string;
  key_findings: string[];
  buyer_implications: string;
  recommended_safeguards: string;
  payment_recommendation: string;
  inspection_recommendation: string;
  testing_recommendation: string;
}

export async function synthesiseNarrative(args: {
  supplier: InvestigationReport["supplier_input"];
  customer: InvestigationReport["customer_input"];
  resolved: ResolvedEntity;
  findings: Finding[];
  overall: ReturnType<typeof computeOutcome>;
}): Promise<Synth> {
  const blank: Synth = {
    executive_summary: "",
    key_findings: [],
    buyer_implications: "",
    recommended_safeguards: "",
    payment_recommendation: "",
    inspection_recommendation: "",
    testing_recommendation: "",
  };
  try {
    const out = await aiJson<Synth>(
      [
        {
          role: "system",
          content:
            "You write executive prose for an independent supplier-verification report. " +
            "STRICT rules: never invent corporate, shipment, certification, sanctions, litigation or legal facts. " +
            "You may only discuss findings that include one or more evidence_ids. If a finding is NOT_VERIFIED, say it is not independently verified. " +
            "Do not convert missing data or no-result searches into a clean pass. The deterministic outcome is given and must not be changed. Return ONLY JSON.",
        },
        {
          role: "user",
          content:
            `Supplier: ${JSON.stringify(args.supplier)}\n` +
            `Customer: ${JSON.stringify(args.customer)}\n` +
            `Resolved entity: ${JSON.stringify(args.resolved)}\n` +
            `Overall: ${args.overall.outcome} (${args.overall.overall} risk)\n` +
            `Findings (${args.findings.length}):\n` +
            args.findings
              .map(
                (f, i) =>
                  `${i + 1}. [${f.section}] ${f.item} — ${f.status} (${f.confidence}). ` +
                  `classification=${f.evidence_classification ?? "NOT_INDEPENDENTLY_VERIFIED"}; ` +
                  `evidence_ids=${(f.evidence_ids ?? []).join(",") || "NONE"}; ` +
                  `Evidence: ${f.evidence_excerpt.slice(0, 240)}`,
              )
              .join("\n") +
            `\n\nReturn ONLY:\n` +
            `{"executive_summary":"6-10 sentence summary","key_findings":["...","...","..."],` +
            `"buyer_implications":"3-5 sentences","recommended_safeguards":"3-5 sentences",` +
            `"payment_recommendation":"1-3 sentences","inspection_recommendation":"1-3 sentences",` +
            `"testing_recommendation":"1-3 sentences"}`,
        },
      ],
      { model: "google/gemini-2.5-flash" },
    );
    return { ...blank, ...out };
  } catch (e) {
    blank.executive_summary =
      "An automated executive summary could not be produced. The structured findings below remain authoritative.";
    blank.buyer_implications = `Synthesis error: ${(e as Error).message}`;
    return blank;
  }
}
